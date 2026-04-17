using AzureArchitectureStudio.AzureResources.Base;
using AzureArchitectureStudio.AzureResources.Network;
using AzureArchitectureStudio.Core.Attributes;
using AzureArchitectureStudio.Core.Models;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace AzureArchitectureStudio.Core.Network
{
    [MapToDto]
    public class FirewallPolicyModel : IAzureResource
    {
        public string ResourceId => $"[resourceId('{ArmResource.Type}', '{Name}')]";
        private readonly FirewallPolicies _firewallPolicy = new();
        public ResourceBase ArmResource => _firewallPolicy;
        [Required, DisplayName("Name")]
        public string Name { get; set; } = "fw-policies";
        public string Location
        {
            get => UseResourceGroupLocation ? "[parameters('location')]" : ArmResource.Location;
            set => ArmResource.Location = value;
        }
        public bool UseResourceGroupLocation { get; set; } = true;
        [MapToDto]
        [DisplayName("SKU")]
        public string Sku { get; set; } = "Premium";

        public IList<ResourceBase> GetArmResources()
        {
            _firewallPolicy.Name = Name;
            _firewallPolicy.Location = Location;
            _firewallPolicy.Properties = new()
            {
                Sku = new()
                {
                    Tier = Sku
                },
            };

            return new List<ResourceBase>()
            {
                _firewallPolicy,
            };
        }

        public IDictionary<string, Parameter> GetArmParameters()
        {
            return new Dictionary<string, Parameter>();
        }
    }
}
