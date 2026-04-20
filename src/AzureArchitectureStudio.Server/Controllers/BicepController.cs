using AzureArchitectureStudio.Services;
using Microsoft.AspNetCore.Mvc;

namespace AzureArchitectureStudio.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class BicepController : ControllerBase
{
    private readonly IAdsBicepDecompiler _decompiler;

    public BicepController(IAdsBicepDecompiler decompiler)
    {
        _decompiler = decompiler;
    }

    [HttpPost("decompile")]
    public async Task<IActionResult> Decompile([FromBody] BicepDecompileDto dto)
    {
        var result = await _decompiler.Decompile(dto.ArmTemplate);

        if (result.Error is not null)
        {
            return Ok(new { error = result.Error });
        }

        return Ok(new { bicepFile = result.BicepFile });
    }
}

public class BicepDecompileDto
{
    public string ArmTemplate { get; set; } = string.Empty;
}
