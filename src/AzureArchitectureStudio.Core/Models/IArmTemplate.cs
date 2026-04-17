using AzureArchitectureStudio.AzureResources.Base;

namespace AzureArchitectureStudio.Core.Models
{
    public interface IArmTemplate
    {
        DeploymentTemplate Template { get; }
    }
}
