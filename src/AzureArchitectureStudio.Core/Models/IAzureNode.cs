using AutoMapper;
using AzureArchitectureStudio.Core.DTO;
using Blazor.Diagrams.Core.Models;

namespace AzureArchitectureStudio.Core.Models
{
    public interface IAzureNode
    {
        string ServiceName { get; }
        Type? DataFormType { get; }
        string CssClassName { get; }
        bool IsValid { get; }
        bool DataFormNoPadding { get; }
        string ImagePath { get; set; }
        AzureNodeDto GetNodeDto(IMapper mapper);
        (bool result, string message) IsDrappable(GroupModel overlappedGroup);
    }
}
