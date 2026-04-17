using System;
using System.Collections.Generic;
using System.Text;

namespace AzureArchitectureStudio.SourceGeneration.Models
{
    internal class MapModel
    {
        public string TypeKey { get; set; } = default!;
        public string SourceType { get; set; } = default!;
        public string DestinationType { get; set; } = default!;
    }
    internal class MapProfileModel
    {
        public IList<MapModel> Maps { get; set; } = default!;
        public HashSet<string> Usings { get; set; } = default!;
        public string Namespace { get; set; } = default!;
    }
}
