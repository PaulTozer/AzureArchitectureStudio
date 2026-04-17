using AzureArchitectureStudio.AzureResources.Base;
using AzureArchitectureStudio.AzureResources.Compute;
using AzureArchitectureStudio.Core.Models;
using Blazor.Diagrams.Core.Models;

namespace AzureArchitectureStudio.Core.Compute
{
    public class VirtualMachineModel : AzureNodeBase
    {
        public VirtualMachineModel()
        {
            AddPort(PortAlignment.Left);
            AddPort(PortAlignment.Top);
            AddPort(PortAlignment.Right);
            AddPort(PortAlignment.Bottom);
        }
        public override string ServiceName => "Virtual Machine";
        public override Type? DataFormType => typeof(VirtualMachineForm);
        private readonly VirtualMachines _vm = new();
        protected override ResourceBase ArmResource => _vm;
    }
}
