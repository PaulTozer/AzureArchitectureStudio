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
}
