using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace AzureArchitectureStudio.Server.Services;

/// <summary>
/// Minimal client for the public Microsoft Learn MCP server.
/// Speaks JSON-RPC 2.0 over a single POST and parses either application/json or
/// text/event-stream framed responses (Streamable HTTP transport).
/// Only the tools/call method for "microsoft_docs_search" is needed today.
/// </summary>
public interface IMicrosoftLearnMcpClient
{
    Task<string> SearchDocsAsync(string query, CancellationToken ct = default);
}

public class MicrosoftLearnMcpClient : IMicrosoftLearnMcpClient
{
    private const string McpEndpoint = "https://learn.microsoft.com/api/mcp";
    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<MicrosoftLearnMcpClient> _logger;
    private int _requestId;

    public MicrosoftLearnMcpClient(IHttpClientFactory httpFactory, ILogger<MicrosoftLearnMcpClient> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    public async Task<string> SearchDocsAsync(string query, CancellationToken ct = default)
    {
        var rpc = new
        {
            jsonrpc = "2.0",
            id = Interlocked.Increment(ref _requestId),
            method = "tools/call",
            @params = new
            {
                name = "microsoft_docs_search",
                arguments = new { query }
            }
        };

        try
        {
            var client = _httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(30);

            using var req = new HttpRequestMessage(HttpMethod.Post, McpEndpoint)
            {
                Content = new StringContent(JsonSerializer.Serialize(rpc), Encoding.UTF8, "application/json")
            };
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

            using var resp = await client.SendAsync(req, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);

            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("MS Learn MCP returned {Status}: {Body}", resp.StatusCode, body);
                return $"Microsoft Learn search unavailable ({(int)resp.StatusCode}).";
            }

            // SSE framing: pull "data:" lines and concatenate
            var json = body;
            if ((resp.Content.Headers.ContentType?.MediaType ?? "").Contains("event-stream", StringComparison.OrdinalIgnoreCase)
                || body.StartsWith("event:") || body.StartsWith("data:"))
            {
                var sb = new StringBuilder();
                foreach (var line in body.Split('\n'))
                {
                    var t = line.TrimEnd('\r');
                    if (t.StartsWith("data:", StringComparison.Ordinal))
                        sb.Append(t.AsSpan(5).TrimStart());
                }
                json = sb.ToString();
            }

            // JSON-RPC envelope: { "result": { "content": [ { "type":"text", "text": "..." } ] } }
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("result", out var result)
                && result.TryGetProperty("content", out var contentArr)
                && contentArr.ValueKind == JsonValueKind.Array)
            {
                var sb = new StringBuilder();
                foreach (var item in contentArr.EnumerateArray())
                {
                    if (item.TryGetProperty("text", out var text))
                        sb.AppendLine(text.GetString());
                }
                var combined = sb.ToString().Trim();
                if (combined.Length > 8000) combined = combined[..8000] + "\n…(truncated)";
                return string.IsNullOrWhiteSpace(combined) ? "No results." : combined;
            }

            if (doc.RootElement.TryGetProperty("error", out var err))
                return $"Microsoft Learn MCP error: {err}";

            return "No results.";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to call Microsoft Learn MCP");
            return $"Microsoft Learn search failed: {ex.Message}";
        }
    }
}
