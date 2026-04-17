using AzureArchitectureStudio;
using AzureArchitectureStudio.Core.DTO;
using AzureArchitectureStudio.Services;
using AzureArchitectureStudio.SharedModels.Protos;
using Grpc.Net.Client.Web;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Authentication;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddHttpClient("AzureArchitectureStudio.Root",
    client => client.BaseAddress = new Uri(builder.HostEnvironment.BaseAddress));
builder.Services.AddHttpClient("AzureArchitectureStudio.ResourceAccess", 
    client => client.BaseAddress = new Uri(builder.HostEnvironment.BaseAddress));
// AAD B2C Authentication
builder.Services.AddHttpClient("AzureArchitectureStudio.ServerAPI", client => client.BaseAddress = new Uri(builder.HostEnvironment.BaseAddress))
    .AddHttpMessageHandler<BaseAddressAuthorizationMessageHandler>();
builder.Services.AddScoped(sp => sp.GetRequiredService<IHttpClientFactory>().CreateClient("AzureArchitectureStudio.ServerAPI"));
builder.Services.AddMsalAuthentication(options =>
{
    builder.Configuration.Bind("AzureAdB2C", options.ProviderOptions.Authentication);
    options.ProviderOptions.DefaultAccessTokenScopes.Add(builder.Configuration.GetValue<string>("B2CScope")!);
});

builder.Logging.AddConfiguration(builder.Configuration.GetSection("Logging"));
// Grpc
builder.Services.AddScoped<DesignGrpcService>();
builder.Services.AddGrpcClient<Design.DesignClient>("DesignClientWithAuth", o =>
{
    o.Address = new Uri(builder.HostEnvironment.BaseAddress);
}).ConfigurePrimaryHttpMessageHandler(() =>
{
    var baseAddressMessageHandler = builder.Services.BuildServiceProvider().GetRequiredService<BaseAddressAuthorizationMessageHandler>();
    baseAddressMessageHandler.InnerHandler = new HttpClientHandler();
    return new GrpcWebHandler(GrpcWebMode.GrpcWeb, baseAddressMessageHandler);
});
builder.Services.AddScoped<DeployGrpcService>();
builder.Services.AddGrpcClient<Deploy.DeployClient>("DeployClientWithAuth", o =>
{
    o.Address = new Uri(builder.HostEnvironment.BaseAddress);
}).ConfigurePrimaryHttpMessageHandler(() =>
{
    var baseAddressMessageHandler = builder.Services.BuildServiceProvider().GetRequiredService<BaseAddressAuthorizationMessageHandler>();
    baseAddressMessageHandler.InnerHandler = new HttpClientHandler();
    return new GrpcWebHandler(GrpcWebMode.GrpcWeb, baseAddressMessageHandler);
});

builder.Services.AddAntDesign();
builder.Services.AddSingleton<AdsContext>();
builder.Services.AddAutoMapper(cfg => cfg.AddMaps(typeof(AzureNodeProfile).Assembly));
// Bicep decompiler service
builder.Services.AddAdsBicepDecompiler();

var host = builder.Build();

var adsContext = host.Services.GetRequiredService<AdsContext>();
await adsContext.InitializeAsync();

await host.RunAsync();
