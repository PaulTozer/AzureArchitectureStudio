using System.ClientModel;
using System.Text.Json;
using Azure;
using Azure.AI.OpenAI;
using AzureArchitectureStudio.Server.Models;
using OpenAI.Chat;

namespace AzureArchitectureStudio.Server.Services;

public interface IChatService
{
    Task<ChatResponse> ChatAsync(ChatRequest request, CancellationToken ct = default);

    /// <summary>
    /// Streaming variant — invokes <paramref name="progress"/> for every
    /// interesting event (tool call, tool result, assistant text, etc.)
    /// and returns the same final ChatResponse the non-streaming overload
    /// would have produced.
    /// </summary>
    Task<ChatResponse> ChatAsync(
        ChatRequest request,
        IProgress<ChatProgressEvent>? progress,
        CancellationToken ct = default);
}

public class AzureOpenAIChatService : IChatService
{
    private readonly IConfiguration _config;
    private readonly IMicrosoftLearnMcpClient _mcp;
    private readonly ILogger<AzureOpenAIChatService> _logger;

    public AzureOpenAIChatService(IConfiguration config, IMicrosoftLearnMcpClient mcp, ILogger<AzureOpenAIChatService> logger)
    {
        _config = config;
        _mcp = mcp;
        _logger = logger;
    }

    public Task<ChatResponse> ChatAsync(ChatRequest request, CancellationToken ct = default)
        => ChatAsync(request, progress: null, ct);

    public async Task<ChatResponse> ChatAsync(
        ChatRequest request,
        IProgress<ChatProgressEvent>? progress,
        CancellationToken ct = default)
    {
        var endpoint = FirstNonEmpty(request.Settings?.Endpoint, _config["AzureOpenAI:Endpoint"]);
        var deployment = FirstNonEmpty(request.Settings?.Deployment, _config["AzureOpenAI:Deployment"]);
        var apiKey = FirstNonEmpty(request.Settings?.ApiKey, _config["AzureOpenAI:ApiKey"]);

        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(deployment) || string.IsNullOrWhiteSpace(apiKey))
        {
            var unconfigured = new ChatResponse
            {
                Success = false,
                Error = "Azure OpenAI is not configured. Click the settings icon and supply Endpoint, Deployment, and API key.",
                Message = "Please configure Azure OpenAI in Settings before chatting.",
            };
            progress?.Report(new ChatProgressEvent { Kind = "done", Final = unconfigured });
            return unconfigured;
        }

        ChatClient chatClient;
        try
        {
            var azureClient = new AzureOpenAIClient(new Uri(endpoint), new ApiKeyCredential(apiKey));
            chatClient = azureClient.GetChatClient(deployment);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to construct Azure OpenAI client");
            var fail = new ChatResponse { Success = false, Message = "Failed to connect to Azure OpenAI.", Error = ex.Message };
            progress?.Report(new ChatProgressEvent { Kind = "done", Final = fail });
            return fail;
        }

        // Build the conversation
        var messages = new List<ChatMessage>
        {
            new SystemChatMessage(BuildSystemPrompt(request)),
        };
        foreach (var t in request.History)
        {
            if (string.Equals(t.Role, "assistant", StringComparison.OrdinalIgnoreCase))
                messages.Add(new AssistantChatMessage(t.Content));
            else
                messages.Add(new UserChatMessage(t.Content));
        }
        messages.Add(new UserChatMessage(request.Message));

        var options = new ChatCompletionOptions();
        foreach (var tool in BuildTools()) options.Tools.Add(tool);

        var actions = new List<DiagramAction>();

        // Tool-calling loop. The hard cap below is a safety net to stop
        // genuinely runaway conversations (model stuck in a tool-calling
        // loop) — it is intentionally large so that complex multi-tier
        // CAF / landing-zone builds finish in a single turn. The PRIMARY
        // way the user controls runtime is the Stop button in the UI:
        // aborting the SSE fetch flips `ct`, which we surface as a
        // graceful "stopped by user" finish (the partial diagram already
        // streamed via `action` events stays on the canvas).
        const int MaxIterations = 200;
        var hitCap = false;
        var continueNudgesUsed = 0;
        for (var step = 0; step < MaxIterations; step++)
        {
            // Honour user-cancellation between iterations as well as
            // inside the OpenAI call. Cooperative — checked at the top
            // of each round so we never start a new completion after
            // the user has clicked Stop.
            if (ct.IsCancellationRequested)
            {
                var stopped = new ChatResponse
                {
                    Success = true,
                    Message = "Stopped at your request. The resources I'd already placed are still on the canvas.",
                    Actions = actions,
                };
                progress?.Report(new ChatProgressEvent { Kind = "assistant", Detail = stopped.Message });
                progress?.Report(new ChatProgressEvent { Kind = "done", Final = stopped });
                return stopped;
            }

            // On the final iteration, force the model to wrap up rather
            // than emit more tool calls (which we'd silently drop).
            if (step == MaxIterations - 1)
            {
                options.ToolChoice = ChatToolChoice.CreateNoneChoice();
                hitCap = true;
            }

            ChatCompletion completion;
            try
            {
                progress?.Report(new ChatProgressEvent
                {
                    Kind = "thinking",
                    Title = step == 0 ? "Thinking…" : $"Reasoning (round {step + 1})…",
                });
                completion = await chatClient.CompleteChatAsync(messages, options, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // User clicked Stop while the model was thinking. Return a
                // success response carrying whatever was built so far so
                // the client treats the partial diagram as the final
                // outcome rather than as an error.
                var stopped = new ChatResponse
                {
                    Success = true,
                    Message = "Stopped at your request. The resources I'd already placed are still on the canvas.",
                    Actions = actions,
                };
                progress?.Report(new ChatProgressEvent { Kind = "assistant", Detail = stopped.Message });
                progress?.Report(new ChatProgressEvent { Kind = "done", Final = stopped });
                return stopped;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Azure OpenAI request failed");
                var fail = new ChatResponse { Success = false, Message = "Azure OpenAI request failed.", Error = ex.Message };
                progress?.Report(new ChatProgressEvent { Kind = "done", Final = fail });
                return fail;
            }

            if (completion.FinishReason == ChatFinishReason.ToolCalls && completion.ToolCalls.Count > 0)
            {
                // Echo the assistant tool-call message back into context
                messages.Add(new AssistantChatMessage(completion));

                foreach (var call in completion.ToolCalls)
                {
                    _logger.LogWarning("Tool call: {Function} args={Args}", call.FunctionName, call.FunctionArguments.ToString());
                    progress?.Report(new ChatProgressEvent
                    {
                        Kind = "tool_call",
                        Title = SummariseToolCall(call),
                        Detail = call.FunctionArguments.ToString(),
                    });

                    var (toolResult, action, extraActions) = await HandleToolCallAsync(call, request, ct);
                    _logger.LogWarning("Tool result: {Result}", toolResult);
                    progress?.Report(new ChatProgressEvent
                    {
                        Kind = "tool_result",
                        Detail = toolResult,
                    });

                    if (extraActions != null)
                    {
                        foreach (var extra in extraActions)
                        {
                            actions.Add(extra);
                            progress?.Report(new ChatProgressEvent { Kind = "action", Action = extra });
                        }
                    }
                    if (action != null)
                    {
                        actions.Add(action);
                        progress?.Report(new ChatProgressEvent { Kind = "action", Action = action });
                    }
                    messages.Add(new ToolChatMessage(call.Id, toolResult));
                }

                // Periodic nudge to keep multi-tier builds moving when the
                // model has gone several rounds without finishing. We
                // deliberately don't quote the remaining round count any
                // more — the cap is now a safety net, not a budget the
                // model needs to ration against. Crucially the nudge is
                // tier-aware: if the user only asked for tier 1 / 2 / 5,
                // an "incomplete" diagram by tier-3 standards is actually
                // the FINISHED answer, and we must not push the model
                // into expanding scope.
                if (step > 0 && step % 8 == 0)
                {
                    messages.Add(new UserChatMessage(
                        "(System note: keep going IF AND ONLY IF the chosen scope tier is not yet complete. " +
                        "Re-read the Scope decision FIRST rules: which tier did you commit to for this request? " +
                        "If tier 1 (MG-only) and the MG tree + edges are placed → you are DONE, emit the final reply now (do NOT add subscriptions or resources). " +
                        "If tier 2 (governance scaffold) and MGs + subscriptions are placed and wired → you are DONE, emit the final reply now (do NOT add resource groups or platform resources). " +
                        "If tier 5 (single component) and the named resource + its required dependencies are placed → you are DONE. " +
                        "ONLY tier 3 (full landing zone) and tier 4 (workload reference architecture) require continuing into RGs, platform resources, and the workload's full topology. " +
                        "The user can press Stop at any time if they want to halt.")
                    );
                }

                continue;
            }

            // Normal text completion — done
            var text = completion.Content.Count > 0 ? completion.Content[0].Text : string.Empty;

            // Guard against the model promising to "continue later" or
            // asking the user permission to do the obvious next step
            // while leaving the build incomplete. If the final text
            // contains a continuation/ask phrase, force one more
            // tool-calling round with an explicit system reminder.
            // Documentation answers (which intentionally end with a
            // "Next steps" bullet list of suggestions) are exempted.
            var isDocsAnswer = LooksLikeDocsAnswer(text);
            if (!isDocsAnswer && LooksLikeContinuationPromise(text) && continueNudgesUsed < 3)
            {
                continueNudgesUsed++;
                _logger.LogInformation(
                    "Detected continuation/ask promise in assistant reply; forcing another tool round (nudge {Count}/3).",
                    continueNudgesUsed);
                messages.Add(new AssistantChatMessage(text));
                messages.Add(new UserChatMessage(
                    "(System note: Do NOT ask the user whether to continue or whether to add the next obvious resource — just DO it now IF the chosen scope tier requires it. " +
                    "Re-check the Scope decision FIRST rules: if you committed to tier 1 / tier 2 / tier 5 and that tier's deliverable is already on the canvas, you are DONE — emit a past-tense final reply describing what was built without asking permission and without expanding scope. " +
                    "If you committed to tier 3 (full CAF landing zone) or tier 4 (workload reference architecture) and pieces are still missing, call the necessary add_node / connect_nodes tools to finish the design (subscriptions under management groups, resource groups under subscriptions, actual resources inside resource groups, subnets inside VNets, supporting infrastructure, monitoring, etc.), and only then emit a final text reply describing what was built (past tense, no questions back to the user).")
                );
                continue;
            }

            var ok = new ChatResponse
            {
                Success = true,
                Message = text,
                Actions = actions,
            };
            progress?.Report(new ChatProgressEvent { Kind = "assistant", Detail = text });
            progress?.Report(new ChatProgressEvent { Kind = "done", Final = ok });
            return ok;
        }

        var capped = new ChatResponse
        {
            Success = true,
            Message = hitCap
                ? "I hit the safety limit on tool-calling rounds while building this. The diagram may be incomplete — ask me to continue and I'll keep adding the remaining layers, or press Stop next time if you want me to halt sooner."
                : "I've made the requested changes. Let me know what to do next.",
            Actions = actions,
        };
        progress?.Report(new ChatProgressEvent { Kind = "assistant", Detail = capped.Message });
        progress?.Report(new ChatProgressEvent { Kind = "done", Final = capped });
        return capped;
    }

    private static string FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v)) ?? string.Empty;

    /// <summary>
    /// Detects assistant replies that promise to keep building in a future
    /// turn rather than finishing the work now. When this returns true the
    /// service injects a system reminder and re-runs the model.
    /// </summary>
    private static bool LooksLikeContinuationPromise(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        // Lower-case once for cheap substring checks.
        var t = text.ToLowerInvariant();
        string[] phrases =
        [
            // Continuation promises
            "continuing build",
            "i'll continue",
            "i will continue",
            "i'll add the rest",
            "i will add the rest",
            "next, i will add",
            "next i will add",
            "next, i'll add",
            "next i'll add",
            "next, i will build",
            "next i will build",
            "i'll proceed to add",
            "i will proceed to add",
            "let me know to proceed",
            "let me know if you want me to continue",
            "shall i continue",
            "should i continue",
            "in the next message",
            "in the next turn",
            "in a follow-up",
            "in a follow up",
            "i'll keep going",
            "i will keep going",
            // Asking-the-user-instead-of-acting patterns. The model
            // should DO the obvious next step, not ask for permission.
            // (Documentation / informational replies legitimately end
            // with a "Next steps" bullet list — those use a different
            // structure and are excluded by the LooksLikeDocsAnswer
            // check at the call site.)
            "would you like me to",
            "would you like to",
            "do you want me to",
            "do you want to",
            "shall i ",
            "should i add",
            "should i build",
            "should i create",
            "let me know if you'd like",
            "let me know if you want",
            "let me know which",
            "want me to add",
            "want me to build",
            "want me to create",
        ];
        foreach (var p in phrases)
        {
            if (t.Contains(p)) return true;
        }
        return false;
    }

    /// <summary>
    /// Heuristic: does this assistant reply look like a documentation /
    /// informational answer (rather than a build action summary)? Docs
    /// answers are allowed to end with a "Next steps" bullet list of
    /// suggestions — those should NOT be re-prompted as continuation
    /// promises.
    /// </summary>
    private static bool LooksLikeDocsAnswer(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        var t = text.ToLowerInvariant();
        // The system prompt requires docs answers to end with a "Next
        // steps" header. That header is the cleanest signal.
        return t.Contains("next steps")
            || t.Contains("\n## next ")
            || t.Contains("**next steps**");
    }

    // The catalog uses both singular and plural forms (e.g. 'virtual-networks',
    // 'resource-groups', 'private-endpoints' but 'subnet', 'sql-server', 'sql-database').
    // This helper makes guard checks robust to either spelling.
    private static bool IsType(string? typeKey, params string[] aliases)
    {
        if (string.IsNullOrEmpty(typeKey)) return false;
        foreach (var a in aliases)
        {
            if (string.Equals(typeKey, a, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static bool IsResourceGroup(string? t) => IsType(t, "resource-group", "resource-groups");
    private static bool IsVirtualNetwork(string? t) => IsType(t, "virtual-network", "virtual-networks");
    private static bool IsSubnet(string? t) => IsType(t, "subnet", "subnets");
    private static bool IsPrivateEndpoint(string? t) => IsType(t, "private-endpoint", "private-endpoints");
    private static bool IsPrivateDnsZone(string? t) => IsType(t, "private-dns-zone", "private-dns-zones", "dns-zone", "dns-zones");
    private static bool IsManagementGroup(string? t) => IsType(t, "management-group", "management-groups");
    private static bool IsSubscription(string? t) => IsType(t, "subscription", "subscriptions");

    /// <summary>
    /// Fuzzy match for typeKeys that represent the same Azure resource family
    /// across the project's two catalogs (`resource-types.json` uses canonical
    /// keys like `appservice-plan`, `azure-services.json` uses category-suffixed
    /// keys like `app-service-plans--web`). Used by the dependency resolver so
    /// a Web App that depends on `appservice-plan` is satisfied by a node with
    /// typeKey `app-service-plans--web` and vice versa.
    /// </summary>
    private static bool IsSameFamily(string? declared, string? required)
    {
        if (string.IsNullOrEmpty(declared) || string.IsNullOrEmpty(required)) return false;
        if (string.Equals(declared, required, StringComparison.OrdinalIgnoreCase)) return true;
        var d = NormaliseFamily(declared);
        var r = NormaliseFamily(required);
        return string.Equals(d, r, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormaliseFamily(string typeKey)
    {
        // Strip category suffix ("--web", "--app-services", "--monitor", etc.)
        var s = typeKey;
        var dd = s.IndexOf("--", StringComparison.Ordinal);
        if (dd > 0) s = s.Substring(0, dd);
        s = s.ToLowerInvariant();
        // Canonicalise common synonyms / pluralisations to a single name.
        return s switch
        {
            "appserviceplan" or "appservice-plan" or "appservice-plans"
                or "app-service-plan" or "app-service-plans"
                or "server-farm" or "server-farms" or "serverfarm" or "serverfarms"
                => "appservice-plan",
            "web-app" or "web-apps" or "webapp" or "webapps"
                or "app-service" or "app-services" or "appservice" or "appservices"
                => "web-app",
            "function-app" or "function-apps" or "functionapp" or "functionapps"
                or "azure-function" or "azure-functions"
                => "function-app",
            "sql-server" or "sql-servers" or "sqlserver" or "sqlservers"
                => "sql-server",
            "sql-database" or "sql-databases" or "sqldatabase" or "sqldatabases"
                or "sql-db" or "sql-dbs"
                => "sql-database",
            "storage-account" or "storage-accounts" or "storageaccount" or "storageaccounts"
                => "storage-account",
            "key-vault" or "key-vaults" or "keyvault" or "keyvaults"
                => "key-vault",
            "log-analytics-workspace" or "log-analytics-workspaces"
                or "loganalyticsworkspace" or "loganalyticsworkspaces"
                => "log-analytics-workspace",
            "application-insights" or "applicationinsights"
                => "application-insights",
            "public-ip" or "public-ips" or "public-ip-address" or "public-ip-addresses"
                or "publicip" or "publicipaddress"
                => "public-ip",
            "network-interface" or "network-interfaces" or "nic" or "nics"
                or "networkinterface" or "networkinterfaces"
                => "network-interface",
            "virtual-machine" or "virtual-machines" or "vm" or "vms"
                or "virtualmachine" or "virtualmachines"
                => "virtual-machine",
            "virtual-network" or "virtual-networks" or "vnet" or "vnets"
                or "virtualnetwork" or "virtualnetworks"
                => "virtual-network",
            "subnet" or "subnets" => "subnet",
            "private-endpoint" or "private-endpoints" or "privateendpoint" or "privateendpoints"
                => "private-endpoint",
            "private-dns-zone" or "private-dns-zones" or "dns-zone" or "dns-zones"
                => "private-dns-zone",
            "resource-group" or "resource-groups" or "resourcegroup" or "resourcegroups"
                => "resource-group",
            "management-group" or "management-groups"
                => "management-group",
            "subscription" or "subscriptions" => "subscription",
            _ => s
        };
    }

    /// <summary>
    /// Build a short, human-readable headline for a tool call so the UI
    /// can render something like "Adding management group 'Platform'…"
    /// in the live activity log.
    /// </summary>
    private static string SummariseToolCall(ChatToolCall call)
    {
        try
        {
            using var doc = JsonDocument.Parse(call.FunctionArguments);
            var root = doc.RootElement;
            switch (call.FunctionName)
            {
                case "add_node":
                {
                    var name = root.TryGetProperty("name", out var n) ? (n.GetString() ?? "") : "";
                    var type = root.TryGetProperty("typeKey", out var t) ? (t.GetString() ?? "") : "";
                    var pretty = type
                        .Replace('-', ' ')
                        .TrimEnd('s'); // "subnets" -> "subnet"
                    if (string.IsNullOrEmpty(name)) return $"Adding {pretty}…";
                    return $"Adding {pretty} '{name}'…";
                }
                case "connect_nodes":
                {
                    return "Connecting two resources…";
                }
                case "remove_node":
                {
                    var id = root.TryGetProperty("id", out var i) ? (i.GetString() ?? "") : "";
                    return string.IsNullOrEmpty(id) ? "Removing node…" : $"Removing node {id}…";
                }
                case "clear_diagram":
                    return "Clearing the canvas…";
                case "microsoft_docs_search":
                {
                    var q = root.TryGetProperty("query", out var qe) ? (qe.GetString() ?? "") : "";
                    return string.IsNullOrEmpty(q)
                        ? "Searching Microsoft Learn…"
                        : $"Searching Microsoft Learn for \"{q}\"…";
                }
                default:
                    return $"Calling {call.FunctionName}…";
            }
        }
        catch
        {
            return $"Calling {call.FunctionName}…";
        }
    }

    /// <summary>
    /// Evaluate the required dependencies of a single node against the
    /// current diagram snapshot, mirroring the client-side
    /// <c>evaluateDependencies</c> rule (parent-of-type → edge-connected →
    /// property reference). Returns a short multiline explanation of any
    /// REQUIRED deps that are still unfulfilled, or <c>null</c> when the
    /// node is fully wired up. Used to nudge the model into adding the
    /// missing pieces in its next round.
    /// </summary>
    private static string? DescribeUnfulfilledDeps(
        DiagramNodeSnapshot node,
        ChatRequest request)
    {
        var svc = request.AvailableServices.FirstOrDefault(s =>
            string.Equals(s.Key, node.TypeKey, StringComparison.OrdinalIgnoreCase));
        if (svc == null || svc.Dependencies.Count == 0) return null;

        var unfulfilled = new List<string>();

        // Pre-compute connected node ids for this node.
        var connectedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in request.Edges)
        {
            if (string.Equals(e.Source, node.Id, StringComparison.OrdinalIgnoreCase))
                connectedIds.Add(e.Target);
            else if (string.Equals(e.Target, node.Id, StringComparison.OrdinalIgnoreCase))
                connectedIds.Add(e.Source);
        }

        foreach (var dep in svc.Dependencies)
        {
            if (!dep.Required) continue;

            DiagramNodeSnapshot? matched = null;
            string? source = null;

            // 1) parent of correct type
            if (dep.AutoFromParent && !string.IsNullOrEmpty(node.ParentId))
            {
                var parent = request.Nodes.FirstOrDefault(n =>
                    string.Equals(n.Id, node.ParentId, StringComparison.OrdinalIgnoreCase));
                if (parent != null && IsSameFamily(parent.TypeKey, dep.TargetType))
                {
                    matched = parent;
                    source = "parent";
                }
            }

            // 2) edge-connected to a node of correct type
            if (matched == null)
            {
                foreach (var n in request.Nodes)
                {
                    if (!connectedIds.Contains(n.Id)) continue;
                    if (!IsSameFamily(n.TypeKey, dep.TargetType)) continue;
                    matched = n;
                    source = "edge";
                    break;
                }
            }

            // 2.5) one-hop indirect via an intermediary type. e.g. a VM's
            // subnet dep accepts a network-interface as wrapper: if the VM
            // is connected to a NIC, and the NIC is in a subnet (or wired
            // to one), the dep is satisfied.
            if (matched == null && dep.AcceptVia.Count > 0)
            {
                foreach (var inter in request.Nodes)
                {
                    if (!connectedIds.Contains(inter.Id)) continue;
                    if (!dep.AcceptVia.Any(t => IsType(inter.TypeKey, t))) continue;

                    // Intermediate's parent matches targetType?
                    if (!string.IsNullOrEmpty(inter.ParentId))
                    {
                        var ip = request.Nodes.FirstOrDefault(n =>
                            string.Equals(n.Id, inter.ParentId, StringComparison.OrdinalIgnoreCase));
                        if (ip != null && IsSameFamily(ip.TypeKey, dep.TargetType))
                        {
                            matched = ip;
                            source = "edge";
                            break;
                        }
                    }

                    // Or intermediate is edge-connected to a node of targetType?
                    DiagramNodeSnapshot? viaEdge = null;
                    foreach (var e in request.Edges)
                    {
                        var otherId =
                            string.Equals(e.Source, inter.Id, StringComparison.OrdinalIgnoreCase) ? e.Target :
                            string.Equals(e.Target, inter.Id, StringComparison.OrdinalIgnoreCase) ? e.Source :
                            null;
                        if (otherId == null) continue;
                        var other = request.Nodes.FirstOrDefault(n =>
                            string.Equals(n.Id, otherId, StringComparison.OrdinalIgnoreCase));
                        if (other != null && IsSameFamily(other.TypeKey, dep.TargetType))
                        {
                            viaEdge = other;
                            break;
                        }
                    }
                    if (viaEdge != null)
                    {
                        matched = viaEdge;
                        source = "edge";
                        break;
                    }
                }
            }

            // 3) requiredName check on parent/edge match
            if (matched != null && dep.RequiredName.Count > 0)
            {
                var actual = matched.Name ?? "";
                var ok = dep.RequiredName.Any(r => string.Equals(r, actual, StringComparison.Ordinal));
                if (!ok)
                {
                    unfulfilled.Add(
                        $"  - {dep.Label}: target must be named " +
                        $"{string.Join(" or ", dep.RequiredName.Select(r => $"'{r}'"))}, " +
                        $"but {source} '{actual}' (id={matched.Id}) doesn't match. " +
                        (string.IsNullOrEmpty(dep.Hint) ? "" : $"Hint: {dep.Hint}"));
                    continue;
                }
            }

            if (matched == null)
            {
                // Suggest the simplest fix: connect to an existing candidate, or create one.
                var candidate = request.Nodes.FirstOrDefault(n => IsSameFamily(n.TypeKey, dep.TargetType));
                var fixHint = candidate != null
                    ? $"call connect_nodes(sourceId='{node.Id}', targetId='{candidate.Id}')" +
                      (string.IsNullOrEmpty(candidate.Name) ? "" : $" /* {candidate.Name} */")
                    : $"first add_node(typeKey='{dep.TargetType}', ...) and then connect it";

                unfulfilled.Add(
                    $"  - {dep.Label} (needs typeKey='{dep.TargetType}'): {fixHint}." +
                    (string.IsNullOrEmpty(dep.Hint) ? "" : $" {dep.Hint}"));
            }
        }

        if (unfulfilled.Count == 0) return null;
        return $"Required dependencies still unsatisfied for id={node.Id} ({node.TypeKey} '{node.Name}'):\n"
            + string.Join("\n", unfulfilled)
            + "\nPlease add the missing piece(s) in your next tool call(s).";
    }

    private static string BuildSystemPrompt(ChatRequest request)
    {
        var nodes = request.Nodes.Count == 0
            ? "(empty)"
            : string.Join("\n", request.Nodes.Select(n =>
                $"- id={n.Id} type={n.TypeKey} name=\"{n.Name}\"" +
                (string.IsNullOrEmpty(n.ParentId) ? "" : $" parentId={n.ParentId}")));
        var edges = request.Edges.Count == 0
            ? "(none)"
            : string.Join("\n", request.Edges.Select(e => $"- {e.Source} -> {e.Target}"));

        // Embed the catalog directly so the model can pick valid keys without asking the user.
        // Group by category to keep it scannable; cap entries to keep the prompt compact.
        var serviceCatalog = request.AvailableServices.Count == 0
            ? "(catalog not provided)"
            : string.Join("\n",
                request.AvailableServices
                    .GroupBy(s => string.IsNullOrWhiteSpace(s.Category) ? "Other" : s.Category)
                    .OrderBy(g => g.Key)
                    .Select(g => $"### {g.Key}\n" + string.Join("\n",
                        g.OrderBy(s => s.Name).Select(s => $"- {s.Key} — {s.Name}"))));

        return $$"""
You are the AI design assistant inside Azure Architecture Studio, an expert Azure solution architect.
You help the user create, modify, and explain Azure architecture diagrams on a visual canvas.

# How you work
- Be decisive and proactive. Do NOT ask the user to confirm service names, palettes, or which resources to use — the complete service catalog is provided below; pick the right typeKeys yourself.
- When the user asks for an architecture, design it and build it in the same turn using tool calls. Do not describe what you would do in prose first.
- Apply Microsoft's Well-Architected Framework (Reliability, Security, Cost, Operational Excellence, Performance Efficiency) and Azure Architecture Center reference architectures when choosing components.
- For anything you are not 100% certain about (specific SKUs, networking patterns, current best practice), call microsoft_docs_search BEFORE building, then proceed.
- **Default to acting, not asking.** Never end a turn with a question like "would you like me to…", "shall I add…", "do you want me to continue", "should I also build…", or "let me know if you'd like…". If a question like that is forming, instead just DO it — pick the most reasonable interpretation and build it. The user can always undo or refine afterwards.
- The ONLY time you may ask the user a clarifying question is when their request is so ambiguous that picking a default would be misleading (e.g. they said "build something" with zero context). Otherwise, infer the most likely intent from the conversation and the current canvas, and build.
- Specifically: do NOT ask before adding obvious follow-on resources, supporting infrastructure, monitoring, security hardening, or the next logical layer of a multi-tier design. Just add them and explain in the final reply what you added and why.

# Completeness rules — always include implicit dependencies
Before you finish, every resource on the canvas must have everything it needs to actually deploy. Whenever you add or modify resources, audit the diagram and add any missing supporting resources WITHOUT being asked:

- **Resource Group**: every Azure resource lives in one. If the diagram has none, add a `resource-group` node first and (mentally) place subsequent resources inside it. If the user adds new resources, add a resource group if not already present.
- **Private Endpoint** (`private-endpoint`): a private endpoint is a real node on the canvas, NOT just a DNS zone. Whenever the user asks for "private endpoints" / "private connectivity" / "private link" for any PaaS service (SQL, Storage, Key Vault, Cosmos, App Service, etc.), do EXACTLY this in the same turn:
    1. Make sure a `virtual-network` exists under the resource group (reuse if already there).
    2. For EACH PaaS service being privatised, call `add_node` with `typeKey="private-endpoints"`, a sensible name (e.g. `pe-sql`, `pe-storage-blob`, `pe-keyvault`), and `parentId` set to the **virtual-network's id**. **DO NOT pass a subnet id.** The server will automatically create a dedicated `snet-private-endpoints` subnet under the VNet on the first call and reuse it for the rest. Do not pre-create the subnet yourself.
    3. For each PaaS service type, add a `private-dns-zone` node parented to the resource-group (NOT the VNet/subnet). Standard names: `privatelink.database.windows.net` (SQL), `privatelink.blob.core.windows.net` (Blob), `privatelink.vaultcore.azure.net` (Key Vault), `privatelink.documents.azure.com` (Cosmos).
    4. Wire it up — call `connect_nodes` TWICE per PaaS service:
        - `connect_nodes(<paas service id>, <private-endpoint id>)`
        - `connect_nodes(<private-dns-zone id>, <virtual-network id>)`  ← the DNS vnet-link. Do NOT also connect the private endpoint to the DNS zone — the zone-group association is implied by them sharing the same `privatelink.*` zone, and a second edge just clutters the diagram.
   The diagram is incomplete unless every PaaS service that should be private has its own `private-endpoint` node AND the two connections above. Do NOT skip step 2.
- **Virtual Machine**: requires a `virtual-network`, a `subnet`, a `network-interface` (NIC), and typically a `network-security-group`. For inbound public access, add a `public-ip` and either a `bastion` or a `load-balancer` / `application-gateway` rather than RDP/SSH from the internet.
- **AKS / App Service with VNet integration**: needs a delegated `subnet`.
- **Application Gateway / Azure Firewall / Bastion**: each requires its OWN dedicated subnet inside the VNet (`AzureFirewallSubnet`, `AzureBastionSubnet`, etc.).
- **SQL Server / Storage Account / Key Vault** with private connectivity: pair with a Private Endpoint (see above) and disable public network access in the description.
- **Identity & secrets**: if the design handles secrets/keys, add `key-vault`. If apps need managed identity, mention it in the reply.
- **Monitoring**: for production-grade designs, include `log-analytics-workspace` and `application-insights` where appropriate.

After every change, briefly re-check the diagram and ADD missing dependencies in the same turn. Use the exact typeKeys from the catalog below; if a key isn't in the catalog, pick the closest available one and note the substitution.

# Tools available
- add_node(typeKey, name, parentId?, x?, y?) – place a new Azure resource on the canvas. typeKey MUST be one of the keys in the catalog below. Pass parentId to nest the new node inside an existing group node (Resource Group, Virtual Network, Subnet, etc.). Returns the generated node id as a string starting with `ai-` followed by 9 hex characters (for example `ai-1a2b3c4d5`). You MUST capture each tool's actual return value and pass THAT exact id back as `parentId` / `sourceId` / `targetId` in subsequent calls. **NEVER pass a human-readable name as parentId, and NEVER pass a placeholder like `ai-xxxxxxxxx`, `ai-yyyyyyyyy`, or any literal example id from these instructions** — only an `ai-...` id that was actually returned by a previous add_node call (or an existing id from the snapshot) is valid. If you don't yet have an id for a parent, create the parent first with add_node, read its returned id, and use it.
- connect_nodes(sourceId, targetId) – draw an arrow between two nodes already on the canvas.
- remove_node(id) – delete a node by id.
- clear_diagram() – wipe the canvas. Only call when the user explicitly asks to start over.
- microsoft_docs_search(query) – search Microsoft Learn / Azure docs (Well-Architected Framework, Azure Architecture Center, service docs). Use proactively whenever the user mentions a pattern, best practice, or service you're unsure about.

# Containment rules — always nest resources inside their parents
Group-style typeKeys act as containers in the diagram. The standard hierarchy is:
  resource-group  >  virtual-network  >  subnet  >  resource
Whenever you create resources:
1. There should only ever be ONE `resource-group` in the diagram for a single application. Before adding any resource, check the snapshot below for an existing `resource-group`. If one exists, reuse its id as parentId. Only call add_node for `resource-group` if the snapshot has none.
2. If no `resource-group` exists, add one first and pass its returned id as parentId for everything else (App Service, SQL Server, Storage Account, Key Vault, VNet, etc.). Every Azure resource lives inside a resource group.
3. If you create a `virtual-network`, pass the resource-group id as its parentId. Then create `subnet` nodes with the VNet id as their parentId.
4. Resources that live in a subnet (Private Endpoints, NICs, VMs, AKS, App Gateway, Bastion, Azure Firewall) MUST be created with that subnet's id as parentId.
5. Each special-purpose service requires its OWN dedicated subnet inside the VNet (`AzureFirewallSubnet`, `AzureBastionSubnet`, app-gateway subnet, private-endpoint subnet). Create the subnet first, then put the resource inside it.
6. **App Service Plan hosts Web Apps / Function Apps / Logic Apps (Standard)**: when you add a `web-app`, `function-app`, or a Logic App on the Standard plan (any `logic-apps*` key running on App Service infrastructure), its parentId MUST be the `appservice-plan` (a.k.a. App Service Plan / Server Farm) that hosts it. Create the plan first, then put the apps inside it. (Logic Apps Consumption is serverless and does NOT need a plan — only nest Standard-tier Logic Apps.)
7. **SQL Server hosts SQL Databases**: when you add a `sql-database`, its parentId MUST be the `sql-server` it lives on. Create the SQL Server first, then put each database inside it. The same applies to `cosmos-db-account` containing `cosmos-db-database`/containers, `mysql-server` containing `mysql-database`, `postgresql-server` containing `postgresql-database`, etc.
8. When the user adds new resources to an existing diagram, look at the snapshot below — if a resource group / VNet / subnet / App Service Plan / SQL Server already exists, reuse its id as parentId rather than creating duplicates.
9. **Satisfy every REQUIRED dependency.** After each `add_node` the tool result will tell you if the new resource is missing required references (e.g. a Bastion missing its public IP, a Private Endpoint missing its DNS zone, a VM missing its NIC). When you see "Required dependencies still unsatisfied", you MUST add the missing piece — either by creating the resource and using `connect_nodes` to link it, or, when an obvious candidate already exists, just call `connect_nodes` between them. A red warning triangle on the node is your signal that you stopped one step too soon.

Common dependency wiring patterns:
- `virtual-machine` → connect to a `network-interface` (which itself sits in a subnet) and any `managed-disk` data disks. Don't create disks as standalone unless asked, but if you do, `connect_nodes(vm, disk)` for each.
- `network-interface` → must live INSIDE a subnet (parentId = subnet.id).
- `bastions` (a.k.a. `azure-bastions`) → needs a `public-ip` (connect_nodes) and lives in a subnet named exactly `AzureBastionSubnet`.
- `firewalls` (Azure Firewall) → lives in a subnet named exactly `AzureFirewallSubnet`, needs a `public-ip` (connect_nodes).
- `vpn-gateway` / `expressroute-gateway` → lives in a subnet named exactly `GatewaySubnet`, needs a `public-ip`.
- `application-gateways` / `app-gateway` → needs a `public-ip` (connect_nodes), lives in its own dedicated subnet.
- `private-endpoint` → lives in a subnet, must be wired to a target resource (the thing it fronts) AND a `private-dns-zone` for the matching `privatelink.*` zone (connect the DNS zone to the VNet, NOT directly to the PE — the server will reject PE↔zone edges).
- `network-security-groups` (NSG) and `route-tables` → these are decorations associated with a single subnet (or VNet). Put them with `parentId = <the subnet's id>` rather than the resource group. The UI will render them pinned to the subnet's bottom-left corner. Connect with `connect_nodes(nsg, subnet)` to make the association explicit; alternatively use `connect_nodes(nsg, vnet)` for a VNet-scoped NSG.
- `kubernetes-services` (AKS) → put in a subnet, optional public IP for ingress.
- `web-app` / `function-app` (Standard plan) → parentId = `appservice-plan`.
- `sql-database` / `cosmos-db-database` / etc. → parentId = matching server.

When calling add_node, do not pass x or y for nested children — leave them blank and they'll be auto-laid-out inside the parent.

# Scope decision FIRST — pick exactly ONE tier, build EXACTLY that tier
**Before you build ANY node, you MUST explicitly decide which scope tier the user asked for, and then build only that tier — no more, no less.** Do not pattern-match on magic phrases; reason about what the user is actually asking for, and when in doubt, look up the term with `microsoft_docs_search` BEFORE building.

## The five scope tiers

| Tier | Name | What it contains | Example phrasings |
|---|---|---|---|
| **1** | **Management-group hierarchy only** | Just the MG icons + parent→child edges. No subscriptions, no RGs, no resources. | "management structure", "management group structure", "MG hierarchy", "governance structure", "org structure", "tenant hierarchy" |
| **2** | **Governance scaffold** (MGs + subscriptions) | MG tree + subscription nodes connected to the right MGs. No RGs, no resources. | "MGs and subscriptions", "subscription structure", "subscription vending pattern", "isolation hierarchy" |
| **3** | **Full CAF landing zone / enterprise-scale platform** | MGs + subs + RGs + the standard platform resources (hub vnet with firewall/bastion/gateway subnets, identity key-vault, management law). NO workload yet. | "landing zone", "CAF landing zone", "ALZ", "enterprise-scale", "Cloud Adoption Framework landing zone", "full platform" |
| **4** | **Workload reference architecture** | The named workload's full Azure Architecture Center reference: vnet+subnets, compute, data, monitoring, identity, private endpoints. May optionally be wrapped in tier 3 if the user explicitly asked for both. | "AVD architecture", "AKS reference architecture", "3-tier web app", "hub-and-spoke", "data platform", "SAP on Azure", "AI app" |
| **5** | **Single component** | Just the named resource(s) plus their REQUIRED hard dependencies (e.g. a VM gets a NIC). Nothing else. | "a web app", "one storage account", "an AKS cluster", "a key vault" |

## Decision rules
1. **Read the user's noun.** "Management structure" → tier 1. "Landing zone" → tier 3. "AVD" → tier 4. "Web app" → tier 5. The noun controls the tier; adjectives like "best practice", "to best practice", "production-grade", "properly", "correctly", "secure", "hardened" are **quality qualifiers** — they mean *do tier N well*, NOT *expand to a higher tier*.
2. **Tier expansion requires explicit upgrade words from the user**, not inference. Tier 1 → tier 3 only if the user said "with subscriptions and resources", "full", "end-to-end", "complete platform", "wrap this in a landing zone", or named a workload to host. The phrase "best practice" alone NEVER upgrades a tier.
3. **If the requested term is ambiguous to you, look it up first.** Call `microsoft_docs_search` with the exact term ("what is an Azure landing zone", "Microsoft management group structure CAF", "subscription vending pattern", "hub and spoke topology") and use the docs definition to pick the tier. Do this BEFORE the first `add_node`. Architectural terms have precise Microsoft definitions — pattern-matching is unreliable; the docs are not.
4. **State your tier decision in your reasoning before tool calls.** (You don't need to show this to the user, but you must commit to it: e.g. "User said 'management structure to best practice' → tier 1, build the MG tree only.")
5. **Build EXACTLY the chosen tier.** Each tier is a complete answer at its own level. A tier-1 diagram with just the MG tree is a finished, correct, best-practice answer to "build me a management structure". A tier-3 diagram with only MGs is a half-built tier-3, which is wrong.
6. **Workload + CAF combo (tier 4 inside tier 3)** is the only legitimate compound build, and ONLY when the user explicitly says both — e.g. "AVD in a CAF landing zone", "AKS reference architecture using enterprise-scale". A bare "AKS architecture" is tier 4 standalone, NOT tier 4-inside-tier-3.

## What "best practice" / "to best practice" means
It is a **quality** marker, not a scope marker. Treat these requests identically:
- "build me a management structure" → tier 1
- "build me a management structure to best practice" → tier 1 (use the standard CAF MG tree below — that IS the best practice)
- "best practice management groups" → tier 1
- "create the standard management structure" → tier 1

The "best practice" version of tier 1 is *the canonical CAF MG tree* (Tenant Root → Platform/Landing Zones/Sandbox/Decommissioned with the standard children). It is NOT "expand to tier 3".

## Informational questions
"How does X work", "what is Y", "compare A vs B", "explain Z" → answer with `microsoft_docs_search`; do NOT touch the diagram.

# Build complex designs LAYER BY LAYER — only when the chosen tier is multi-layer
This section applies ONLY to tier-3 (full CAF landing zone) and tier-4 (workload reference architecture) builds, and to tier-4-inside-tier-3 combos. For tier 1 (MG-only), tier 2 (governance scaffold), and tier 5 (single component), use the explicit recipe for that tier and stop — do NOT use the layer-by-layer approach to expand into adjacent tiers.

For tier-3 / tier-4 requests you have many tool-calling rounds available. **Do not declare yourself done after creating only the outermost containers.** Build the whole hierarchy in this single turn:

1. Top container layer (e.g. management groups for a landing zone, hub VNet for hub-and-spoke).
2. Mid containers (subscriptions inside management groups; spoke VNets; resource groups; etc.).
3. Inner containers (resource groups inside subscriptions; subnets inside VNets).
4. Leaf resources (the actual services that live inside the inner containers).

After every batch of `add_node` calls, mentally re-read the snapshot. If ANY container that the user's request DOES include is empty when it shouldn't be — KEEP CALLING add_node in the same turn. Only emit your final text reply when every in-scope container has appropriate contents.

## Critical: NEVER promise to continue later
You have ONE turn to finish the build. The user cannot "let you continue" — once you stop calling tools and emit a text reply, the turn is over and the conversation moves on. Therefore:

- **NEVER** say things like "I'll continue building", "Continuing build…", "Next, I will add subscriptions", "let me know to proceed", or "I'll add the rest in the next message". These phrases are FORBIDDEN. If you catch yourself about to write one, instead immediately make more tool calls to finish the work right now.
- **NEVER** end a turn with the design half-built RELATIVE TO THE CHOSEN TIER. (If you chose tier 1, an MG-only diagram is COMPLETE — not half-built. If you chose tier 2, an MG+subscription diagram is COMPLETE. Half-built only applies when the diagram is missing pieces of the tier you chose.) For a tier-3 build: if MGs exist but subscriptions don't, KEEP CALLING add_node; if subscriptions exist but RGs don't, KEEP CALLING add_node; if RGs are empty of resources, KEEP CALLING add_node.
- Your final text reply should describe what was built (past tense), NOT what you're about to build. If a layer is missing AND the user asked for it, the answer is more tool calls, not a promise to do them later.

## Critical: NEVER call clear_diagram to "start over"
`clear_diagram` is ONLY for cases where the user explicitly says "start over", "clear the canvas", "wipe everything and start fresh", etc. The server enforces this by refusing any second `clear_diagram` call within a single turn.

If you find yourself reasoning "let me clear and try again":
- **STOP.** Do not clear. Keep building on top of what's already there.
- If a node has unsatisfied REQUIRED dependencies that you cannot fix (e.g. the catalog doesn't contain the type you need, or the dependency is genuinely circular), accept the warning, mention it briefly in your final reply ("Note: aks-cluster needs X but the catalog has no matching type — left unwired."), and move on.
- Restarting wastes the user's time and produces worse results because each restart loses context. Always prefer "patch what's there" over "rebuild from scratch".

# Azure landing zone (CAF) hierarchy
The instructions in *this section* are the **tier-3** recipe. Only follow them when the **Scope decision FIRST** rules above selected tier 3 (full landing zone / enterprise-scale platform) or tier 4 wrapped in tier 3 (a workload explicitly placed inside a CAF landing zone). For tier 1 (MG-only), use just the "Standard CAF management group structure" sub-section and STOP after step 4 — do not continue into subscriptions, RGs, or platform resources. For tier 2 (governance scaffold), use the "Standard CAF management group structure" plus the "Tier 2 add-on" sub-section and STOP after subscriptions are wired — do not continue into RGs or platform resources.

A request is tier 3 only if the user said one of:
- "landing zone" / "CAF landing zone" / "ALZ" / "Azure landing zone"
- "enterprise-scale" / "enterprise scale"
- "full platform" / "complete platform" / "end-to-end platform"
- "Cloud Adoption Framework landing zone" / "CAF reference architecture" (the full noun phrase, not the bare "CAF" or bare "best practice")
- A named workload combined with one of the above (e.g. "AVD in a CAF landing zone", "AKS reference architecture using enterprise-scale")

Bare phrases like "best practice", "to best practice", "standard", "properly", "production-grade" are quality qualifiers — they do NOT trigger tier 3. Apply them to whatever tier the user's noun selected.

When a workload is named alongside an explicit tier-3 phrase, you MUST build BOTH:
1. The CAF scaffolding (MGs → subscriptions → RGs → platform resources, as described later in this section), AND
2. The workload's full reference architecture inside the appropriate Landing Zone subscription (see the Workload-specific recipes section).

For narrower asks (anything mentioning management groups, subscriptions, or hubs **without** any of the trigger phrases above and **without** a workload name), the **Scope decision FIRST** rules at the top of these instructions take precedence — build only the chosen tier. Do NOT proactively expand a tier-1 or tier-2 request into a full landing-zone build.

## Management group hierarchy — universal rules (apply whenever you place ANY management-group)
**`management-groups` is a LEAF node (small icon + label), not a container.** These rules ALWAYS apply, both for the standalone "MG structure" request and as part of a full landing zone:
1. Place EVERY management group as a TOP-LEVEL node — never pass `parentId` between management groups, and never set parentId at all on a management-group node. Doing so makes the children invisibly stack at (0,0).
2. After adding the MGs, you MUST call `connect_nodes(parentMgId, childMgId)` for every parent→child edge in the tree. The MG hierarchy is invisible without these arrows. **A diagram with MG icons but no arrows is broken — always wire them up in the same turn.**
3. Use the `ai-...` id returned by each `add_node` call as the source/target — never the human-readable name.

### Standard CAF management group structure (tier 1 — use this for any request whose scope-decision is tier 1: "management structure", "MG hierarchy", "governance structure", "org structure", with or without quality qualifiers like "best practice" / "standard" / "to best practice")
Build EXACTLY this tree, nothing more (no subscriptions, no resources, no RGs, no VNets):
```
Tenant Root Group
├── Platform
│   ├── Identity
│   ├── Management
│   └── Connectivity
├── Landing Zones
│   ├── Corp
│   └── Online
├── Sandbox
└── Decommissioned
```
Steps:
1. `add_node(typeKey="management-groups", name="Tenant Root Group")` → save the returned id.
2. `add_node` for each child MG (Platform, Landing Zones, Sandbox, Decommissioned) — all top-level, no parentId. Save each id.
3. `add_node` for the grand-children (Identity, Management, Connectivity under Platform; Corp, Online under Landing Zones) — also top-level, no parentId. Save each id.
4. `connect_nodes` for every parent→child edge: 4 from Tenant Root, 3 from Platform, 2 from Landing Zones. That's 9 edges total. **Do NOT skip step 4** — without it the diagram is just a row of disconnected icons.

**For tier 1 you STOP here.** No subscriptions, no resource groups, no platform resources. The MG tree is the entire deliverable. Emit the final text reply now.

### Tier 2 add-on — Governance scaffold (MGs + subscriptions, NO resources)
Use ONLY when the scope-decision is tier 2: the user asked for "MGs and subscriptions", "subscription structure", "subscription vending", "isolation hierarchy", or similar. Start by building the tier-1 MG tree above, then add subscriptions:

5. `add_node(typeKey="subscriptions", name="Identity Subscription")` — top-level, no parentId. Repeat for: Management Subscription, Connectivity Subscription, Corp Landing Zone Subscription, Online Landing Zone Subscription, Sandbox Subscription. Save each id.
6. `connect_nodes` from each MG to its subscription(s):
   - Identity MG → Identity Subscription
   - Management MG → Management Subscription
   - Connectivity MG → Connectivity Subscription
   - Corp MG → Corp Landing Zone Subscription
   - Online MG → Online Landing Zone Subscription
   - Sandbox MG → Sandbox Subscription

**For tier 2 you STOP here.** No resource groups, no VNets, no firewalls. The MG-plus-subscription scaffold is the entire deliverable. Emit the final text reply now.

### Tier 3 — Full CAF landing zone (extends tier 2 with RGs and platform resources)
Use ONLY when the scope-decision is tier 3. Continue from tier 2 with the resource-group and platform-resource layers below.

When the user does ask for a full landing zone, follow Microsoft Cloud Adoption Framework Enterprise-Scale (the section below extends the MG hierarchy with subscriptions, resource groups, and platform resources).

The full structure to build (use exactly these typeKeys: `management-groups`, `subscriptions`, `resource-group`):

```
Tenant Root (management-groups, name = "Tenant Root Group" or company name)
├── Platform (management-groups)
│   ├── Identity (subscription) → rg-identity (resource-group, holds AD DS / AAD DS resources, key-vault for identity)
│   ├── Management (subscription) → rg-management (resource-group, holds log-analytics-workspace, automation-account, recovery-services-vault)
│   └── Connectivity (subscription) → rg-connectivity-hub (resource-group, holds the hub virtual-network with AzureFirewallSubnet + azure-firewall, AzureBastionSubnet + bastion, GatewaySubnet, plus private-dns-zones for the org)
├── Landing Zones (management-groups)
│   ├── Corp (management-groups)         — for corporate-connected workloads
│   │   └── (subscription placeholder, e.g. "Corp LZ Subscription") → an empty rg-workload
│   └── Online (management-groups)       — for internet-facing workloads
│       └── (subscription placeholder, e.g. "Online LZ Subscription") → an empty rg-workload
├── Sandbox (management-groups)
│   └── (subscription placeholder, e.g. "Sandbox Subscription")
└── Decommissioned (management-groups)
```

Order of build (and don't stop until ALL of it exists):
1. All management-groups as TOP-LEVEL leaf nodes (no parentId), in tree order: Tenant Root, then Platform, Landing Zones, Sandbox, Decommissioned, then Corp, Online.
2. `connect_nodes` to draw the MG hierarchy: Tenant Root → each child MG, Landing Zones → Corp, Landing Zones → Online.
3. Subscriptions as TOP-LEVEL container nodes (no parentId): Identity, Management, Connectivity, plus one Corp LZ subscription and one Online LZ subscription. Use `connect_nodes(<owning MG id>, <subscription id>)` to attach each subscription to its MG in the tree.
4. Resource groups INSIDE each subscription (parentId = subscription id): rg-identity, rg-management, rg-connectivity-hub, rg-workload for the LZ subs.
5. The actual platform resources INSIDE those RGs — at minimum: in rg-management add a `log-analytics-workspace`; in rg-connectivity-hub add a `virtual-network` named `vnet-hub`, then subnets (`AzureFirewallSubnet`, `AzureBastionSubnet`, `GatewaySubnet`), then an `azure-firewall` in the firewall subnet and a `bastion` in the bastion subnet; in rg-identity add a `key-vault`.

The diagram is incomplete unless the platform resources actually exist — empty subscription / RG containers alone are NOT a landing zone.

# Workload-specific reference architectures
When the user names a workload (with or without a CAF qualifier), build that workload's **full** Microsoft reference architecture, not a placeholder. The recipes below are the canonical topologies — follow them in order, and do not stop after creating the outermost containers. If the user also said "CAF" / "landing zone" / "methodology" / "enterprise-scale", build the CAF scaffolding FIRST (per the section above), then place the workload inside the appropriate Landing Zone subscription (Corp for internal/enterprise-connected workloads like AVD, AKS, internal apps; Online for internet-facing workloads).

## Azure Virtual Desktop (AVD) — CAF-aligned reference architecture
Trigger phrases: "AVD", "Azure Virtual Desktop", "virtual desktop", "VDI", "WVD", "Windows Virtual Desktop". Build everything below in a single turn:

**Identity** (in the Identity subscription's `rg-identity`, or in `rg-identity` if no full CAF was requested):
- `key-vault` named `kv-avd-identity` (for AVD service principal / FSLogix secrets).

**Connectivity / hub** (in the Connectivity subscription's `rg-connectivity-hub`):
- `virtual-network` named `vnet-hub` with subnets `AzureFirewallSubnet`, `AzureBastionSubnet`, `GatewaySubnet`.
- `azure-firewall` in `AzureFirewallSubnet` with a `public-ip` connected.
- `bastion` in `AzureBastionSubnet` with a `public-ip` connected.

**AVD spoke** (Corp Landing Zone subscription, or top-level if no CAF was requested):
- `resource-group` named `rg-avd-network` containing `virtual-network` named `vnet-avd-spoke` with subnet `snet-avd-hosts`. Connect the spoke VNet to the hub VNet (peering edge).
- `resource-group` named `rg-avd-hostpool` containing the AVD control plane:
   - `host-pools` named `hp-avd` for the AVD host pool. (If the catalog also lists `azure-virtual-desktop`, you may add that as the workspace.)
   - Session hosts: place 2–3 `virtual-machine` nodes inside `snet-avd-hosts` (parentId = the snet-avd-hosts subnet id, NOT the resource group). Each VM needs a `network-interface` (parentId = same subnet) and a managed `disk` for the OS.
- `resource-group` named `rg-avd-storage` containing:
   - `storage-account` named `stavdfslogix<n>` for FSLogix profiles.
   - `private-endpoint` for the storage account, placed in `snet-avd-hosts` (or its own `snet-pe`), wired to the storage account.
   - `private-dns-zone` named `privatelink.file.core.windows.net`, linked to `vnet-avd-spoke` (and ideally the hub).
- `resource-group` named `rg-avd-monitoring` containing `log-analytics-workspace` named `law-avd` and `application-insights` named `appi-avd`.

**Wiring** (use connect_nodes for every edge):
- Spoke VNet ↔ hub VNet (peering).
- FSLogix storage ↔ private endpoint ↔ private DNS zone.
- Session hosts → key vault, log analytics, FSLogix storage (via PE).

The AVD diagram is INCOMPLETE if any of: vnet-hub with subnets+firewall+bastion, vnet-avd-spoke with snet-avd-hosts, FSLogix storage account with private endpoint, or log-analytics-workspace are missing. Keep adding nodes until all four exist.

## Other named workloads
For any other named workload ("AKS", "3-tier web app", "data platform", "SAP on Azure", "AI/ML app", etc.), build the canonical Microsoft Azure Architecture Center reference: VNet + dedicated subnets, the workload's primary compute (cluster / app service plan / VM scale set / etc.), required data services, monitoring (Log Analytics + App Insights), identity (Key Vault), and any private endpoints + private DNS zones the workload normally uses. Default to "secure by default" — private endpoints, no public RDP/SSH, NSGs on subnets, Bastion for admin access. If wrapped in a CAF context, place the whole stack in a Corp (or Online, for internet-facing) Landing Zone subscription.

# Reply style
- For diagram-build actions, keep replies short (1–4 sentences). After building, summarise what you placed and any best-practice rationale (e.g. "Added App Service Plan + Web App for the tier, Azure SQL for the data tier, and a Storage Account for blobs — following the Azure Architecture Center 'Basic web application' reference.").
- Cite the service names (not just typeKeys) in your reply.
- **For documentation / informational questions** (anything where you called `microsoft_docs_search`, or the user asked "how does X work", "what is Y", "best practice for Z", "compare A vs B", etc.), do NOT collapse the answer into one or two sentences. Instead:
    1. Give a structured, expanded explanation grounded in what `microsoft_docs_search` returned. Use short paragraphs and/or bullet points. Cover *what* it is, *why* it matters, key options/SKUs/limits, and any gotchas surfaced by the docs. Aim for roughly 150–400 words — enough to actually be useful, not a one-liner.
    2. Quote or paraphrase the most relevant docs excerpts and include the source URLs from the search results as inline links so the user can dig deeper.
    3. End every documentation answer with a short **"Next steps"** section (3–5 bullets) that offers concrete follow-up actions the user can take in this app — e.g. "Want me to add a hub-and-spoke VNet to your diagram?", "I can wire up Private Endpoints for the SQL Server now", "Shall I look up the pricing tier comparison for App Service?". The follow-ups must be specific to what was just discussed, not generic.
    4. If the docs search returned thin or no results, say so explicitly and offer to search again with a refined query as one of the next-step bullets.

# Current canvas state
Nodes:
{{nodes}}
Edges:
{{edges}}

# Available service catalog
Each entry is `<typeKey> — <display name>`. ONLY these typeKeys are valid for add_node.
{{serviceCatalog}}
""";
    }

    private static IEnumerable<ChatTool> BuildTools()
    {
        yield return ChatTool.CreateFunctionTool(
            "add_node",
            "Add a new Azure resource node to the diagram canvas. Returns the generated node id. Pass parentId to nest the new node inside an existing group node (resource-group, virtual-network, subnet, etc.).",
            BinaryData.FromString("""
            {
              "type": "object",
              "properties": {
                "typeKey":  { "type": "string", "description": "Resource type key from the catalog, e.g. 'web-app', 'sql-server', 'subnet'." },
                "name":     { "type": "string", "description": "Display name for the resource." },
                "parentId": { "type": "string", "description": "Optional id of an existing group node (resource-group, virtual-network, subnet) to nest this resource inside." },
                "x":        { "type": "number", "description": "Optional X position. Omit when parentId is set so the canvas auto-lays it out." },
                "y":        { "type": "number", "description": "Optional Y position. Omit when parentId is set so the canvas auto-lays it out." }
              },
              "required": ["typeKey", "name"]
            }
            """));

        yield return ChatTool.CreateFunctionTool(
            "connect_nodes",
            "Draw a directed connection from one diagram node to another.",
            BinaryData.FromString("""
            {
              "type": "object",
              "properties": {
                "sourceId": { "type": "string" },
                "targetId": { "type": "string" }
              },
              "required": ["sourceId", "targetId"]
            }
            """));

        yield return ChatTool.CreateFunctionTool(
            "remove_node",
            "Remove a node from the diagram by its id.",
            BinaryData.FromString("""
            { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }
            """));

        yield return ChatTool.CreateFunctionTool(
            "clear_diagram",
            "Remove every node and edge from the diagram. Only call when the user explicitly asks to start over.",
            BinaryData.FromString("""{ "type": "object", "properties": {} }"""));

        yield return ChatTool.CreateFunctionTool(
            "microsoft_docs_search",
            "Search Microsoft Learn / Azure documentation via the Microsoft Learn MCP server. Returns authoritative excerpts.",
            BinaryData.FromString("""
            { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] }
            """));
    }

    private async Task<(string Result, DiagramAction? Action, List<DiagramAction>? ExtraActions)> HandleToolCallAsync(
        ChatToolCall call,
        ChatRequest request,
        CancellationToken ct)
    {
        JsonDocument args;
        try { args = JsonDocument.Parse(call.FunctionArguments); }
        catch { return ("Invalid tool arguments.", null, null); }

        try
        {
            switch (call.FunctionName)
            {
                case "add_node":
                {
                    var typeKey = args.RootElement.TryGetProperty("typeKey", out var tk) ? tk.GetString() ?? "" : "";
                    var name    = args.RootElement.TryGetProperty("name",    out var n)  ? n.GetString()  ?? "" : "";
                    if (string.IsNullOrWhiteSpace(typeKey) || string.IsNullOrWhiteSpace(name))
                        return ("Missing typeKey or name.", null, null);

                    if (request.AvailableServices.Count > 0
                        && !request.AvailableServices.Any(s => string.Equals(s.Key, typeKey, StringComparison.OrdinalIgnoreCase)))
                    {
                        return ($"Unknown typeKey '{typeKey}'. Pick a key from the available services list.", null, null);
                    }

                    // Read parentId early so we can validate uniqueness scoped to it.
                    string? parentIdEarly = args.RootElement.TryGetProperty("parentId", out var pe0) && pe0.ValueKind == JsonValueKind.String
                        ? pe0.GetString()
                        : null;

                    // Per-parent resource-group guard. A flat single-app
                    // diagram only has one RG, but a CAF landing zone has
                    // many — one per subscription. Only reject the case
                    // where the same parent already contains an RG.
                    if (IsResourceGroup(typeKey))
                    {
                        var existingRg = request.Nodes.FirstOrDefault(x =>
                            IsResourceGroup(x.TypeKey)
                            && string.Equals(x.ParentId ?? "", parentIdEarly ?? "", StringComparison.OrdinalIgnoreCase));
                        if (existingRg != null && string.Equals(existingRg.Name, name, StringComparison.OrdinalIgnoreCase))
                        {
                            return (
                                $"A resource-group named '{existingRg.Name}' already exists under this parent (id={existingRg.Id}). " +
                                $"Reuse it as parentId instead of creating another.",
                                null, null);
                        }
                    }

                    // Virtual-network singleton per resource group. The model has been
                    // observed to create a second VNet in a follow-up turn instead of
                    // adding subnets to the existing one. Reuse it.
                    if (IsVirtualNetwork(typeKey))
                    {
                        var existingVnet = request.Nodes.FirstOrDefault(x =>
                            IsVirtualNetwork(x.TypeKey)
                            && (string.IsNullOrEmpty(parentIdEarly) || x.ParentId == parentIdEarly));
                        if (existingVnet != null)
                        {
                            return (
                                $"A virtual-network already exists (id={existingVnet.Id}, name=\"{existingVnet.Name}\"" +
                                (string.IsNullOrEmpty(existingVnet.ParentId) ? "" : $", parentId={existingVnet.ParentId}") +
                                "). Add subnets/resources INSIDE it (use this id as parentId) instead of creating another VNet.",
                                null, null);
                        }
                    }

                    // Generic duplicate guard: same typeKey + same name under the same parent
                    // almost always means the model forgot it already created this node.
                    var dup = request.Nodes.FirstOrDefault(x =>
                        string.Equals(x.TypeKey, typeKey, StringComparison.OrdinalIgnoreCase)
                        && string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)
                        && string.Equals(x.ParentId ?? "", parentIdEarly ?? "", StringComparison.OrdinalIgnoreCase));
                    if (dup != null)
                    {
                        return (
                            $"A node with typeKey='{typeKey}' and name='{name}' already exists (id={dup.Id}). " +
                            $"Reuse this id rather than creating a duplicate.",
                            null, null);
                    }

                    double? x = args.RootElement.TryGetProperty("x", out var xe) && xe.ValueKind == JsonValueKind.Number ? xe.GetDouble() : null;
                    double? y = args.RootElement.TryGetProperty("y", out var ye) && ye.ValueKind == JsonValueKind.Number ? ye.GetDouble() : null;
                    string? parentId = parentIdEarly;
                    // Detect placeholder ids the model sometimes copies from
                    // the docstring (`ai-xxxxxxxxx`, `ai-yyyyyyyyy`, etc.) —
                    // surface a more actionable error than "Unknown parentId".
                    if (!string.IsNullOrWhiteSpace(parentId)
                        && System.Text.RegularExpressions.Regex.IsMatch(parentId,
                            @"^ai-([xyz])\1{8,}$"))
                    {
                        return (
                            $"Placeholder parentId '{parentId}' is not a real id. " +
                            $"`ai-xxxxxxxxx` in the docstring is a SHAPE EXAMPLE — use the actual id " +
                            $"that a previous add_node call returned (or omit parentId to create a top-level node).",
                            null, null);
                    }
                    if (!string.IsNullOrWhiteSpace(parentId)
                        && !request.Nodes.Any(existing => existing.Id == parentId))
                    {
                        return ($"Unknown parentId '{parentId}'. Reference an id of a node already on the canvas.", null, null);
                    }

                    // Containment-shape guards: subnets MUST live inside a virtual-network
                    // (never inside another subnet). Auto-correct by walking up to the
                    // nearest virtual-network ancestor.
                    if (IsSubnet(typeKey) && !string.IsNullOrEmpty(parentId))
                    {
                        var parent = request.Nodes.FirstOrDefault(p => p.Id == parentId);
                        if (parent != null && !IsVirtualNetwork(parent.TypeKey))
                        {
                            // Walk up looking for a VNet
                            var cursor = parent;
                            while (cursor != null && !IsVirtualNetwork(cursor.TypeKey))
                            {
                                cursor = string.IsNullOrEmpty(cursor.ParentId)
                                    ? null
                                    : request.Nodes.FirstOrDefault(p => p.Id == cursor.ParentId);
                            }
                            if (cursor == null)
                            {
                                return (
                                    $"Subnets must be parented to a virtual-network, but parentId '{parentId}' is a {parent.TypeKey}. " +
                                    $"Create or reference a virtual-network first, then add the subnet to it.",
                                    null, null);
                            }
                            parentId = cursor.Id;
                        }
                    }

                    // CAF management-group / subscription rules — enforced server-side
                    // because the model keeps stamping parentId between MGs and putting
                    // subscriptions inside MGs. Both produce broken layouts (MGs are
                    // leaf icons, not containers, and subscriptions clamped inside a
                    // leaf parent collapse to 0,0).
                    //
                    // Strategy: silently strip the illegal parentId AND queue a
                    // connect_nodes(parent → new node) edge so the visible result is
                    // a top-level node connected to its intended parent — exactly
                    // the CAF tree diagram we want.
                    var extras = new List<DiagramAction>();

                    string? autoEdgeFromParent = null; // queue an edge after id is generated
                    if (!string.IsNullOrEmpty(parentId))
                    {
                        var parentNode = request.Nodes.FirstOrDefault(p => p.Id == parentId);
                        if (parentNode != null)
                        {
                            // MG → MG: never nest. Replace parentId with edge.
                            if (IsManagementGroup(typeKey) && IsManagementGroup(parentNode.TypeKey))
                            {
                                autoEdgeFromParent = parentNode.Id;
                                parentId = null;
                            }
                            // Subscription → MG: subscriptions are top-level containers
                            // attached to their MG by an edge, not by parentId.
                            else if (IsSubscription(typeKey) && IsManagementGroup(parentNode.TypeKey))
                            {
                                autoEdgeFromParent = parentNode.Id;
                                parentId = null;
                            }
                            // Anything → MG: MGs are LEAVES, can't contain anything.
                            // Promote child to top-level and connect MG → child.
                            else if (IsManagementGroup(parentNode.TypeKey))
                            {
                                autoEdgeFromParent = parentNode.Id;
                                parentId = null;
                            }
                        }
                    }

                    // Private endpoints must live in a dedicated subnet under a VNet.
                    // Be aggressive: regardless of what parentId the model passed (or
                    // even if it passed nothing), find/create a 'snet-private-endpoints'
                    // subnet under the diagram's VNet and force the PE there.
                    if (IsPrivateEndpoint(typeKey))
                    {
                        // Locate a VNet to host this PE.
                        DiagramNodeSnapshot? targetVnet = null;

                        if (!string.IsNullOrEmpty(parentId))
                        {
                            var parentNode = request.Nodes.FirstOrDefault(p => p.Id == parentId);
                            if (parentNode != null)
                            {
                                if (IsVirtualNetwork(parentNode.TypeKey))
                                {
                                    targetVnet = parentNode;
                                }
                                else if (IsSubnet(parentNode.TypeKey))
                                {
                                    targetVnet = string.IsNullOrEmpty(parentNode.ParentId)
                                        ? null
                                        : request.Nodes.FirstOrDefault(p => p.Id == parentNode.ParentId
                                            && IsVirtualNetwork(p.TypeKey));
                                }
                            }
                        }

                        // Fall back to ANY VNet in the diagram.
                        targetVnet ??= request.Nodes.FirstOrDefault(p => IsVirtualNetwork(p.TypeKey));

                        if (targetVnet != null)
                        {
                            // Reuse an existing dedicated PE subnet under this VNet, or create one.
                            var existingPeSubnet = request.Nodes.FirstOrDefault(p =>
                            {
                                if (!IsSubnet(p.TypeKey)) return false;
                                if (p.ParentId != targetVnet.Id) return false;
                                var nm = (p.Name ?? "").ToLowerInvariant();
                                return nm.Contains("private-endpoint")
                                    || nm.Contains("privateendpoint")
                                    || nm == "snet-pe"
                                    || nm.StartsWith("snet-pe-")
                                    || nm.Contains("private-link")
                                    || nm.Contains("privatelink");
                            });

                            if (existingPeSubnet != null)
                            {
                                parentId = existingPeSubnet.Id;
                            }
                            else
                            {
                                var newSubnetId = $"ai-{Guid.NewGuid():N}".Substring(0, 12);
                                request.Nodes.Add(new DiagramNodeSnapshot
                                {
                                    Id = newSubnetId,
                                    TypeKey = "subnet",
                                    Name = "snet-private-endpoints",
                                    ParentId = targetVnet.Id,
                                });
                                extras.Add(new DiagramAction
                                {
                                    Type = "add_node",
                                    Id = newSubnetId,
                                    TypeKey = "subnet",
                                    Name = "snet-private-endpoints",
                                    ParentId = targetVnet.Id,
                                });
                                parentId = newSubnetId;
                            }
                        }
                    }

                    var id = $"ai-{Guid.NewGuid():N}".Substring(0, 12);

                    // Track in snapshot so subsequent connect_nodes / parentId calls work
                    var addedSnap = new DiagramNodeSnapshot { Id = id, TypeKey = typeKey, Name = name, ParentId = parentId };
                    request.Nodes.Add(addedSnap);

                    // If we stripped a parentId because the model tried to nest under
                    // a management group, materialize the intended hierarchy as an
                    // edge instead. Persist it on the request snapshot AND emit a
                    // connect_nodes extra action so the client renders the arrow.
                    if (!string.IsNullOrEmpty(autoEdgeFromParent))
                    {
                        if (!request.Edges.Any(e => e.Source == autoEdgeFromParent && e.Target == id))
                        {
                            request.Edges.Add(new DiagramEdgeSnapshot { Source = autoEdgeFromParent, Target = id });
                            extras.Add(new DiagramAction
                            {
                                Type = "connect_nodes",
                                SourceId = autoEdgeFromParent,
                                TargetId = id,
                            });
                        }
                    }

                    var resultMsg = $"Added node id={id}";
                    if (!string.IsNullOrEmpty(autoEdgeFromParent))
                    {
                        resultMsg += $" (auto-connected from parent {autoEdgeFromParent}; management groups are leaves — never use them as parentId, use connect_nodes instead)";
                    }
                    else if (extras.Count > 0 && IsSubnet(extras[0].TypeKey))
                    {
                        resultMsg = $"Added node id={id} (auto-created dedicated PE subnet id={extras[0].Id} — use that subnet's id for additional private-endpoint nodes)";
                    }

                    // Tell the model about any required deps we know are still missing
                    // so it can fix them up rather than us silently shipping a node with
                    // a red warning triangle.
                    var depMsg = DescribeUnfulfilledDeps(addedSnap, request);
                    if (!string.IsNullOrEmpty(depMsg))
                    {
                        resultMsg = resultMsg + "\n" + depMsg;
                    }

                    return (resultMsg, new DiagramAction
                    {
                        Type = "add_node", Id = id, TypeKey = typeKey, Name = name, X = x, Y = y, ParentId = parentId,
                    }, extras.Count > 0 ? extras : null);
                }

                case "connect_nodes":
                {
                    var src = args.RootElement.TryGetProperty("sourceId", out var s) ? s.GetString() ?? "" : "";
                    var tgt = args.RootElement.TryGetProperty("targetId", out var t) ? t.GetString() ?? "" : "";
                    if (string.IsNullOrWhiteSpace(src) || string.IsNullOrWhiteSpace(tgt))
                        return ("Missing sourceId or targetId.", null, null);

                    // Suppress redundant Private Endpoint ↔ Private DNS Zone edges:
                    // the zone-group association is implied by the matching `privatelink.*`
                    // zone, so an extra arrow only clutters the diagram.
                    var srcNode = request.Nodes.FirstOrDefault(n => n.Id == src);
                    var tgtNode = request.Nodes.FirstOrDefault(n => n.Id == tgt);
                    if (srcNode is not null && tgtNode is not null)
                    {
                        var pair1 = IsPrivateEndpoint(srcNode.TypeKey) && IsPrivateDnsZone(tgtNode.TypeKey);
                        var pair2 = IsPrivateDnsZone(srcNode.TypeKey) && IsPrivateEndpoint(tgtNode.TypeKey);
                        if (pair1 || pair2)
                        {
                            _logger.LogWarning("Suppressing redundant private-endpoint ↔ private-dns-zone edge {Src} -> {Tgt}", src, tgt);
                            return ("skipped: private-endpoint ↔ private-dns-zone edge is redundant; the zone-group binding is implied. Connect the DNS zone to the virtual-network instead.", null, null);
                        }
                    }

                    // Drop exact-duplicate edges
                    if (request.Edges.Any(e => e.Source == src && e.Target == tgt))
                    {
                        return ("skipped: edge already exists", null, null);
                    }

                    request.Edges.Add(new DiagramEdgeSnapshot { Source = src, Target = tgt });

                    // After wiring, re-check the source's required deps and surface
                    // any that are still missing so the model can keep fixing things up.
                    var srcAfter = request.Nodes.FirstOrDefault(n => n.Id == src);
                    var stillMissing = srcAfter != null
                        ? DescribeUnfulfilledDeps(srcAfter, request)
                        : null;
                    var resultStr = string.IsNullOrEmpty(stillMissing) ? "ok" : "ok\n" + stillMissing;

                    return (resultStr, new DiagramAction { Type = "connect_nodes", SourceId = src, TargetId = tgt }, null);
                }

                case "remove_node":
                {
                    var id = args.RootElement.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "";
                    if (string.IsNullOrWhiteSpace(id)) return ("Missing id.", null, null);
                    request.Nodes.RemoveAll(n => n.Id == id);
                    request.Edges.RemoveAll(e => e.Source == id || e.Target == id);
                    return ("ok", new DiagramAction { Type = "remove_node", Id = id }, null);
                }

                case "clear_diagram":
                {
                    // Hard guard against the model getting into a
                    // "start over" loop when it can't satisfy a required
                    // dependency. Allow at most ONE clear per turn; any
                    // further calls return an error string instead of
                    // wiping the canvas, which forces the model to keep
                    // building on top of what it already has.
                    request.ClearCount++;
                    if (request.ClearCount > 1)
                    {
                        _logger.LogWarning("Refusing repeated clear_diagram call (count={Count}).", request.ClearCount);
                        return (
                            "clear_diagram refused: you have already cleared the canvas once this turn. " +
                            "Do NOT start over again. Keep building on the current snapshot — if a node has " +
                            "unsatisfied required dependencies that you genuinely cannot fix (e.g. the catalog " +
                            "does not contain the needed type), leave the warning in place, mention it briefly " +
                            "in your final reply, and move on.",
                            null,
                            null);
                    }
                    request.Nodes.Clear();
                    request.Edges.Clear();
                    return ("ok", new DiagramAction { Type = "clear_diagram" }, null);
                }

                case "microsoft_docs_search":
                {
                    var q = args.RootElement.TryGetProperty("query", out var qe) ? qe.GetString() ?? "" : "";
                    if (string.IsNullOrWhiteSpace(q)) return ("Empty query.", null, null);
                    var docs = await _mcp.SearchDocsAsync(q, ct);
                    return (docs, null, null);
                }

                default:
                    return ($"Unknown tool: {call.FunctionName}", null, null);
            }
        }
        finally
        {
            args.Dispose();
        }
    }
}
