using System.Text.Json.Serialization;

namespace AzureArchitectureStudio.Server.Models;

/// <summary>Azure OpenAI connection settings supplied per-request by the client.</summary>
public class OpenAISettings
{
    public string? Endpoint { get; set; }
    public string? Deployment { get; set; }
    public string? ApiKey { get; set; }
}

public class ChatTurn
{
    /// <summary>"user" or "assistant".</summary>
    public string Role { get; set; } = "user";
    public string Content { get; set; } = string.Empty;
}

/// <summary>A node already on the canvas, sent so the AI knows what it can reference.</summary>
public class DiagramNodeSnapshot
{
    public string Id { get; set; } = string.Empty;
    public string TypeKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    /// <summary>Id of the containing group node, if any.</summary>
    public string? ParentId { get; set; }
}

public class DiagramEdgeSnapshot
{
    public string Source { get; set; } = string.Empty;
    public string Target { get; set; } = string.Empty;
}

public class AvailableService
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;

    /// <summary>
    /// Required and optional dependencies for this resource type. The server
    /// uses this to evaluate whether a freshly-added node is missing any
    /// required references (e.g. a Private Endpoint needs a subnet + a
    /// Private DNS Zone) and surfaces that back to the model so it can fix
    /// it up in the next tool call.
    /// </summary>
    public List<ServiceDependency> Dependencies { get; set; } = new();
}

/// <summary>
/// Mirror of the client-side <c>ResourceDependencyDef</c>. Tells the chat
/// service what other resources a given type expects to be wired up to.
/// </summary>
public class ServiceDependency
{
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string TargetType { get; set; } = string.Empty;
    public bool Required { get; set; }
    public bool AutoFromParent { get; set; }
    public string? Hint { get; set; }
    /// <summary>One or more exact names the resolved target must have (e.g. "AzureBastionSubnet").</summary>
    public List<string> RequiredName { get; set; } = new();
    /// <summary>
    /// One-hop intermediary type keys that "wrap" <see cref="TargetType"/>.
    /// Lets a Virtual Machine's subnet dep be satisfied via a network-interface,
    /// for example, when the VM is connected to a NIC and the NIC sits in a
    /// subnet.
    /// </summary>
    public List<string> AcceptVia { get; set; } = new();
}

public class ChatRequest
{
    public OpenAISettings? Settings { get; set; }
    public List<ChatTurn> History { get; set; } = new();
    public string Message { get; set; } = string.Empty;
    public List<DiagramNodeSnapshot> Nodes { get; set; } = new();
    public List<DiagramEdgeSnapshot> Edges { get; set; } = new();
    public List<AvailableService> AvailableServices { get; set; } = new();
}

/// <summary>An action the client should apply to the diagram after rendering the assistant message.</summary>
public class DiagramAction
{
    /// <summary>"add_node" | "connect_nodes" | "remove_node" | "clear_diagram".</summary>
    public string Type { get; set; } = string.Empty;
    public string? Id { get; set; }
    public string? TypeKey { get; set; }
    public string? Name { get; set; }
    public double? X { get; set; }
    public double? Y { get; set; }
    public string? SourceId { get; set; }
    public string? TargetId { get; set; }
    /// <summary>For add_node: id of the parent group node so the new node is placed inside it.</summary>
    public string? ParentId { get; set; }
}

public class ChatResponse
{
    public string Message { get; set; } = string.Empty;
    public List<DiagramAction> Actions { get; set; } = new();
    public bool Success { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// A progress event emitted during a streaming chat session. The client
/// renders these in the "thinking" indicator so the user can see what
/// the model is doing in real time (which tool it's calling, what came
/// back, etc.) instead of staring at a spinner.
/// </summary>
public class ChatProgressEvent
{
    /// <summary>
    /// One of:
    ///   "thinking"      — model is starting a new reasoning round.
    ///   "tool_call"     — a tool is being invoked.
    ///   "tool_result"   — the tool returned (Detail = short result string).
    ///   "docs_search"   — Microsoft Learn search summary.
    ///   "info"          — generic informational message.
    ///   "assistant"     — final assistant text reply (Detail = the message).
    ///   "action"        — a diagram action that should be applied (Action populated).
    ///   "done"          — final event; carries the full message + actions in case the
    ///                     client wants to confirm via the standard ChatResponse shape.
    /// </summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Short headline shown in the activity log (e.g. "Adding management group").</summary>
    public string? Title { get; set; }

    /// <summary>Optional secondary detail (tool args, result snippet, etc.).</summary>
    public string? Detail { get; set; }

    /// <summary>Populated when Kind == "action".</summary>
    public DiagramAction? Action { get; set; }

    /// <summary>Populated when Kind == "done".</summary>
    public ChatResponse? Final { get; set; }
}
