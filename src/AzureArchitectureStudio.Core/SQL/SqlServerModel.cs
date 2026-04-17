using AutoMapper;
using AzureArchitectureStudio.AzureResources.Base;
using AzureArchitectureStudio.AzureResources.Sql;
using AzureArchitectureStudio.Core.Attributes;
using AzureArchitectureStudio.Core.Common;
using AzureArchitectureStudio.Core.DTO;
using AzureArchitectureStudio.Core.Models;
using Blazor.Diagrams.Core.Models;

namespace AzureArchitectureStudio.Core.SQL
{
    [MapToDto(TypeKey = AdsConstants.SqlServer)]
    public class SqlServerModel : AzureGroupBase
    {
        public override GroupStyle GroupStyle
        {
            get => new()
            {
                OutlineWidth = 1,
                OutlineStyle = "solid",
                OutlineColor = "#8c8c8c"
            };
        }

        public override (bool result, string message) IsDrappable(GroupModel overlappedGroup)
        {
            if (overlappedGroup is IAzureNode n)
                return (false, $"Azure SQL Server cannot be deployed in the {n.ServiceName}.");

            return (true, string.Empty);
        }
        public override AzureNodeDto GetNodeDto(IMapper mapper)
        {
            return mapper.Map<SqlServerModelDto>(this);
        }
        public override string ServiceName => "Azure SQL Server";
        public override Type? DataFormType => typeof(SqlServerForm);
        private readonly Servers _servers = new();
        protected override ResourceBase ArmResource => _servers;

        public override IDictionary<string, Parameter> GetArmParameters()
        {
            var sqlAdmin = new Parameter
            {
                Type = "string",
                Metadata = new Dictionary<string, string>()
                {
                    {"description", "User name of the administrator of the SQL server." }
                }
            };
            var adminPassword = new Parameter
            {
                Type = "secureString",
                Metadata = new Dictionary<string, string>()
                {
                    {"description", "Password of the administrator of the SQL server." }
                }
            };

            return new Dictionary<string, Parameter>
            {
                {"sqlAdmin", sqlAdmin },
                {"sqlAdminPassword", adminPassword }
            };
        }

        protected override void PopulateArmAttributes()
        {
            base.PopulateArmAttributes();

            _servers.Properties = new()
            {
                AdministratorLogin = "[parameters('sqlAdmin')]",
                AdministratorLoginPassword = "[parameters('sqlAdminPassword')]"
            };
        }
    }
}
