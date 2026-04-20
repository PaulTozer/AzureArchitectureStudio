using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Headers;
using System.Text.Json;

namespace AzureArchitectureStudio.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AzureServicesController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<AzureServicesController> _logger;

    public AzureServicesController(IHttpClientFactory httpClientFactory, ILogger<AzureServicesController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <summary>
    /// Proxy to Azure Management API to list resource providers and their resource types.
    /// Requires the caller to pass an Azure access token in the Authorization header.
    /// </summary>
    [HttpGet("resource-types")]
    public async Task<IActionResult> GetResourceTypes([FromQuery] string? apiVersion = "2021-04-01")
    {
        var authHeader = Request.Headers.Authorization.ToString();
        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return Unauthorized(new { error = "Azure access token required. Pass a Bearer token for https://management.azure.com/ in the Authorization header." });
        }

        var token = authHeader["Bearer ".Length..];

        try
        {
            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var url = $"https://management.azure.com/providers?api-version={apiVersion}&$expand=resourceTypes";
            var response = await client.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("Azure API returned {StatusCode}: {Body}", response.StatusCode, errorBody);
                return StatusCode((int)response.StatusCode, new { error = "Azure API request failed", details = errorBody });
            }

            var json = await response.Content.ReadAsStringAsync();
            return Content(json, "application/json");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch resource types from Azure Management API");
            return StatusCode(500, new { error = "Failed to fetch resource types" });
        }
    }

    /// <summary>
    /// Proxy to Azure Support Services API — lists all Azure services with display names.
    /// </summary>
    [HttpGet("support-services")]
    public async Task<IActionResult> GetSupportServices([FromQuery] string? apiVersion = "2024-04-01")
    {
        var authHeader = Request.Headers.Authorization.ToString();
        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return Unauthorized(new { error = "Azure access token required." });
        }

        var token = authHeader["Bearer ".Length..];

        try
        {
            var client = _httpClientFactory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var url = $"https://management.azure.com/providers/Microsoft.Support/services?api-version={apiVersion}";
            var response = await client.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("Azure Support API returned {StatusCode}: {Body}", response.StatusCode, errorBody);
                return StatusCode((int)response.StatusCode, new { error = "Azure API request failed", details = errorBody });
            }

            var json = await response.Content.ReadAsStringAsync();
            return Content(json, "application/json");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch support services from Azure Management API");
            return StatusCode(500, new { error = "Failed to fetch support services" });
        }
    }
}
