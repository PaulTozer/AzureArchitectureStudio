using AzureArchitectureStudio.Core.APIM;
using AzureArchitectureStudio.Core.Models;
using AzureArchitectureStudio.Core.Network;
using System.Collections.Generic;
using System.Threading.Tasks;
using Xunit;

namespace AzureArchitectureStudio.Core.Tests
{
    public class ApiMTests : TestBase
    {
        public ApiMTests() : base() { }

        [Fact]
        public async Task APIMWithVnetTest()
        {
            var armTemplate = new ArmTemplate();

            var vnet = new VirtualNetworkModel()
            {
                Name = "apim-vnet",
                IpSpace = new List<AddressSpace>
                {
                    new AddressSpace
                    {
                        AddressPrefix = "192.168.0.0/16"
                    }
                }
            };
            var subnet = vnet.AddSubnet(new()
            {
                Name = "ApimSubnet",
                AddressPrefix = "192.168.0.0/24"
            });

            var APIM = new APIMModel()
            {
                Name = "api-management",
                VnetType = "External",
                PublisherName = "James Bond",
                PublisherEmail = "jbond@example.com"
            };
            subnet.AddChild(APIM);

            armTemplate.AddResource(vnet.GetArmResources());
            armTemplate.AddResource(APIM.GetArmResources());

            await ValidateTemplate(armTemplate);
        }
    }
}
