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

        // Tool-calling loop. Cap is generous because complex prompts
        // ("build me an Azure landing zone") need many rounds: docs
        // searches, then top-level mgmt-groups, then subscriptions, then
        // platform RGs, then per-RG resources. The model also hands
        // control back between layers so it can re-read the snapshot,
        // which costs an iteration each time. 40 is enough headroom for
        // a full CAF landing-zone build without risking runaway.
        const int MaxIterations = 40;
        var hitCap = false;
        for (var step = 0; step < MaxIterations; step++)
        {
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

                // After a few rounds without explicit progress, nudge the
                // model to keep building rather than stop early. We add a
                // short user-role hint reminding it of the iteration
                // budget so it knows it has space to finish multi-tier
                // designs.
                if (step > 0 && step % 8 == 0)
                {
                    var remaining = MaxIterations - step - 1;
                    messages.Add(new UserChatMessage(
                        $"(System note: ~{remaining} tool-calling rounds remain. " +
                        "If your design is incomplete — e.g. management groups exist but no subscriptions, or subscriptions exist but no resource groups, or resource groups exist with no resources inside them — keep adding the missing layers in this turn before replying.")
                    );
                }

                continue;
            }

            // Normal text completion — done
            var text = completion.Content.Count > 0 ? completion.Content[0].Text : string.Empty;
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
                ? "I've placed the resources I had time to build in this turn. The diagram may be incomplete — ask me to continue and I'll keep adding the remaining layers."
                : "I've made the requested changes. Let me know what to do next.",
            Actions = actions,
        };
        progress?.Report(new ChatProgressEvent { Kind = "assistant", Detail = capped.Message });
        progress?.Report(new ChatProgressEvent { Kind = "done", Final = capped });
        return capped;
    }

    private static string FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v)) ?? string.Empty;

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
                if (parent != null && IsType(parent.TypeKey, dep.TargetType))
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
                    if (!IsType(n.TypeKey, dep.TargetType)) continue;
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
                        if (ip != null && IsType(ip.TypeKey, dep.TargetType))
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
                        if (other != null && IsType(other.TypeKey, dep.TargetType))
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
                var candidate = request.Nodes.FirstOrDefault(n => IsType(n.TypeKey, dep.TargetType));
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
- Only ask the user a question when their request is genuinely ambiguous in intent (e.g. "what region?", "internal or internet-facing?"). Never ask which service-key to use.

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
- add_node(typeKey, name, parentId?, x?, y?) – place a new Azure resource on the canvas. typeKey MUST be one of the keys in the catalog below. Pass parentId to nest the new node inside an existing group node (Resource Group, Virtual Network, Subnet, etc.). Returns the generated node id (always of the form `ai-xxxxxxxxx`), which you MUST use verbatim for connect_nodes and as parentId for children. **NEVER pass a human-readable name as parentId** — only the `ai-...` id returned by a previous add_node call (or an existing id from the snapshot) is valid.
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

# Build complex designs LAYER BY LAYER — never stop after the top tier
For multi-tier requests (landing zones, hub-spoke networks, multi-region apps, etc.) you have many tool-calling rounds available. **Do not declare yourself done after creating only the outermost containers.** Build the whole hierarchy in this single turn:

1. Top container layer (e.g. management groups for a landing zone, hub VNet for hub-and-spoke).
2. Mid containers (subscriptions inside management groups; spoke VNets; resource groups; etc.).
3. Inner containers (resource groups inside subscriptions; subnets inside VNets).
4. Leaf resources (the actual services that live inside the inner containers).

After every batch of `add_node` calls, mentally re-read the snapshot. If ANY container is empty when it shouldn't be (e.g. you added a "Platform" management group but no Identity/Management/Connectivity subscriptions under it; or a "Connectivity" subscription with no hub-vnet RG inside; or a hub-vnet RG with no actual hub VNet, firewall, bastion etc.) — KEEP CALLING add_node in the same turn. Only emit your final text reply when every container has appropriate contents.

# Azure landing zone (CAF) hierarchy
When the user asks for an "Azure landing zone", "enterprise-scale landing zone", "CAF landing zone", or similar, follow Microsoft Cloud Adoption Framework Enterprise-Scale. The full structure to build (use exactly these typeKeys: `management-groups`, `subscriptions`, `resource-group`):

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
1. Tenant root management-group → all child management-groups (Platform, Landing Zones, Corp, Online, Sandbox, Decommissioned).
2. The platform subscriptions (Identity, Management, Connectivity) parented to their respective management-groups.
3. One example landing-zone subscription under Corp and one under Online.
4. The platform resource groups inside each platform subscription (rg-identity, rg-management, rg-connectivity-hub).
5. The actual platform resources inside those RGs — at minimum: in rg-management add a `log-analytics-workspace`; in rg-connectivity-hub add a `virtual-network` named `vnet-hub`, then subnets (`AzureFirewallSubnet`, `AzureBastionSubnet`, `GatewaySubnet`), then an `azure-firewall` in the firewall subnet and a `bastion` in the bastion subnet; in rg-identity add a `key-vault`.

The diagram is incomplete unless the platform resources actually exist — empty management-group / subscription / RG containers alone are NOT a landing zone.

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

                    // Private endpoints must live in a dedicated subnet under a VNet.
                    // Be aggressive: regardless of what parentId the model passed (or
                    // even if it passed nothing), find/create a 'snet-private-endpoints'
                    // subnet under the diagram's VNet and force the PE there.
                    var extras = new List<DiagramAction>();
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

                    var resultMsg = extras.Count > 0
                        ? $"Added node id={id} (auto-created dedicated PE subnet id={extras[0].Id} — use that subnet's id for additional private-endpoint nodes)"
                        : $"Added node id={id}";

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
