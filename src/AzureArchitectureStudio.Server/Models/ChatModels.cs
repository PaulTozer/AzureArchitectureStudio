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
