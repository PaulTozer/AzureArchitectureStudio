// Licensed under the MIT License. See LICENSE in the project root for license information.

using System.CodeDom.Compiler;
using System.Text.Json.Serialization;

namespace AzureArchitectureStudio.AzureResources.Storage
{
    /// <summary>
    /// KeyCreationTime
    /// </summary>
    [GeneratedCode("ArmTypeGenerator", "0.2.1.52938")]
    public partial class KeyCreationTime
    {
        [JsonPropertyName("key1")]
        public string Key1 { get; set; }
        [JsonPropertyName("key2")]
        public string Key2 { get; set; }
    }
}