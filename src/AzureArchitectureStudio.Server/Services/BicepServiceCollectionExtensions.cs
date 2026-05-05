using Bicep.Core;
using Bicep.Core.Analyzers.Interfaces;
using Bicep.Core.Analyzers.Linter;
using Bicep.Core.Analyzers.Linter.ApiVersions;
using Bicep.Core.Features;
using Bicep.Core.FileSystem;
using Bicep.Core.Registry;
using Bicep.Core.Registry.Auth;
using Bicep.Core.Semantics.Namespaces;
using Bicep.Core.TypeSystem.Az;
using Bicep.Decompiler;
using System.IO.Abstractions;
using System.IO.Abstractions.TestingHelpers;

namespace AzureArchitectureStudio.Server.Services;

public static class BicepServiceCollectionExtensions
{
    public static IServiceCollection AddAdsBicepDecompiler(this IServiceCollection services) => services
        .AddSingleton<INamespaceProvider, DefaultNamespaceProvider>()
        .AddSingleton<IAzResourceTypeLoader, AzResourceTypeLoader>()
        .AddSingleton<IModuleDispatcher, ModuleDispatcher>()
        .AddSingleton<IModuleRegistryProvider, EmptyModuleRegistryProvider>()
        .AddSingleton<ITokenCredentialFactory, TokenCredentialFactory>()
        .AddSingleton<IFileResolver, FileResolver>()
        .AddSingleton<IFileSystem, MockFileSystem>()
        .AddSingleton<Bicep.Core.Configuration.IConfigurationManager, Bicep.Core.Configuration.ConfigurationManager>()
        .AddSingleton<IApiVersionProviderFactory, ApiVersionProviderFactory>()
        .AddSingleton<IBicepAnalyzer, LinterAnalyzer>()
        .AddSingleton<IFeatureProviderFactory, FeatureProviderFactory>()
        .AddSingleton<ILinterRulesProvider, LinterRulesProvider>()
        .AddSingleton<BicepCompiler>()
        .AddSingleton<BicepDecompiler>()
        .AddSingleton<IAdsBicepDecompiler, AdsBicepDecompiler>();
}
