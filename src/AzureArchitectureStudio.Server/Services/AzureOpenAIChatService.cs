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

    public async Task<ChatResponse> ChatAsync(ChatRequest request, CancellationToken ct = default)
    {
        var endpoint = FirstNonEmpty(request.Settings?.Endpoint, _config["AzureOpenAI:Endpoint"]);
        var deployment = FirstNonEmpty(request.Settings?.Deployment, _config["AzureOpenAI:Deployment"]);
        var apiKey = FirstNonEmpty(request.Settings?.ApiKey, _config["AzureOpenAI:ApiKey"]);

        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(deployment) || string.IsNullOrWhiteSpace(apiKey))
        {
            return new ChatResponse
            {
                Success = false,
                Error = "Azure OpenAI is not configured. Click the settings icon and supply Endpoint, Deployment, and API key.",
                Message = "Please configure Azure OpenAI in Settings before chatting.",
            };
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
            return new ChatResponse { Success = false, Message = "Failed to connect to Azure OpenAI.", Error = ex.Message };
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

        var options = new ChatCompletionOptions
        {
            Temperature = 0.4f,
            MaxOutputTokenCount = 1500,
        };
        foreach (var tool in BuildTools()) options.Tools.Add(tool);

        var actions = new List<DiagramAction>();

        // Tool-calling loop (cap iterations to avoid runaway)
        for (var step = 0; step < 8; step++)
        {
            ChatCompletion completion;
            try
            {
                completion = await chatClient.CompleteChatAsync(messages, options, ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Azure OpenAI request failed");
                return new ChatResponse { Success = false, Message = "Azure OpenAI request failed.", Error = ex.Message };
            }

            if (completion.FinishReason == ChatFinishReason.ToolCalls && completion.ToolCalls.Count > 0)
            {
                // Echo the assistant tool-call message back into context
                messages.Add(new AssistantChatMessage(completion));

                foreach (var call in completion.ToolCalls)
                {
                    var (toolResult, action) = await HandleToolCallAsync(call, request, ct);
                    if (action != null) actions.Add(action);
                    messages.Add(new ToolChatMessage(call.Id, toolResult));
                }
                continue;
            }

            // Normal text completion — done
            var text = completion.Content.Count > 0 ? completion.Content[0].Text : string.Empty;
            return new ChatResponse
            {
                Success = true,
                Message = text,
                Actions = actions,
            };
        }

        return new ChatResponse
        {
            Success = true,
            Message = "I've made the requested changes. Let me know what to do next.",
            Actions = actions,
        };
    }

    private static string FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v)) ?? string.Empty;

    private static string BuildSystemPrompt(ChatRequest request)
    {
        var nodes = request.Nodes.Count == 0
            ? "(empty)"
            : string.Join("\n", request.Nodes.Select(n => $"- id={n.Id} type={n.TypeKey} name=\"{n.Name}\""));
        var edges = request.Edges.Count == 0
            ? "(none)"
            : string.Join("\n", request.Edges.Select(e => $"- {e.Source} -> {e.Target}"));

        return $$"""
You are the AI design assistant inside Azure Architecture Studio.
You help the user create, modify, and explain Azure architecture diagrams on a visual canvas.

You can call these tools:
- add_node(typeKey, name, x?, y?) – place a new Azure resource on the canvas. typeKey MUST be one of the keys from the available services list below. The tool returns the generated node id.
- connect_nodes(sourceId, targetId) – draw an arrow between two nodes already on the canvas.
- remove_node(id) – delete a node by id.
- clear_diagram() – wipe the canvas. Only use after the user explicitly asks.
- microsoft_docs_search(query) – search Microsoft Learn / Azure docs for authoritative guidance. Use it whenever the user asks about Azure best practices, services, or reference architectures you are unsure about.

Guidelines:
1. Be concise. After making diagram changes, summarise what you did in 1–3 sentences.
2. Always cite the Azure service typeKeys you placed by name in your reply.
3. Prefer building incrementally with add_node + connect_nodes calls rather than telling the user to do it manually.
4. Only call clear_diagram when the user explicitly asks to start over.
5. When unsure about an Azure feature, call microsoft_docs_search first, then design.

Current canvas state:
Nodes:
{{nodes}}
Edges:
{{edges}}
""";
    }

    private static IEnumerable<ChatTool> BuildTools()
    {
        yield return ChatTool.CreateFunctionTool(
            "add_node",
            "Add a new Azure resource node to the diagram canvas. Returns the generated node id.",
            BinaryData.FromString("""
            {
              "type": "object",
              "properties": {
                "typeKey": { "type": "string", "description": "Resource type key, e.g. 'web-app', 'sql-server'." },
                "name":    { "type": "string", "description": "Display name for the resource." },
                "x":       { "type": "number", "description": "Optional X position on canvas." },
                "y":       { "type": "number", "description": "Optional Y position on canvas." }
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

    private async Task<(string Result, DiagramAction? Action)> HandleToolCallAsync(
        ChatToolCall call,
        ChatRequest request,
        CancellationToken ct)
    {
        JsonDocument args;
        try { args = JsonDocument.Parse(call.FunctionArguments); }
        catch { return ("Invalid tool arguments.", null); }

        try
        {
            switch (call.FunctionName)
            {
                case "add_node":
                {
                    var typeKey = args.RootElement.TryGetProperty("typeKey", out var tk) ? tk.GetString() ?? "" : "";
                    var name    = args.RootElement.TryGetProperty("name",    out var n)  ? n.GetString()  ?? "" : "";
                    if (string.IsNullOrWhiteSpace(typeKey) || string.IsNullOrWhiteSpace(name))
                        return ("Missing typeKey or name.", null);

                    if (request.AvailableServices.Count > 0
                        && !request.AvailableServices.Any(s => string.Equals(s.Key, typeKey, StringComparison.OrdinalIgnoreCase)))
                    {
                        return ($"Unknown typeKey '{typeKey}'. Pick a key from the available services list.", null);
                    }

                    double? x = args.RootElement.TryGetProperty("x", out var xe) && xe.ValueKind == JsonValueKind.Number ? xe.GetDouble() : null;
                    double? y = args.RootElement.TryGetProperty("y", out var ye) && ye.ValueKind == JsonValueKind.Number ? ye.GetDouble() : null;
                    var id = $"ai-{Guid.NewGuid():N}".Substring(0, 12);

                    // Track in snapshot so subsequent connect_nodes calls work
                    request.Nodes.Add(new DiagramNodeSnapshot { Id = id, TypeKey = typeKey, Name = name });

                    return ($"Added node id={id}", new DiagramAction
                    {
                        Type = "add_node", Id = id, TypeKey = typeKey, Name = name, X = x, Y = y,
                    });
                }

                case "connect_nodes":
                {
                    var src = args.RootElement.TryGetProperty("sourceId", out var s) ? s.GetString() ?? "" : "";
                    var tgt = args.RootElement.TryGetProperty("targetId", out var t) ? t.GetString() ?? "" : "";
                    if (string.IsNullOrWhiteSpace(src) || string.IsNullOrWhiteSpace(tgt))
                        return ("Missing sourceId or targetId.", null);

                    request.Edges.Add(new DiagramEdgeSnapshot { Source = src, Target = tgt });
                    return ("ok", new DiagramAction { Type = "connect_nodes", SourceId = src, TargetId = tgt });
                }

                case "remove_node":
                {
                    var id = args.RootElement.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "";
                    if (string.IsNullOrWhiteSpace(id)) return ("Missing id.", null);
                    request.Nodes.RemoveAll(n => n.Id == id);
                    request.Edges.RemoveAll(e => e.Source == id || e.Target == id);
                    return ("ok", new DiagramAction { Type = "remove_node", Id = id });
                }

                case "clear_diagram":
                {
                    request.Nodes.Clear();
                    request.Edges.Clear();
                    return ("ok", new DiagramAction { Type = "clear_diagram" });
                }

                case "microsoft_docs_search":
                {
                    var q = args.RootElement.TryGetProperty("query", out var qe) ? qe.GetString() ?? "" : "";
                    if (string.IsNullOrWhiteSpace(q)) return ("Empty query.", null);
                    var docs = await _mcp.SearchDocsAsync(q, ct);
                    return (docs, null);
                }

                default:
                    return ($"Unknown tool: {call.FunctionName}", null);
            }
        }
        finally
        {
            args.Dispose();
        }
    }
}
