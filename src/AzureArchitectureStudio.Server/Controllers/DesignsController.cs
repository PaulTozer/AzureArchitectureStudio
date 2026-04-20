using AzureArchitectureStudio.Server.Models;
using AzureArchitectureStudio.Server.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Web.Resource;

namespace AzureArchitectureStudio.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[RequiredScope(RequiredScopesConfigurationKey = "AzureAdB2C:Scopes")]
public class DesignsController : ControllerBase
{
    private readonly DesignDbContext _db;
    private readonly ILogger<DesignsController> _logger;

    public DesignsController(DesignDbContext db, ILogger<DesignsController> logger)
    {
        _db = db;
        _db.Database.EnsureCreated();
        _logger = logger;
    }

    private Guid? GetUserId()
    {
        var oid = User.FindFirst("oid")?.Value ?? User.FindFirst("http://schemas.microsoft.com/identity/claims/objectidentifier")?.Value;
        return oid is not null ? new Guid(oid) : null;
    }

    [HttpGet]
    public IActionResult GetSaved()
    {
        var userId = GetUserId();
        if (userId is null) return Unauthorized();

        var names = _db.AdsDesigns
            .Where(d => d.UserId == userId.Value)
            .Select(d => d.Name)
            .ToList();

        return Ok(new { names });
    }

    [HttpGet("{name}")]
    public async Task<IActionResult> Load(string name)
    {
        var userId = GetUserId();
        if (userId is null) return Unauthorized();

        if (!ServiceTools.IsValidName(name)) return BadRequest();

        var design = await _db.AdsDesigns
            .FirstOrDefaultAsync(d => d.UserId == userId.Value && d.Name == name);

        if (design is null) return NotFound();

        return Ok(new { data = design.DesignData });
    }

    [HttpPost]
    public async Task<IActionResult> Save([FromBody] SaveDesignDto dto)
    {
        var userId = GetUserId();
        if (userId is null) return Unauthorized();

        if (!ServiceTools.IsValidName(dto.Name)) return BadRequest();

        // Check quota
        var count = _db.AdsDesigns.Count(d => d.UserId == userId.Value);
        if (count >= 10) return StatusCode(507);

        var design = await _db.AdsDesigns
            .FirstOrDefaultAsync(d => d.UserId == userId.Value && d.Name == dto.Name);

        if (design is null)
        {
            design = new DesignModel
            {
                Name = dto.Name,
                UserId = userId.Value,
                DesignData = dto.Data,
                LastModified = DateTime.UtcNow,
            };
            _db.AdsDesigns.Add(design);
        }
        else
        {
            design.DesignData = dto.Data;
            design.LastModified = DateTime.UtcNow;
            _db.AdsDesigns.Update(design);
        }

        await _db.SaveChangesAsync();
        return Ok();
    }

    [HttpDelete("{name}")]
    public async Task<IActionResult> Delete(string name)
    {
        var userId = GetUserId();
        if (userId is null) return Unauthorized();

        if (!ServiceTools.IsValidName(name)) return BadRequest();

        var design = await _db.AdsDesigns
            .FirstOrDefaultAsync(d => d.UserId == userId.Value && d.Name == name);

        if (design is null) return NotFound();

        _db.AdsDesigns.Remove(design);
        await _db.SaveChangesAsync();
        return Ok();
    }
}

public class SaveDesignDto
{
    public string Name { get; set; } = string.Empty;
    public string Data { get; set; } = string.Empty;
}
