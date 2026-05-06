using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using AzureArchitectureStudio.Server.Models;
using AzureArchitectureStudio.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AzureArchitectureStudio.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous] // user supplies their own Azure OpenAI credentials in the request
public class ChatController : ControllerBase
{
    private readonly IChatService _chat;

    public ChatController(IChatService chat)
    {
        _chat = chat;
    }

    [HttpPost]
    public async Task<ActionResult<ChatResponse>> Post([FromBody] ChatRequest request, CancellationToken ct)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Message))
        {
            return BadRequest(new ChatResponse { Success = false, Error = "Message is required." });
        }

        var response = await _chat.ChatAsync(request, ct);
        return Ok(response);
    }

    /// <summary>
    /// Streaming variant — emits Server-Sent Events as the model reasons,
    /// so the UI can show live progress (which tool is running, intermediate
    /// results, etc.) instead of waiting for one big response. Each event
    /// is a single JSON-encoded <see cref="ChatProgressEvent"/>.
    /// </summary>
    [HttpPost("stream")]
    public async Task PostStream([FromBody] ChatRequest request, CancellationToken ct)
    {
        Response.StatusCode = 200;
        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";
        // Disable buffering on common reverse-proxy stacks so events arrive immediately.
        Response.Headers["X-Accel-Buffering"] = "no";

        var jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        };

        async Task WriteEventAsync(ChatProgressEvent evt)
        {
            var json = JsonSerializer.Serialize(evt, jsonOptions);
            // SSE format: `data: <line>\n\n`. Newlines inside the payload
            // would split the frame, so escape them; JSON serialisation
            // already does this for us.
            var bytes = Encoding.UTF8.GetBytes($"data: {json}\n\n");
            await Response.Body.WriteAsync(bytes, ct);
            await Response.Body.FlushAsync(ct);
        }

        if (request is null || string.IsNullOrWhiteSpace(request.Message))
        {
            await WriteEventAsync(new ChatProgressEvent
            {
                Kind = "done",
                Final = new ChatResponse { Success = false, Error = "Message is required." },
            });
            return;
        }

        // We can't use IProgress<T> with an async lambda directly — those
        // are fire-and-forget, so writes can interleave with the chat
        // method returning and the response being closed. Instead, push
        // events into an unbounded channel and drain them inline on a
        // background task that we explicitly await before returning.
        var channel = Channel.CreateUnbounded<ChatProgressEvent>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pump = Task.Run(async () =>
        {
            try
            {
                await foreach (var evt in channel.Reader.ReadAllAsync(ct))
                {
                    await WriteEventAsync(evt);
                }
            }
            catch (OperationCanceledException) { /* client gone */ }
        }, CancellationToken.None);

        var progress = new Progress<ChatProgressEvent>(evt =>
        {
            // Synchronous: just enqueue. The pump task does the actual writes.
            channel.Writer.TryWrite(evt);
        });

        try
        {
            await _chat.ChatAsync(request, progress, ct);
        }
        catch (OperationCanceledException)
        {
            // Client went away — silently end the stream.
        }
        catch (Exception ex)
        {
            channel.Writer.TryWrite(new ChatProgressEvent
            {
                Kind = "done",
                Final = new ChatResponse { Success = false, Error = ex.Message, Message = "Chat failed." },
            });
        }
        finally
        {
            // Signal the pump that no more events are coming and wait for
            // it to flush them all before the response stream closes.
            channel.Writer.TryComplete();
            try { await pump; } catch { /* swallow — already responded */ }
        }
    }
}
