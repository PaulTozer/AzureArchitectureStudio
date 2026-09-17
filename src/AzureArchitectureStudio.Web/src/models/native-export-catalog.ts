import type { AzureEdge, AzureNode } from './diagram';
import { ExportExpression, findExportDependency, type ExportResource, type NativeExportPlan } from './native-export';
import { resolveKey } from './resource-registry';

export const extendedDefinitions: Record<string, { terraform: string; avm: string }> = {
  'Microsoft.Compute/virtualMachines': { terraform: 'azurerm_linux_virtual_machine', avm: 'compute/virtual-machine:0.22.3' },
  'Microsoft.Compute/disks': { terraform: 'azurerm_managed_disk', avm: 'compute/disk:0.6.1' },
  'Microsoft.Network/azureFirewalls': { terraform: 'azurerm_firewall', avm: 'network/azure-firewall:0.11.1' },
  'Microsoft.Network/bastionHosts': { terraform: 'azurerm_bastion_host', avm: 'network/bastion-host:0.8.2' },
  'Microsoft.Sql/servers': { terraform: 'azurerm_mssql_server', avm: 'sql/server:0.22.1' },
  'Microsoft.Sql/servers/databases': { terraform: 'azurerm_mssql_database', avm: 'sql/server:0.22.1' },
  'Microsoft.Web/serverfarms': { terraform: 'azurerm_service_plan', avm: 'web/serverfarm:0.7.0' },
  'Microsoft.Web/sites': { terraform: 'azurerm_linux_web_app', avm: 'web/site:0.24.0' },
  'Microsoft.ContainerService/managedClusters': { terraform: 'azurerm_kubernetes_cluster', avm: 'container-service/managed-cluster:0.14.0' },
  'Microsoft.ApiManagement/service': { terraform: 'azurerm_api_management', avm: 'api-management/service:0.14.4' },
  'Microsoft.Network/applicationGateways': { terraform: 'azurerm_application_gateway', avm: 'network/application-gateway:0.10.0' },
  'Microsoft.Network/loadBalancers': { terraform: 'azurerm_lb', avm: 'network/load-balancer:0.8.0' },
  'Microsoft.DocumentDB/databaseAccounts': { terraform: 'azurerm_cosmosdb_account', avm: 'document-db/database-account:0.21.1' },
  'Microsoft.Cache/redis': { terraform: 'azurerm_redis_cache', avm: 'cache/redis:0.18.0' },
  'Microsoft.ServiceBus/namespaces': { terraform: 'azurerm_servicebus_namespace', avm: 'service-bus/namespace:0.17.0' },
  'Microsoft.EventHub/namespaces': { terraform: 'azurerm_eventhub_namespace', avm: 'event-hub/namespace:0.15.0' },
  'Microsoft.Insights/components': { terraform: 'azurerm_application_insights', avm: 'insights/component:0.8.0' },
  'Microsoft.Network/dnsZones': { terraform: 'azurerm_dns_zone', avm: 'network/dns-zone:0.6.2' },
  'Microsoft.Cdn/profiles': { terraform: 'azurerm_cdn_frontdoor_profile', avm: 'cdn/profile:0.20.0' },
  'Microsoft.Network/virtualNetworkGateways': { terraform: 'azurerm_virtual_network_gateway', avm: 'network/virtual-network-gateway:0.10.0' },
  'Microsoft.Web/staticSites': { terraform: 'azurerm_static_web_app', avm: 'web/static-site:0.9.6' },
  'Microsoft.SignalRService/signalR': { terraform: 'azurerm_signalr_service', avm: 'signal-r-service/signal-r:0.11.0' },
  'Microsoft.DBforMySQL/flexibleServers': { terraform: 'azurerm_mysql_flexible_server', avm: 'db-for-my-sql/flexible-server:0.11.0' },
  'Microsoft.DBforPostgreSQL/flexibleServers': { terraform: 'azurerm_postgresql_flexible_server', avm: 'db-for-postgre-sql/flexible-server:0.16.0' },
  'Microsoft.Network/networkInterfaces': { terraform: 'azurerm_network_interface', avm: 'network/network-interface:0.6.0' },
  'Microsoft.Network/natGateways': { terraform: 'azurerm_nat_gateway', avm: 'network/nat-gateway:2.1.1' },
  'Microsoft.Network/privateEndpoints': { terraform: 'azurerm_private_endpoint', avm: 'network/private-endpoint:0.12.1' },
};

interface MappingContext {
  resource: ExportResource;
  resources: ExportResource[];
  nodes: AzureNode[];
  edges: AzureEdge[];
  plan: NativeExportPlan;
  terraform: Record<string, unknown>;
  bicep: Record<string, unknown>;
  mapped: string[];
  target: 'terraform' | 'bicep';
  field: (key: string, terraformKey: string, bicepKey: string, terraformValue?: unknown, bicepValue?: unknown) => void;
  input: (name: string, description: string, options?: Omit<NativeExportPlan['inputs'][string], 'description'>) => ExportExpression;
  reference: (resource: ExportResource, attribute?: string, output?: string) => ExportExpression;
  dependency: (resource: ExportResource, type: string, field: string) => ExportExpression;
  subnetReference: (resource: ExportResource) => ExportExpression | undefined;
}

export function extendResourceMapping(context: MappingContext): void {
  const { resource, terraform, bicep, mapped, field, input, dependency, subnetReference, target } = context;
  const properties = resource.properties;
  const required = (key: string, sensitive = false) => input(`${resource.symbol}_${key}`, `${key} for ${resource.node.data.name}.`, { sensitive });
  const value = (key: string) => properties[key] || required(key);
  const subnet = () => subnetReference(resource) ?? required('subnet_id');
  const identity = (enabled: unknown) => {
    if (enabled) { terraform.identity = [{ type: 'SystemAssigned' }]; bicep.managedIdentities = { systemAssigned: true }; }
  };
  const nativeOnlyUnsupported = (key: string, reason: string) => {
    if (target === 'terraform') throw new Error(`Cannot export ${key} on "${resource.node.data.name}" to native AzureRM: ${reason}`);
  };
  switch (resource.armType) {
    case 'Microsoft.Compute/disks': {
      field('skuName', 'storage_account_type', 'sku');
      field('diskSizeGb', 'disk_size_gb', 'diskSizeGB');
      field('createOption', 'create_option', 'createOption');
      field('diskIopsReadWrite', 'disk_iops_read_write', 'diskIOPSReadWrite');
      field('diskMBpsReadWrite', 'disk_mbps_read_write', 'diskMBpsReadWrite');
      if (!['PremiumV2_LRS', 'UltraSSD_LRS'].includes(String(properties.skuName))) {
        if (properties.diskIopsReadWrite !== 3000 || properties.diskMBpsReadWrite !== 125) throw new Error('Custom disk IOPS/throughput require PremiumV2_LRS or UltraSSD_LRS.');
        delete terraform.disk_iops_read_write;
        delete terraform.disk_mbps_read_write;
        delete bicep.diskIOPSReadWrite;
        delete bicep.diskMBpsReadWrite;
      }
      field('burstingEnabled', 'on_demand_bursting_enabled', 'burstingEnabled');
      field('networkAccessPolicy', 'network_access_policy', 'networkAccessPolicy');
      field('publicNetworkAccess', 'public_network_access_enabled', 'publicNetworkAccess', properties.publicNetworkAccess === 'Enabled');
      field('availabilityZone', 'zone', 'availabilityZone', properties.availabilityZone, Number(properties.availabilityZone || -1));
      if (properties.createOption === 'Copy') terraform.source_resource_id = bicep.sourceResourceId = required('source_resource_id');
      if (properties.createOption === 'Import') {
        terraform.source_uri = bicep.sourceUri = required('source_uri');
        terraform.storage_account_id = bicep.storageAccountId = required('storage_account_id');
      }
      break;
    }
    case 'Microsoft.Sql/servers': {
      mapped.push('version', 'adminLogin', 'adminPassword', 'enableAadAuth', 'aadAdminLogin', 'aadAdminObjectId', 'aadOnlyAuthentication', 'identityType', 'administratorsTenantId');
      terraform.version = properties.version;
      if (properties.version !== '12.0' && target === 'bicep') throw new Error('The SQL AVM module supports server version 12.0 only.');
      if (!properties.aadOnlyAuthentication) {
        terraform.administrator_login = bicep.administratorLogin = value('adminLogin');
        terraform.administrator_login_password = bicep.administratorLoginPassword = required('admin_password', true);
      }
      field('minimalTlsVersion', 'minimum_tls_version', 'minimalTlsVersion');
      field('publicNetworkAccess', 'public_network_access_enabled', 'publicNetworkAccess', properties.publicNetworkAccess === 'Enabled');
      field('restrictOutboundNetworkAccess', 'outbound_network_restriction_enabled', 'restrictOutboundNetworkAccess', properties.restrictOutboundNetworkAccess === 'Enabled');
      if (properties.enableAadAuth || properties.aadOnlyAuthentication) {
        const login = value('aadAdminLogin'), objectId = value('aadAdminObjectId');
        const tenantId = properties.administratorsTenantId || new ExportExpression('var.tenant_id', 'tenant().tenantId');
        if (!properties.administratorsTenantId) input('tenant_id', 'Microsoft Entra tenant ID.', { target: 'terraform' });
        terraform.azuread_administrator = [{ login_username: login, object_id: objectId, tenant_id: tenantId, azuread_authentication_only: properties.aadOnlyAuthentication }];
        bicep.administrators = { administratorType: 'ActiveDirectory', login, sid: objectId, tenantId, azureADOnlyAuthentication: properties.aadOnlyAuthentication,
          principalType: input(`${resource.symbol}_aad_principal_type`, 'Entra SQL administrator principal type: User, Group, or Application.', { target: 'bicep' }) };
      }
      if (properties.identityType !== 'None') {
        const userAssigned = String(properties.identityType).includes('UserAssigned');
        const userId = userAssigned ? value('primaryUserAssignedIdentityId') : undefined;
        terraform.identity = [{ type: properties.identityType, ...(userAssigned ? { identity_ids: [userId] } : {}) }];
        bicep.managedIdentities = { systemAssigned: String(properties.identityType).includes('SystemAssigned'), ...(userAssigned ? { userAssignedResourceIds: [userId] } : {}) };
      }
      field('primaryUserAssignedIdentityId', 'primary_user_assigned_identity_id', 'primaryUserAssignedIdentityResourceId');
      mapped.push('keyId', 'federatedClientId');
      if (properties.keyId) {
        terraform.transparent_data_encryption_key_vault_key_id = properties.keyId;
        const keyUri = String(properties.keyId).split('/');
        bicep.customerManagedKey = { keyVaultResourceId: required('key_vault_resource_id'), keyName: keyUri[4], keyVersion: keyUri[5], autoRotationEnabled: !keyUri[5] };
      }
      if (properties.federatedClientId) { nativeOnlyUnsupported('federatedClientId', 'the provider has no federated client ID field.'); bicep.federatedClientId = properties.federatedClientId; }
      break;
    }
    case 'Microsoft.Sql/servers/databases': {
      delete terraform.location; delete terraform.resource_group_name;
      delete bicep.location; delete bicep.enableTelemetry;
      bicep.availabilityZone = -1;
      if (target === 'terraform') terraform.server_id = dependency(resource, 'Microsoft.Sql/servers', 'server_id');
      const sku = properties.tier === 'Basic' ? 'Basic' : input(`${resource.symbol}_sku_name`, `SKU name within SQL ${properties.tier} tier for ${resource.node.data.name}.`);
      field('tier', 'sku_name', 'sku', sku, { name: sku, tier: properties.tier });
      field('maxSizeGb', 'max_size_gb', 'maxSizeBytes', properties.maxSizeGb, Number(properties.maxSizeGb) * 1024 ** 3);
      field('collation', 'collation', 'collation');
      field('zoneRedundant', 'zone_redundant', 'zoneRedundant');
      field('backupRedundancy', 'storage_account_type', 'requestedBackupStorageRedundancy', ({ Local: 'Local', Zone: 'Zone', Geo: 'Geo', GeoZone: 'GeoZone' } as Record<string, string>)[String(properties.backupRedundancy)]);
      break;
    }
    case 'Microsoft.Web/serverfarms':
      field('skuName', 'sku_name', 'skuName');
      field('os', 'os_type', 'reserved', properties.os === 'windows' ? 'Windows' : 'Linux', properties.os !== 'windows');
      bicep.kind = properties.os === 'windows' ? 'app' : 'linux';
      field('zoneRedundant', 'zone_balancing_enabled', 'zoneRedundant');
      field('instanceCount', 'worker_count', 'skuCapacity');
      break;
    case 'Microsoft.Cache/redis': {
      mapped.push('sku');
      const [skuName, size] = String(properties.sku).split('_');
      terraform.sku_name = bicep.skuName = skuName;
      terraform.family = size[0]; terraform.capacity = bicep.capacity = Number(size.slice(1));
      bicep.availabilityZones = [];
      field('enableNonSslPort', 'non_ssl_port_enabled', 'enableNonSslPort');
      field('minimumTlsVersion', 'minimum_tls_version', 'minimumTlsVersion');
      field('publicNetworkAccess', 'public_network_access_enabled', 'publicNetworkAccess', properties.publicNetworkAccess === 'Enabled');
      break;
    }
    case 'Microsoft.ServiceBus/namespaces':
      mapped.push('sku', 'capacity', 'zoneRedundant');
      terraform.sku = properties.sku;
      terraform.capacity = properties.sku === 'Premium' ? properties.capacity : 0;
      bicep.skuObject = { name: properties.sku, capacity: terraform.capacity };
      bicep.zoneRedundant = properties.zoneRedundant;
      if (properties.zoneRedundant) nativeOnlyUnsupported('zoneRedundant', 'zone redundancy is service-managed; AzureRM no longer exposes this setting.');
      field('minimumTlsVersion', 'minimum_tls_version', 'minimumTlsVersion');
      field('publicNetworkAccess', 'public_network_access_enabled', 'publicNetworkAccess', properties.publicNetworkAccess === 'Enabled');
      break;
    case 'Microsoft.EventHub/namespaces':
      field('sku', 'sku', 'skuName');
      field('capacity', 'capacity', 'skuCapacity');
      field('enableAutoInflate', 'auto_inflate_enabled', 'isAutoInflateEnabled');
      mapped.push('maxThroughputUnits', 'enableKafka');
      if (properties.enableAutoInflate) terraform.maximum_throughput_units = bicep.maximumThroughputUnits = properties.maxThroughputUnits;
      bicep.kafkaEnabled = properties.enableKafka;
      if (properties.enableKafka === false && properties.sku !== 'Basic') nativeOnlyUnsupported('enableKafka=false', 'Kafka is service-managed on non-Basic tiers and cannot be disabled with AzureRM.');
      field('minimumTlsVersion', 'minimum_tls_version', 'minimumTlsVersion');
      break;
    case 'Microsoft.Insights/components':
      field('applicationType', 'application_type', 'applicationType');
      field('retentionDays', 'retention_in_days', 'retentionInDays', Number(properties.retentionDays), Number(properties.retentionDays));
      field('samplingPercentage', 'sampling_percentage', 'samplingPercentage');
      field('disableIpMasking', 'ip_masking_enabled', 'disableIpMasking', !properties.disableIpMasking);
      field('publicNetworkAccess', 'internet_ingestion_enabled', 'publicNetworkAccessForIngestion', properties.publicNetworkAccess === 'Enabled');
      terraform.internet_query_enabled = properties.publicNetworkAccess === 'Enabled';
      bicep.publicNetworkAccessForQuery = properties.publicNetworkAccess;
      terraform.workspace_id = bicep.workspaceResourceId = dependency(resource, 'Microsoft.OperationalInsights/workspaces', 'workspace_id');
      break;
    case 'Microsoft.Network/dnsZones':
      mapped.push('zoneType', 'zoneName');
      if (properties.zoneType !== 'Public') throw new Error('Use the Private DNS zone catalog type for private DNS zones.');
      if (properties.zoneName) terraform.name = bicep.name = properties.zoneName;
      delete terraform.location; bicep.location = 'global';
      break;
    case 'Microsoft.ApiManagement/service': {
      mapped.push('sku', 'capacity', 'publisherEmail', 'publisherName', 'enableManagedIdentity');
      terraform.sku_name = `${properties.sku}_${properties.capacity}`;
      bicep.sku = properties.sku; bicep.skuCapacity = properties.capacity;
      bicep.availabilityZones = [];
      terraform.publisher_email = bicep.publisherEmail = value('publisherEmail');
      terraform.publisher_name = bicep.publisherName = value('publisherName');
      field('virtualNetworkType', 'virtual_network_type', 'virtualNetworkType');
      if (properties.virtualNetworkType !== 'None') { const subnetId = subnet(); terraform.virtual_network_configuration = [{ subnet_id: subnetId }]; bicep.subnetResourceId = subnetId; }
      identity(properties.enableManagedIdentity);
      break;
    }
    case 'Microsoft.DBforMySQL/flexibleServers':
    case 'Microsoft.DBforPostgreSQL/flexibleServers': {
      const mysql = resource.armType === 'Microsoft.DBforMySQL/flexibleServers';
      mapped.push('sku', 'adminLogin', 'adminPassword', 'storageSizeGb', 'highAvailability');
      const sku = String(properties.sku);
      const tier = sku.startsWith('Standard_B') ? 'Burstable' : sku.startsWith('Standard_E') ? 'MemoryOptimized' : 'GeneralPurpose';
      terraform.sku_name = `${tier === 'Burstable' ? 'B' : tier === 'MemoryOptimized' ? 'MO' : 'GP'}_${sku}`;
      bicep.skuName = sku; bicep.tier = tier;
      terraform.administrator_login = bicep.administratorLogin = value('adminLogin');
      terraform.administrator_password = bicep.administratorLoginPassword = required('admin_password', true);
      const zone = input(`${resource.symbol}_zone`, `Availability zone for ${resource.node.data.name}.`, { type: 'number', bicepType: 'int' });
      terraform.zone = new ExportExpression(`tostring(${zone.terraform})`, zone.bicep);
      bicep.availabilityZone = zone;
      field('version', 'version', 'version');
      field('backupRetentionDays', 'backup_retention_days', 'backupRetentionDays');
      field('geoRedundantBackup', 'geo_redundant_backup_enabled', 'geoRedundantBackup', properties.geoRedundantBackup, properties.geoRedundantBackup ? 'Enabled' : 'Disabled');
      field('publicNetworkAccess', 'public_network_access_enabled', 'publicNetworkAccess', properties.publicNetworkAccess === 'Enabled');
      if (mysql) {
        delete terraform.public_network_access_enabled;
        terraform.public_network_access = properties.publicNetworkAccess;
        mapped.push('storageIops'); terraform.storage = [{ size_gb: properties.storageSizeGb, iops: properties.storageIops }]; bicep.storageIOPS = properties.storageIops;
      } else {
        terraform.storage_mb = Number(properties.storageSizeGb) * 1024;
        mapped.push('enableEntraAuth');
        terraform.authentication = [{ active_directory_auth_enabled: properties.enableEntraAuth, password_auth_enabled: true,
          ...(properties.enableEntraAuth ? { tenant_id: input('tenant_id', 'Microsoft Entra tenant ID.', { target: 'terraform' }) } : {}) }];
        bicep.authConfig = { activeDirectoryAuth: properties.enableEntraAuth ? 'Enabled' : 'Disabled', passwordAuth: 'Enabled', tenantId: new ExportExpression('var.tenant_id', 'tenant().tenantId') };
      }
      bicep.storageSizeGB = properties.storageSizeGb;
      bicep.highAvailability = properties.highAvailability;
      if (properties.highAvailability !== 'Disabled') terraform.high_availability = [{ mode: properties.highAvailability }];
      break;
    }
    default:
      extendComputeAndNetwork(context);
  }
}

function extendComputeAndNetwork(context: MappingContext): void {
  const { resource, resources, edges, plan, terraform, bicep, mapped, field, input, reference, dependency, subnetReference, target } = context;
  const properties = resource.properties;
  const required = (key: string, options: Omit<NativeExportPlan['inputs'][string], 'description'> = {}) => input(`${resource.symbol}_${key}`, `${key} for ${resource.node.data.name}.`, options);
  const subnet = () => {
    mapped.push('subnetResourceId');
    return subnetReference(resource) ?? properties.subnetResourceId ?? required('subnet_id');
  };
  const publicIp = () => dependency(resource, 'Microsoft.Network/publicIPAddresses', 'public_ip_id');
  const vnet = () => {
    const subnetNode = context.nodes.find((node) => node.id.includes('__subnet__') && (node.id === resource.node.parentId || edges.some((edge) =>
      (edge.source === node.id && edge.target === resource.node.id) || (edge.target === node.id && edge.source === resource.node.id))));
    const parent = resources.find((entry) => entry.node.id === subnetNode?.parentId);
    return parent ? reference(parent) : dependency(resource, 'Microsoft.Network/virtualNetworks', 'virtual_network_id');
  };
  const identity = (enabled: unknown) => {
    if (enabled) { terraform.identity = [{ type: 'SystemAssigned' }]; bicep.managedIdentities = { systemAssigned: true }; }
  };
  const addNative = (suffix: string, type: string, attributes: Record<string, unknown>, attribute = 'id') => {
    const symbol = `${resource.symbol}_${suffix}`;
    plan.resources.push({ symbol, terraformType: type, terraform: attributes, bicep: {} });
    return new ExportExpression(`${type}.${symbol}.${attribute}`, '');
  };
  const zones = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : value === 'Zone-redundant' ? ['1', '2', '3'] : String(value ?? '').split(',').map((zone) => zone.trim()).filter(Boolean);

  switch (resource.armType) {
    case 'Microsoft.Compute/virtualMachines': {
      mapped.push('osType', 'authenticationType', 'adminUsername', 'adminPassword', 'enableAcceleratedNetworking', 'imagePublisher', 'imageOffer', 'imageSku', 'imageVersion', 'osDiskType', 'osDiskSizeGb');
      const windows = properties.osType === 'windows';
      field('vmSize', 'size', 'vmSize');
      terraform.admin_username = bicep.adminUsername = properties.adminUsername || required('admin_username');
      bicep.osType = windows ? 'Windows' : 'Linux';
      const passwordAuth = windows || properties.authenticationType === 'password';
      if (passwordAuth) terraform.admin_password = bicep.adminPassword = required('admin_password', { sensitive: true });
      if (!windows) {
        terraform.disable_password_authentication = bicep.disablePasswordAuthentication = !passwordAuth;
        if (!passwordAuth) {
          const key = required('ssh_public_key');
          terraform.admin_ssh_key = [{ username: terraform.admin_username, public_key: key }];
          bicep.publicKeys = [{ path: terraform.admin_username instanceof ExportExpression
            ? new ExportExpression('', `'/home/\${${terraform.admin_username.bicep}}/.ssh/authorized_keys'`)
            : `/home/${terraform.admin_username}/.ssh/authorized_keys`, keyData: key }];
        }
      }
      const image = { publisher: properties.imagePublisher || required('image_publisher'), offer: properties.imageOffer || required('image_offer'), sku: properties.imageSku || required('image_sku'), version: properties.imageVersion || 'latest' };
      terraform.source_image_reference = [image]; bicep.imageReference = image;
      terraform.os_disk = [{ caching: 'ReadWrite', storage_account_type: properties.osDiskType, disk_size_gb: properties.osDiskSizeGb }];
      bicep.osDisk = { createOption: 'FromImage', caching: 'ReadWrite', managedDisk: { storageAccountType: properties.osDiskType }, diskSizeGB: properties.osDiskSizeGb };
      field('availabilityZone', 'zone', 'availabilityZone', properties.availabilityZone, Number(properties.availabilityZone || -1));
      mapped.push('enableBootDiagnostics');
      if (properties.enableBootDiagnostics) terraform.boot_diagnostics = [{}];
      bicep.bootDiagnostics = properties.enableBootDiagnostics;
      const subnetId = subnet();
      const nic = findExportDependency(resource, 'Microsoft.Network/networkInterfaces', resources, edges);
      if (nic && target === 'bicep') throw new Error('The VM AVM module owns its NICs. Connect the VM to a subnet instead of a separately managed NIC for AVM export.');
      const nicId = nic ? reference(nic) : addNative('nic', 'azurerm_network_interface', {
        name: `${resource.node.data.name}-nic`, resource_group_name: terraform.resource_group_name, location: terraform.location,
        accelerated_networking_enabled: properties.enableAcceleratedNetworking,
        ip_configuration: [{ name: 'primary', subnet_id: subnetId, private_ip_address_allocation: 'Dynamic', primary: true }],
      });
      terraform.network_interface_ids = [nicId];
      bicep.nicConfigurations = [{ name: `${resource.node.data.name}-nic`, enableAcceleratedNetworking: properties.enableAcceleratedNetworking,
        ipConfigurations: [{ name: 'primary', subnetResourceId: subnetId, privateIPAllocationMethod: 'Dynamic' }] }];
      break;
    }
    case 'Microsoft.Network/azureFirewalls': {
      field('skuTier', 'sku_tier', 'azureSkuTier');
      field('threatIntelMode', 'threat_intel_mode', 'threatIntelMode');
      field('availabilityZones', 'zones', 'availabilityZones', zones(properties.availabilityZones), zones(properties.availabilityZones).map(Number));
      terraform.sku_name = 'AZFW_VNet';
      const ip = publicIp();
      terraform.ip_configuration = [{ name: 'primary', subnet_id: target === 'terraform' ? subnet() : undefined, public_ip_address_id: ip }];
      bicep.virtualNetworkResourceId = vnet(); bicep.publicIPResourceID = ip;
      if (properties.skuTier === 'Basic') {
        const managementIp = required('management_public_ip_id');
        terraform.management_ip_configuration = [{ name: 'management', subnet_id: required('management_subnet_id'), public_ip_address_id: managementIp }];
        bicep.enableManagementNic = true; bicep.managementIPResourceID = managementIp;
      }
      break;
    }
    case 'Microsoft.Network/bastionHosts': {
      field('tier', 'sku', 'skuName');
      field('scaleUnits', 'scale_units', 'scaleUnits');
      field('availabilityZones', 'zones', 'availabilityZones', zones(properties.availabilityZones), zones(properties.availabilityZones).map(Number));
      mapped.push('enableTunneling'); terraform.tunneling_enabled = properties.enableTunneling;
      const avmTunneling = properties.tier === 'Standard' || (properties.tier === 'Premium' && !properties.enableSessionRecording);
      if (target === 'bicep' && Boolean(properties.enableTunneling) !== avmTunneling) throw new Error('Bastion AVM controls tunneling by SKU/session-recording; the selected enableTunneling value cannot be represented.');
      field('enableFileCopy', 'file_copy_enabled', 'enableFileCopy');
      field('enableIpConnect', 'ip_connect_enabled', 'enableIpConnect');
      field('enableShareableLink', 'shareable_link_enabled', 'enableShareableLink');
      field('enableKerberos', 'kerberos_enabled', 'enableKerberos');
      field('disableCopyPaste', 'copy_paste_enabled', 'disableCopyPaste', !properties.disableCopyPaste);
      field('enableSessionRecording', 'session_recording_enabled', 'enableSessionRecording');
      mapped.push('enablePrivateOnly');
      bicep.enablePrivateOnlyBastion = properties.enablePrivateOnly;
      if (properties.enablePrivateOnly && target === 'terraform') throw new Error('AzureRM Bastion private_only_enabled is read-only; private-only Bastion requires the AVM export.');
      const ip = properties.enablePrivateOnly ? undefined : publicIp();
      terraform.ip_configuration = [{ name: 'primary', subnet_id: target === 'terraform' ? subnet() : undefined, public_ip_address_id: ip }];
      bicep.virtualNetworkResourceId = vnet(); bicep.bastionSubnetPublicIpResourceId = ip;
      break;
    }
    case 'Microsoft.Network/loadBalancers': {
      field('sku', 'sku', 'skuName'); mapped.push('type', 'availabilityZone');
      const privateLb = properties.type === 'Internal';
      const ip = privateLb ? undefined : publicIp();
      const subnetId = privateLb ? subnet() : undefined;
      terraform.frontend_ip_configuration = [{ name: 'frontend', zones: zones(properties.availabilityZone), public_ip_address_id: ip,
        subnet_id: subnetId, ...(privateLb ? { private_ip_address_allocation: 'Dynamic' } : {}) }];
      bicep.frontendIPConfigurations = [{ name: 'frontend', availabilityZones: zones(properties.availabilityZone).map(Number),
        ...(privateLb ? { subnetResourceId: subnetId } : { publicIPAddressResourceId: ip }),
      }];
      break;
    }
    case 'Microsoft.Network/virtualNetworkGateways': {
      field('gatewayType', 'type', 'gatewayType'); field('vpnType', 'vpn_type', 'vpnType');
      field('sku', 'sku', 'skuName'); field('generation', 'generation', 'vpnGatewayGeneration');
      mapped.push('enableBgp', 'activeActive'); terraform.bgp_enabled = properties.enableBgp;
      if (properties.activeActive !== undefined && typeof properties.activeActive !== 'boolean') {
        throw new Error(`Invalid activeActive on "${resource.node.data.name}": expected a boolean.`);
      }
      const activeActive = properties.activeActive ?? false;
      if (activeActive && (properties.gatewayType !== 'Vpn' || properties.vpnType !== 'RouteBased' || properties.sku === 'Basic')) {
        throw new Error('Active-active gateways require a route-based VPN gateway with a non-Basic SKU.');
      }
      terraform.active_active = activeActive;
      const secondaryIp = activeActive ? required('secondary_public_ip_id') : undefined;
      bicep.clusterSettings = {
        clusterMode: `${activeActive ? 'activeActive' : 'activePassive'}${properties.enableBgp ? 'Bgp' : 'NoBgp'}`,
        ...(activeActive ? { existingSecondaryPublicIPResourceId: secondaryIp } : {}),
      };
      const ip = publicIp();
      const subnetId = target === 'terraform' ? subnet() : undefined;
      terraform.ip_configuration = [
        { name: 'primary', subnet_id: subnetId, public_ip_address_id: ip, private_ip_address_allocation: 'Dynamic' },
        ...(activeActive ? [{ name: 'secondary', subnet_id: subnetId, public_ip_address_id: secondaryIp, private_ip_address_allocation: 'Dynamic' }] : []),
      ];
      bicep.existingPrimaryPublicIPResourceId = ip; bicep.virtualNetworkResourceId = vnet();
      break;
    }
    case 'Microsoft.Network/applicationGateways': {
      mapped.push('tier', 'capacity', 'enableAutoScale', 'minCapacity', 'maxCapacity', 'wafMode', 'http2');
      terraform.sku = [{ name: properties.tier, tier: properties.tier, ...(properties.enableAutoScale ? {} : { capacity: properties.capacity }) }];
      bicep.sku = properties.tier; bicep.capacity = properties.capacity; bicep.enableHttp2 = terraform.http2_enabled = properties.http2;
      if (properties.enableAutoScale) { terraform.autoscale_configuration = [{ min_capacity: properties.minCapacity, max_capacity: properties.maxCapacity }]; bicep.autoscaleMinCapacity = properties.minCapacity; bicep.autoscaleMaxCapacity = properties.maxCapacity; }
      const subnetId = subnet(), ip = publicIp(), hostname = required('backend_hostname');
      terraform.gateway_ip_configuration = [{ name: 'gateway', subnet_id: subnetId }];
      bicep.gatewayIPConfigurations = [{ name: 'gateway', properties: { subnet: { id: subnetId } } }];
      terraform.frontend_ip_configuration = [{ name: 'frontend', public_ip_address_id: ip }];
      bicep.frontendIPConfigurations = [{ name: 'frontend', properties: { publicIPAddress: { id: ip } } }];
      terraform.frontend_port = [{ name: 'http', port: 80 }]; bicep.frontendPorts = [{ name: 'http', properties: { port: 80 } }];
      terraform.backend_address_pool = [{ name: 'backend', fqdns: [hostname] }];
      bicep.backendAddressPools = [{ name: 'backend', properties: { backendAddresses: [{ fqdn: hostname }] } }];
      terraform.backend_http_settings = [{ name: 'settings', cookie_based_affinity: 'Disabled', port: 443, protocol: 'Https', request_timeout: 30, pick_host_name_from_backend_address: true }];
      bicep.backendHttpSettingsCollection = [{ name: 'settings', properties: { cookieBasedAffinity: 'Disabled', port: 443, protocol: 'Https', requestTimeout: 30, pickHostNameFromBackendAddress: true } }];
      const childId = (type: string, name: string) => new ExportExpression('', `resourceId('Microsoft.Network/applicationGateways/${type}', ${quote(resource.node.data.name)}, '${name}')`);
      terraform.http_listener = [{ name: 'listener', frontend_ip_configuration_name: 'frontend', frontend_port_name: 'http', protocol: 'Http' }];
      bicep.httpListeners = [{ name: 'listener', properties: { frontendIPConfiguration: { id: childId('frontendIPConfigurations', 'frontend') }, frontendPort: { id: childId('frontendPorts', 'http') }, protocol: 'Http' } }];
      terraform.request_routing_rule = [{ name: 'route', rule_type: 'Basic', priority: 100, http_listener_name: 'listener', backend_address_pool_name: 'backend', backend_http_settings_name: 'settings' }];
      bicep.requestRoutingRules = [{ name: 'route', properties: { ruleType: 'Basic', priority: 100, httpListener: { id: childId('httpListeners', 'listener') }, backendAddressPool: { id: childId('backendAddressPools', 'backend') }, backendHttpSettings: { id: childId('backendHttpSettingsCollection', 'settings') } } }];
      if (properties.tier === 'WAF_v2') {
        const policy = input(`${resource.symbol}_waf_policy_id`, `Existing Application Gateway WAF policy ID configured in ${properties.wafMode} mode.`);
        terraform.firewall_policy_id = bicep.firewallPolicyResourceId = policy;
      }
      break;
    }
    case 'Microsoft.ContainerService/managedClusters': {
      mapped.push('nodeCount', 'nodeSize', 'enableAutoScaling', 'minCount', 'maxCount', 'enableMonitoring');
      field('kubernetesVersion', 'kubernetes_version', 'kubernetesVersion');
      field('tier', 'sku_tier', 'skuTier'); field('enableRBAC', 'role_based_access_control_enabled', 'enableRBAC');
      field('enableAzurePolicy', 'azure_policy_enabled', 'azurePolicyEnabled');
      mapped.push('networkPlugin'); terraform.network_profile = [{ network_plugin: properties.networkPlugin }]; bicep.networkPlugin = properties.networkPlugin;
      const dns = required('dns_prefix'); terraform.dns_prefix = bicep.dnsPrefix = dns;
      terraform.default_node_pool = [{ name: 'system', vm_size: properties.nodeSize, node_count: properties.nodeCount, auto_scaling_enabled: properties.enableAutoScaling,
        ...(properties.enableAutoScaling ? { min_count: properties.minCount, max_count: properties.maxCount } : {}) }];
      bicep.primaryAgentPoolProfiles = [{ name: 'system', mode: 'System', osType: 'Linux', vmSize: properties.nodeSize, count: properties.nodeCount,
        enableAutoScaling: properties.enableAutoScaling, ...(properties.enableAutoScaling ? { minCount: properties.minCount, maxCount: properties.maxCount } : {}), availabilityZones: [] }];
      identity(true); bicep.disableLocalAccounts = false; bicep.publicNetworkAccess = 'Enabled';
      if (properties.enableMonitoring) { const workspace = dependency(resource, 'Microsoft.OperationalInsights/workspaces', 'workspace_id'); terraform.oms_agent = [{ log_analytics_workspace_id: workspace }]; bicep.omsAgentEnabled = true; bicep.monitoringWorkspaceResourceId = workspace; }
      break;
    }
    case 'Microsoft.DocumentDB/databaseAccounts': {
      mapped.push('apiKind', 'consistencyLevel', 'capacityMode', 'backupPolicy');
      terraform.offer_type = 'Standard'; terraform.kind = properties.apiKind === 'MongoDB' ? 'MongoDB' : 'GlobalDocumentDB';
      terraform.consistency_policy = [{ consistency_level: properties.consistencyLevel }]; bicep.defaultConsistencyLevel = properties.consistencyLevel;
      terraform.geo_location = [{ location: terraform.location, failover_priority: 0 }];
      bicep.failoverLocations = [{ locationName: bicep.location, failoverPriority: 0, isZoneRedundant: false }];
      const capability = ({ MongoDB: 'EnableMongo', Cassandra: 'EnableCassandra', Gremlin: 'EnableGremlin', Table: 'EnableTable' } as Record<string, string>)[String(properties.apiKind)];
      const capabilities = [...(capability ? [capability] : []), ...(properties.capacityMode === 'serverless' ? ['EnableServerless'] : [])];
      if (capabilities.length) terraform.capabilities = capabilities.map((name) => ({ name }));
      bicep.capabilitiesToAdd = capabilities; bicep.capacityMode = properties.capacityMode === 'serverless' ? 'Serverless' : 'Provisioned';
      field('enableMultiRegionWrites', 'multiple_write_locations_enabled', 'enableMultipleWriteLocations');
      field('enableFreeTier', 'free_tier_enabled', 'enableFreeTier');
      mapped.push('publicNetworkAccess'); terraform.public_network_access_enabled = properties.publicNetworkAccess === 'Enabled';
      bicep.networkRestrictions = { publicNetworkAccess: properties.publicNetworkAccess };
      const continuous = properties.backupPolicy !== 'Periodic';
      terraform.backup = [{ type: continuous ? 'Continuous' : 'Periodic', ...(continuous ? { tier: properties.backupPolicy } : { interval_in_minutes: 240, retention_in_hours: 8, storage_redundancy: 'Geo' }) }];
      bicep.backupPolicyType = continuous ? 'Continuous' : 'Periodic';
      if (continuous) bicep.backupPolicyContinuousTier = properties.backupPolicy;
      break;
    }
    case 'Microsoft.SignalRService/signalR':
      mapped.push('sku', 'capacity', 'serviceMode', 'enableConnectivityLogs');
      terraform.sku = [{ name: properties.sku, capacity: properties.capacity }]; bicep.sku = properties.sku; bicep.capacity = properties.capacity;
      terraform.service_mode = properties.serviceMode;
      terraform.connectivity_logs_enabled = properties.enableConnectivityLogs;
      bicep.features = [{ flag: 'ServiceMode', value: properties.serviceMode }, { flag: 'EnableConnectivityLogs', value: properties.enableConnectivityLogs ? 'true' : 'false' }];
      field('publicNetworkAccess', 'public_network_access_enabled', 'publicNetworkAccess', properties.publicNetworkAccess === 'Enabled');
      break;
    case 'Microsoft.Web/staticSites': {
      mapped.push('sku', 'repositoryUrl', 'branch', 'appLocation', 'apiLocation', 'outputLocation');
      terraform.sku_tier = terraform.sku_size = bicep.sku = properties.sku;
      if (properties.repositoryUrl) {
        terraform.repository_url = bicep.repositoryUrl = properties.repositoryUrl;
        terraform.repository_branch = bicep.branch = properties.branch;
        terraform.repository_token = bicep.repositoryToken = required('repository_token', { sensitive: true });
      }
      bicep.buildProperties = { appLocation: properties.appLocation, apiLocation: properties.apiLocation || undefined, appArtifactLocation: properties.outputLocation || undefined };
      if (target === 'terraform' && (properties.appLocation !== '/' || properties.apiLocation || properties.outputLocation)) throw new Error('Static Web App build paths belong in the repository deployment workflow; AzureRM does not expose buildProperties.');
      break;
    }
    case 'Microsoft.Web/sites':
      mapWebApp(context);
      break;
    case 'Microsoft.Cdn/profiles':
      mapFrontDoor(context);
      break;
    case 'Microsoft.Network/networkInterfaces': {
      field('enableAcceleratedNetworking', 'accelerated_networking_enabled', 'enableAcceleratedNetworking');
      field('enableIPForwarding', 'ip_forwarding_enabled', 'enableIPForwarding');
      mapped.push('dnsServers');
      if (properties.dnsServers) terraform.dns_servers = bicep.dnsServers = zones(properties.dnsServers);
      const subnetId = subnet();
      terraform.ip_configuration = [{ name: 'primary', subnet_id: subnetId, private_ip_address_allocation: 'Dynamic', primary: true }];
      bicep.ipConfigurations = [{ name: 'primary', subnetResourceId: subnetId, privateIPAllocationMethod: 'Dynamic' }];
      const nsg = findExportDependency(resource, 'Microsoft.Network/networkSecurityGroups', resources, edges);
      if (nsg) {
        addNative('nsg', 'azurerm_network_interface_security_group_association', { network_interface_id: reference(resource), network_security_group_id: reference(nsg) });
        bicep.networkSecurityGroupResourceId = reference(nsg);
      }
      break;
    }
    case 'Microsoft.Network/natGateways': {
      field('idleTimeoutInMinutes', 'idle_timeout_in_minutes', 'idleTimeoutInMinutes');
      field('availabilityZone', 'zones', 'availabilityZone', zones(properties.availabilityZone), Number(properties.availabilityZone || -1));
      terraform.sku_name = 'Standard';
      const ip = publicIp();
      addNative('public_ip', 'azurerm_nat_gateway_public_ip_association', { nat_gateway_id: reference(resource), public_ip_address_id: ip });
      bicep.publicIpResourceIds = [ip];
      break;
    }
    case 'Microsoft.Network/privateEndpoints': {
      const subnetId = subnet();
      mapped.push('privateLinkResourceId', 'groupId');
      const serviceId = properties.privateLinkResourceId || required('private_link_resource_id');
      const groupId = properties.groupId || required('private_link_group_id');
      terraform.subnet_id = bicep.subnetResourceId = subnetId;
      terraform.private_service_connection = [{ name: 'connection', private_connection_resource_id: serviceId, subresource_names: [groupId], is_manual_connection: false }];
      bicep.privateLinkServiceConnections = [{ name: 'connection', properties: { privateLinkServiceId: serviceId, groupIds: [groupId] } }];
      break;
    }
    default:
      throw new Error(`No native export mapping exists for ${resource.armType}.`);
  }
}

function mapWebApp(context: MappingContext): void {
  const { resource, resources, edges, terraform, bicep, mapped, input, reference, dependency, target } = context;
  const properties = resource.properties;
  const functionApp = resolveKey(resource.node.data.typeKey) === 'function-app';
  const windows = properties.os === 'windows';
  mapped.push('os', 'runtimeStack', 'httpsOnly', 'managedIdentity');
  const required = (key: string, sensitive = false) => input(`${resource.symbol}_${key}`, `${key} for ${resource.node.data.name}.`, { sensitive });
  terraform.service_plan_id = bicep.serverFarmResourceId = dependency(resource, 'Microsoft.Web/serverfarms', 'service_plan_id');
  terraform.https_only = bicep.httpsOnly = properties.httpsOnly;
  bicep.kind = `${functionApp ? 'functionapp' : 'app'}${windows ? '' : ',linux'}`;
  bicep.reserved = !windows;
  const siteConfig: Record<string, unknown> = {};
  const nativeConfig: Record<string, unknown> = {};
  const stack: Record<string, unknown> = {};
  const [runtime, rawVersion] = String(properties.runtimeStack || '').split('|');
  const version = rawVersion?.replace(/^[v~]/, '');
  if (properties.managedIdentity) { terraform.identity = [{ type: 'SystemAssigned' }]; bicep.managedIdentities = { systemAssigned: true }; }
  if (functionApp) {
    mapped.push('hostingPlan');
    if (windows && ['python', 'go'].includes(runtime)) throw new Error(`${runtime} Functions requires Linux hosting.`);
    if (properties.hostingPlan === 'flex-consumption') {
      if (windows) throw new Error('Flex Consumption supports Linux only.');
      if (['dotnet', 'powershell'].includes(runtime)) throw new Error(`Flex Consumption does not support the selected ${runtime} runtime; select a supported runtime such as dotnet-isolated.`);
      const endpoint = required('deployment_storage_container_endpoint');
      const key = required('deployment_storage_access_key', true);
      terraform.runtime_name = runtime || required('runtime_name');
      terraform.runtime_version = version || required('runtime_version');
      terraform.storage_container_type = 'blobContainer';
      terraform.storage_container_endpoint = endpoint;
      terraform.storage_authentication_type = 'StorageAccountConnectionString';
      terraform.storage_access_key = key;
      terraform.site_config = [{}];
      bicep.functionAppConfig = {
        runtime: { name: terraform.runtime_name, version: terraform.runtime_version },
        deployment: { storage: { type: 'blobContainer', value: endpoint, authentication: { type: 'StorageAccountConnectionString', storageAccountConnectionStringName: 'DEPLOYMENT_STORAGE_CONNECTION_STRING' } } },
      };
      bicep.configs = [{ name: 'appsettings', properties: { DEPLOYMENT_STORAGE_CONNECTION_STRING: input(`${resource.symbol}_deployment_storage_connection_string`, 'Deployment storage connection string.', { sensitive: true, target: 'bicep' }) } }];
      context.plan.inputs[`${resource.symbol}_deployment_storage_access_key`].target = 'terraform';
      return;
    }
    const storage = findExportDependency(resource, 'Microsoft.Storage/storageAccounts', resources, edges);
    const storageName = storage ? reference(storage, 'name', 'name') : required('storage_account_name');
    const storageKey = required('storage_account_key', true);
    terraform.storage_account_name = storageName; terraform.storage_account_access_key = storageKey;
    terraform.functions_extension_version = '~4';
    nativeConfig.always_on = !['consumption', 'flex-consumption'].includes(String(properties.hostingPlan));
    const worker = runtime || required('functions_worker_runtime');
    terraform.app_settings = { FUNCTIONS_WORKER_RUNTIME: worker };
    const connection = new ExportExpression('', `'DefaultEndpointsProtocol=https;AccountName=\${${storageName.bicep}};AccountKey=\${${storageKey.bicep}};EndpointSuffix=\${environment().suffixes.storage}'`);
    bicep.configs = [{ name: 'appsettings', properties: { FUNCTIONS_EXTENSION_VERSION: '~4', FUNCTIONS_WORKER_RUNTIME: worker, AzureWebJobsStorage: connection } }];
    if (runtime) {
      if (runtime.startsWith('dotnet')) { stack.dotnet_version = windows ? `v${version}` : version; stack.use_dotnet_isolated_runtime = runtime === 'dotnet-isolated'; }
      else if (runtime === 'powershell') stack.powershell_core_version = version;
      else stack[`${runtime}_version`] = windows && runtime === 'node' ? `~${version}` : version;
    }
  } else {
    mapped.push('publish', 'dockerImage', 'alwaysOn', 'minTlsVersion', 'http20Enabled', 'ftpsState');
    nativeConfig.always_on = siteConfig.alwaysOn = properties.alwaysOn;
    nativeConfig.minimum_tls_version = siteConfig.minTlsVersion = properties.minTlsVersion;
    nativeConfig.http2_enabled = siteConfig.http20Enabled = properties.http20Enabled;
    nativeConfig.ftps_state = siteConfig.ftpsState = properties.ftpsState;
    if (properties.publish === 'docker') {
      const image = properties.dockerImage || required('docker_image');
      const registry = required('docker_registry_url');
      stack.docker_image_name = image; stack.docker_registry_url = registry;
      bicep.configs = [{ name: 'appsettings', properties: { DOCKER_REGISTRY_SERVER_URL: registry } }];
      siteConfig[windows ? 'windowsFxVersion' : 'linuxFxVersion'] = image instanceof ExportExpression ? new ExportExpression('', `'DOCKER|\${${image.bicep}}'`) : `DOCKER|${image}`;
    } else if (runtime) {
      if (runtime === 'go') {
        if (target === 'terraform') throw new Error('AzureRM Web App application_stack has no Go runtime field; select a Docker deployment for Go.');
      } else if (windows && ['python', 'php'].includes(runtime)) throw new Error(`${runtime} Web Apps require Linux hosting.`);
      else if (runtime === 'dotnet') stack.dotnet_version = windows ? `v${version}` : version;
      else if (runtime === 'java') { stack.java_version = version; if (!windows) { stack.java_server = 'JAVA'; stack.java_server_version = version; } }
      else stack[`${runtime}_version`] = runtime === 'node' ? windows ? `~${version}` : `${version}-lts` : version;
    }
  }
  if (runtime && properties.publish !== 'docker') {
    if (!windows) siteConfig.linuxFxVersion = `${runtime === 'dotnet-isolated' ? 'DOTNET-ISOLATED' : runtime === 'dotnet' ? 'DOTNETCORE' : runtime.toUpperCase()}|${version}`;
    else if (runtime.startsWith('dotnet')) siteConfig.netFrameworkVersion = `v${version}`;
    else if (runtime === 'node') siteConfig.nodeVersion = `~${version}`;
    else siteConfig[`${runtime}Version`] = version;
  }
  if (Object.keys(stack).length) nativeConfig.application_stack = [stack];
  terraform.site_config = [nativeConfig]; bicep.siteConfig = siteConfig;
}

function mapFrontDoor(context: MappingContext): void {
  const { resource, terraform, bicep, mapped, input, plan, reference } = context;
  const properties = resource.properties;
  mapped.push('sku', 'enableWaf', 'enableCaching', 'originResponseTimeoutSeconds');
  delete terraform.location; bicep.location = 'global';
  terraform.sku_name = bicep.sku = properties.sku;
  terraform.response_timeout_seconds = bicep.originResponseTimeoutSeconds = properties.originResponseTimeoutSeconds;
  const hostname = input(`${resource.symbol}_origin_hostname`, `Origin hostname for ${resource.node.data.name}.`);
  const add = (suffix: string, type: string, attributes: Record<string, unknown>) => {
    const symbol = `${resource.symbol}_${suffix}`;
    plan.resources.push({ symbol, terraformType: type, terraform: attributes, bicep: {} });
    return new ExportExpression(`${type}.${symbol}.id`, '');
  };
  const endpoint = add('endpoint', 'azurerm_cdn_frontdoor_endpoint', { name: `${resource.node.data.name}-endpoint`, cdn_frontdoor_profile_id: reference(resource) });
  const originGroup = add('origins', 'azurerm_cdn_frontdoor_origin_group', { name: 'origins', cdn_frontdoor_profile_id: reference(resource), load_balancing: [{}] });
  const origin = add('origin', 'azurerm_cdn_frontdoor_origin', { name: 'origin', cdn_frontdoor_origin_group_id: originGroup, host_name: hostname, origin_host_header: hostname, certificate_name_check_enabled: true });
  add('route', 'azurerm_cdn_frontdoor_route', { name: 'default', cdn_frontdoor_endpoint_id: endpoint, cdn_frontdoor_origin_group_id: originGroup, cdn_frontdoor_origin_ids: [origin],
    supported_protocols: ['Http', 'Https'], patterns_to_match: ['/*'], forwarding_protocol: 'HttpsOnly', https_redirect_enabled: true, link_to_default_domain: true,
    ...(properties.enableCaching ? { cache: [{}] } : {}) });
  bicep.originGroups = [{ name: 'origins', loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3, additionalLatencyInMilliseconds: 50 }, origins: [{ name: 'origin', hostName: hostname, originHostHeader: hostname, enforceCertificateNameCheck: true }] }];
  bicep.afdEndpoints = [{ name: `${resource.node.data.name}-endpoint`, routes: [{ name: 'default', originGroupName: 'origins', supportedProtocols: ['Http', 'Https'], patternsToMatch: ['/*'], forwardingProtocol: 'HttpsOnly', httpsRedirect: 'Enabled', linkToDefaultDomain: 'Enabled', ...(properties.enableCaching ? { cacheConfiguration: { queryStringCachingBehavior: 'IgnoreQueryString' } } : {}) }] }];
  if (properties.enableWaf) {
    const policy = input(`${resource.symbol}_waf_policy_id`, `Existing Front Door WAF policy ID for ${resource.node.data.name}.`);
    add('security', 'azurerm_cdn_frontdoor_security_policy', { name: 'waf', cdn_frontdoor_profile_id: reference(resource), security_policies: [{ firewall: [{ cdn_frontdoor_firewall_policy_id: policy, association: [{ domain: [{ cdn_frontdoor_domain_id: endpoint }], patterns_to_match: ['/*'] }] }] }] });
    bicep.securityPolicies = [{ name: 'waf', wafPolicyResourceId: policy, associations: [{
      domains: [{ id: new ExportExpression('', `resourceId('Microsoft.Cdn/profiles/afdEndpoints', ${quote(resource.node.data.name)}, ${quote(`${resource.node.data.name}-endpoint`)})`) }],
      patternsToMatch: ['/*'],
    }] }];
  }
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$\{/g, '\\${')}'`;
}