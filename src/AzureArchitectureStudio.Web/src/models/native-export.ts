import type { AzureEdge, AzureNode } from './diagram';
import { getArmType, getDefaultProperties, getResourceType, resolveKey } from './resource-registry';
import { extendResourceMapping, extendedDefinitions } from './native-export-catalog';

export interface ExportResource {
  node: AzureNode;
  symbol: string;
  armType: string;
  properties: Record<string, unknown>;
}

export function getExportResources(nodes: AzureNode[]): ExportResource[] {
  const scopes = nodes.filter((node) => ['entra-tenant', 'management-groups', 'subscriptions'].includes(resolveKey(node.data.typeKey)));
  for (const type of ['entra-tenant', 'subscriptions']) {
    if (scopes.filter((node) => resolveKey(node.data.typeKey) === type).length > 1) throw new Error('Export supports one existing tenant and subscription at a time.');
  }
  const groups = nodes.filter((node) => getResourceType(node.data.typeKey)?.armType === 'Microsoft.Resources/resourceGroups');
  if (groups.length > 1) throw new Error('Export supports one existing resource group at a time.');
  const resources = nodes.filter((node) => !groups.includes(node) && !scopes.includes(node) && !(node.id.includes('__subnet__') &&
    nodes.some((parent) => parent.id === node.parentId && getResourceType(parent.data.typeKey)?.armType === 'Microsoft.Network/virtualNetworks')));
  if (!resources.length) throw new Error('There are no deployable resources to export.');
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) throw new Error('Cannot export duplicate node IDs.');
  const symbols = allocateExportSymbols(resources.map((node) => ({ key: node.id, name: node.data.name })));
  return resources.map((node) => {
    const definition = getResourceType(node.data.typeKey);
    const armType = definition?.armType || getArmType(node.data.typeKey);
    if (!armType) throw new Error(`Cannot export "${node.data.name}": unsupported resource type ${node.data.typeKey}.`);
    const { __armSpecAdvanced__: advanced, ...configured } = node.data.properties;
    if (advanced !== undefined && advanced !== null &&
      (typeof advanced !== 'object' || Array.isArray(advanced))) {
      throw new Error(`Invalid advanced properties on "${node.data.name}".`);
    }
    const advancedProperties = (advanced ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(advancedProperties)) {
      if (Object.prototype.hasOwnProperty.call(configured, key)) {
        throw new Error(`Cannot export "${node.data.name}": ${key} is configured in both standard and advanced properties.`);
      }
    }
    const properties = { ...getDefaultProperties(node.data.typeKey), ...configured, ...advancedProperties };
    for (const field of definition?.propertySchema ?? []) {
      const value = properties[field.key];
      if (value === undefined || value === '') continue;
      if ((field.type === 'boolean' && typeof value !== 'boolean') ||
        (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) ||
        (['array', 'object-array'].includes(field.type) && !Array.isArray(value))) {
        throw new Error(`Invalid ${field.key} on "${node.data.name}".`);
      }
    }
    return { node, symbol: symbols.get(node.id)!, armType, properties };
  });
}

export function exportSymbol(name: string): string {
  const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return `resource_${normalized.slice(0, 100) || 'unnamed'}`;
}

function allocateExportSymbols(entries: { key: string; name: string }[], reserved: string[] = []): Map<string, string> {
  const symbols = new Map<string, string>();
  const used = new Set(reserved);
  const bases = new Set(entries.map((entry) => exportSymbol(entry.name)));
  for (const entry of [...entries].sort((first, second) => first.key < second.key ? -1 : first.key > second.key ? 1 : 0)) {
    const base = exportSymbol(entry.name);
    let symbol = base;
    let suffix = 2;
    while (used.has(symbol) || (symbol !== base && bases.has(symbol))) symbol = `${base}_${suffix++}`;
    used.add(symbol);
    symbols.set(entry.key, symbol);
  }
  return symbols;
}

export function findExportDependency(resource: ExportResource, armType: string, resources: ExportResource[], edges: AzureEdge[]): ExportResource | undefined {
  const matches = resources.filter((candidate) => candidate.armType === armType && (
    resource.node.parentId === candidate.node.id || edges.some((edge) =>
      (edge.source === resource.node.id && edge.target === candidate.node.id) ||
      (edge.target === resource.node.id && edge.source === candidate.node.id))
  ));
  if (matches.length > 1) throw new Error(`Cannot export "${resource.node.data.name}": multiple connected ${armType} resources.`);
  return matches[0];
}

export function exportTags(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if (Object.values(value).some((entry) => typeof entry !== 'string')) throw new Error('Tag values must be strings.');
    return value as Record<string, string>;
  }
  if (typeof value !== 'string') throw new Error('Tags must be an object or key=value lines.');
  return Object.fromEntries(value.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Tags must use key=value, one per line.');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}

export function assertMappedProperties(resource: ExportResource, supported: string[]): void {
  const unsupported = Object.entries(resource.properties).filter(([key, value]) =>
    !['location', 'tags', ...supported].includes(key) && value !== undefined && value !== null && value !== ''
  ).map(([key]) => key);
  if (unsupported.length) throw new Error(`Cannot export "${resource.node.data.name}": unsupported properties: ${unsupported.join(', ')}.`);
}

export class ExportExpression {
  constructor(public terraform: string, public bicep: string) {}
}

export interface PlannedResource {
  symbol: string;
  terraformType: string;
  bicepModule?: string;
  terraform: Record<string, unknown>;
  bicep: Record<string, unknown>;
}

export interface NativeExportPlan {
  resources: PlannedResource[];
  inputs: Record<string, { description: string; default?: string; type?: string; bicepType?: string; sensitive?: boolean; target?: 'terraform' | 'bicep' }>;
}

const definitions: Record<string, { terraform: string; avm: string }> = {
  ...extendedDefinitions,
  'Microsoft.Storage/storageAccounts': { terraform: 'azurerm_storage_account', avm: 'storage/storage-account:0.33.0' },
  'Microsoft.Network/virtualNetworks': { terraform: 'azurerm_virtual_network', avm: 'network/virtual-network:0.10.2' },
  'Microsoft.Network/networkSecurityGroups': { terraform: 'azurerm_network_security_group', avm: 'network/network-security-group:0.5.3' },
  'Microsoft.Network/publicIPAddresses': { terraform: 'azurerm_public_ip', avm: 'network/public-ip-address:0.13.0' },
  'Microsoft.Network/privateDnsZones': { terraform: 'azurerm_private_dns_zone', avm: 'network/private-dns-zone:0.8.1' },
  'Microsoft.OperationalInsights/workspaces': { terraform: 'azurerm_log_analytics_workspace', avm: 'operational-insights/workspace:0.16.1' },
  'Microsoft.ContainerRegistry/registries': { terraform: 'azurerm_container_registry', avm: 'container-registry/registry:0.13.0' },
  'Microsoft.KeyVault/vaults': { terraform: 'azurerm_key_vault', avm: 'key-vault/vault:0.14.2' },
  'Microsoft.App/managedEnvironments': { terraform: 'azurerm_container_app_environment', avm: 'app/managed-environment:0.16.0' },
  'Microsoft.App/containerApps': { terraform: 'azurerm_container_app', avm: 'app/container-app:0.23.0' },
};

export function createNativeExportPlan(nodes: AzureNode[], edges: AzureEdge[] = [], target: 'terraform' | 'bicep' = 'terraform'): NativeExportPlan {
  const resources = getExportResources(nodes);
  const subnetKey = (resource: ExportResource, name: unknown) => JSON.stringify([resource.node.id, name]);
  const subnetSymbols = allocateExportSymbols(resources.filter((resource) => resource.armType === 'Microsoft.Network/virtualNetworks').flatMap((resource) =>
    objectArray(resource.properties.subnets, 'subnets').map((subnet) => ({ key: subnetKey(resource, subnet.name), name: `${resource.symbol.slice('resource_'.length)}_subnet_${subnet.name}` }))), resources.map((resource) => resource.symbol));
  const group = nodes.find((node) => getResourceType(node.data.typeKey)?.armType === 'Microsoft.Resources/resourceGroups');
  const region = group?.data.properties.location || group?.data.location;
  const plan: NativeExportPlan = { resources: [], inputs: {
    location: { description: 'Azure deployment region.', ...(region ? { default: String(region) } : {}) },
  } };
  const input = (name: string, description: string, options: Omit<NativeExportPlan['inputs'][string], 'description'> = {}) => {
    plan.inputs[name] = { description, ...options };
    return new ExportExpression(`var.${name}`, name);
  };
  const definitionFor = (resource: ExportResource) => {
    const definition = definitions[resource.armType];
    if (!definition) return undefined;
    if (resource.armType === 'Microsoft.Web/sites') {
      if (resolveKey(resource.node.data.typeKey) === 'function-app' && resource.properties.hostingPlan === 'flex-consumption') return { ...definition, terraform: 'azurerm_function_app_flex_consumption' };
      return { ...definition, terraform: `azurerm_${resource.properties.os === 'windows' ? 'windows' : 'linux'}_${resolveKey(resource.node.data.typeKey) === 'function-app' ? 'function' : 'web'}_app` };
    }
    if (resource.armType === 'Microsoft.Compute/virtualMachines') return { ...definition, terraform: `azurerm_${resource.properties.osType === 'windows' ? 'windows' : 'linux'}_virtual_machine` };
    return definition;
  };
  const reference = (resource: ExportResource, attribute = 'id', output = 'resourceId') => {
    const definition = definitionFor(resource);
    if (!definition) throw new Error(`No native mapping for dependency ${resource.armType}.`);
    return new ExportExpression(`${definition.terraform}.${resource.symbol}.${attribute}`, `${resource.symbol}.outputs.${output}`);
  };
  const dependency = (resource: ExportResource, type: string, field: string) => {
    const related = findExportDependency(resource, type, resources, edges);
    return related ? reference(related) : input(`${resource.symbol}_${field}`, `${type} resource ID for ${resource.node.data.name}.`);
  };
  const subnetReference = (resource: ExportResource) => {
    const subnetNodes = nodes.filter((candidate) => candidate.id.includes('__subnet__') && (
      resource.node.parentId === candidate.id || edges.some((edge) =>
        (edge.source === resource.node.id && edge.target === candidate.id) || (edge.target === resource.node.id && edge.source === candidate.id))));
    if (subnetNodes.length > 1) throw new Error(`Multiple subnets are connected to "${resource.node.data.name}".`);
    if (!subnetNodes.length) return undefined;
    const subnetNode = subnetNodes[0];
    const vnet = resources.find((candidate) => candidate.node.id === subnetNode.parentId);
    if (!vnet || vnet.armType !== 'Microsoft.Network/virtualNetworks') throw new Error('Subnet parent must be a virtual network.');
    const subnets = objectArray(vnet.properties.subnets, 'subnets');
    const index = subnets.findIndex((subnet) => subnet.name === subnetNode.data.name);
    if (index < 0) throw new Error(`Subnet "${subnetNode.data.name}" is missing from its virtual network properties.`);
    return new ExportExpression(`azurerm_subnet.${subnetSymbols.get(subnetKey(vnet, subnets[index].name))}.id`, `${vnet.symbol}.outputs.subnetResourceIds[${index}]`);
  };

  for (const resource of resources) {
    const definition = definitionFor(resource);
    if (!definition) throw new Error(`Native Terraform/AVM export is not supported for "${resource.node.data.name}" (${resource.armType}).`);
    const properties = resource.properties;
    const location = properties.location || (!resource.node.data.useResourceGroupLocation && resource.node.data.location) || new ExportExpression('var.location', 'location');
    const tags = exportTags(properties.tags);
    const terraform: Record<string, unknown> = { name: resource.node.data.name, resource_group_name: new ExportExpression('var.resource_group_name', 'resourceGroup().name'), location, tags };
    const bicep: Record<string, unknown> = { name: resource.node.data.name, location, tags, enableTelemetry: false };
    const mapped: string[] = [];
    const field = (key: string, terraformKey: string, bicepKey: string, terraformValue = properties[key], bicepValue = properties[key]) => {
      mapped.push(key);
      if (terraformValue !== undefined && terraformValue !== '') terraform[terraformKey] = terraformValue;
      if (bicepValue !== undefined && bicepValue !== '') bicep[bicepKey] = bicepValue;
    };

    switch (resource.armType) {
      default:
        extendResourceMapping({ resource, resources, nodes, edges, plan, terraform, bicep, mapped, field, input, reference, dependency, subnetReference, target });
        break;
      case 'Microsoft.Storage/storageAccounts': {
        const sku = String(properties.sku).split('_');
        if (sku.length !== 2) throw new Error(`Invalid storage SKU for "${resource.node.data.name}".`);
        field('sku', 'account_tier', 'skuName', sku[0]);
        terraform.account_replication_type = sku[1];
        field('kind', 'account_kind', 'kind');
        field('accessTier', 'access_tier', 'accessTier');
        field('enableHttpsTrafficOnly', 'https_traffic_only_enabled', 'supportsHttpsTrafficOnly');
        field('minimumTlsVersion', 'min_tls_version', 'minimumTlsVersion');
        if (!['TLS1_2', 'TLS1_3'].includes(String(properties.minimumTlsVersion))) throw new Error('Storage export requires TLS 1.2 or later.');
        field('allowBlobPublicAccess', 'allow_nested_items_to_be_public', 'allowBlobPublicAccess');
        field('enableHns', 'is_hns_enabled', 'enableHierarchicalNamespace');
        if (['BlockBlobStorage', 'FileStorage'].includes(String(properties.kind))) delete terraform.access_tier;
        break;
      }
      case 'Microsoft.Network/virtualNetworks': {
        field('ipSpace', 'address_space', 'addressPrefixes', addressPrefixes(properties.ipSpace), addressPrefixes(properties.ipSpace));
        field('dnsServers', 'dns_servers', 'dnsServers', stringList(properties.dnsServers), stringList(properties.dnsServers));
        mapped.push('enableDdosProtection', 'enableVmProtection', 'subnets');
        if (properties.enableVmProtection && target === 'terraform') throw new Error('VM protection is not supported by the native Terraform exporter.');
        bicep.enableVmProtection = properties.enableVmProtection;
        if (properties.enableDdosProtection) {
          const ddos = input(`${resource.symbol}_ddos_plan_id`, `DDoS protection plan ID for ${resource.node.data.name}.`);
          terraform.ddos_protection_plan = [{ id: ddos, enable: true }];
          bicep.ddosProtectionPlanResourceId = ddos;
        }
        const subnets = objectArray(properties.subnets, 'subnets');
        if (new Set(subnets.map((subnet) => subnet.name)).size !== subnets.length) throw new Error('Subnet names must be unique within a virtual network.');
        bicep.subnets = subnets.map((subnet) => {
          const unknown = Object.keys(subnet).filter((key) => !['name', 'addressPrefix', 'privateEndpointNetworkPolicies', 'delegations'].includes(key));
          if (unknown.length) throw new Error(`Unsupported subnet properties: ${unknown.join(', ')}.`);
          if (!subnet.name || !subnet.addressPrefix) throw new Error('Subnets require a name and addressPrefix.');
          if (subnet.delegations && typeof subnet.delegations !== 'string') throw new Error('Subnet delegation must be a service name.');
          const subnetSymbol = subnetSymbols.get(subnetKey(resource, subnet.name))!;
          const subnetNode = nodes.find((node) => node.parentId === resource.node.id && node.data.name === subnet.name && node.id.includes('__subnet__'));
          const nsg = subnetNode && findExportDependency({ ...resource, node: subnetNode }, 'Microsoft.Network/networkSecurityGroups', resources, edges);
          plan.resources.push({ symbol: subnetSymbol, terraformType: 'azurerm_subnet', bicep: {}, terraform: {
            name: subnet.name, resource_group_name: terraform.resource_group_name,
            virtual_network_name: reference(resource, 'name', 'name'), address_prefixes: [subnet.addressPrefix],
            private_endpoint_network_policies: subnet.privateEndpointNetworkPolicies ?? 'Disabled',
            ...(subnet.delegations ? { delegation: [{ name: 'delegation', service_delegation: [{ name: subnet.delegations }] }] } : {}),
          } });
          if (nsg) plan.resources.push({ symbol: `${subnetSymbol}_nsg`, terraformType: 'azurerm_subnet_network_security_group_association', bicep: {}, terraform: {
            subnet_id: new ExportExpression(`azurerm_subnet.${subnetSymbol}.id`, ''), network_security_group_id: reference(nsg),
          } });
          return { name: subnet.name, addressPrefix: subnet.addressPrefix,
            privateEndpointNetworkPolicies: subnet.privateEndpointNetworkPolicies ?? 'Disabled',
            delegation: subnet.delegations || undefined, networkSecurityGroupResourceId: nsg ? reference(nsg) : undefined };
        });
        break;
      }
      case 'Microsoft.Network/networkSecurityGroups':
        mapped.push('defaultAction');
        if (properties.defaultAction !== 'Deny') throw new Error('NSG export supports Azure default inbound rules only (Deny).');
        break;
      case 'Microsoft.Network/publicIPAddresses': {
        field('sku', 'sku', 'skuName');
        field('allocationMethod', 'allocation_method', 'publicIPAllocationMethod');
        field('ipVersion', 'ip_version', 'publicIPAddressVersion');
        field('dnsLabel', 'domain_name_label', 'dnsSettings', properties.dnsLabel, properties.dnsLabel ? { domainNameLabel: properties.dnsLabel } : undefined);
        const zones = properties.availabilityZone === 'Zone-redundant' ? ['1', '2', '3'] : properties.availabilityZone ? [String(properties.availabilityZone)] : [];
        field('availabilityZone', 'zones', 'availabilityZones', zones, zones.map(Number));
        break;
      }
      case 'Microsoft.Network/privateDnsZones': {
        delete terraform.location;
        bicep.location = 'global';
        const vnets = resources.filter((candidate) => candidate.armType === 'Microsoft.Network/virtualNetworks' && edges.some((edge) =>
          (edge.source === resource.node.id && edge.target === candidate.node.id) || (edge.target === resource.node.id && edge.source === candidate.node.id)));
        bicep.virtualNetworkLinks = vnets.map((vnet) => ({ name: vnet.node.data.name, virtualNetworkResourceId: reference(vnet), registrationEnabled: false }));
        for (const vnet of vnets) plan.resources.push({ symbol: `${resource.symbol}_${vnet.symbol}`, terraformType: 'azurerm_private_dns_zone_virtual_network_link', bicep: {}, terraform: {
          name: vnet.node.data.name, resource_group_name: terraform.resource_group_name,
          private_dns_zone_name: reference(resource, 'name', 'name'), virtual_network_id: reference(vnet), registration_enabled: false,
        } });
        break;
      }
      case 'Microsoft.OperationalInsights/workspaces':
        field('sku', 'sku', 'skuName');
        field('retentionDays', 'retention_in_days', 'dataRetention');
        field('dailyQuotaGb', 'daily_quota_gb', 'dailyQuotaGb', properties.dailyQuotaGb, String(properties.dailyQuotaGb));
        field('publicIngestion', 'internet_ingestion_enabled', 'publicNetworkAccessForIngestion', properties.publicIngestion === 'Enabled');
        field('publicQuery', 'internet_query_enabled', 'publicNetworkAccessForQuery', properties.publicQuery === 'Enabled');
        if (properties.sku === 'CapacityReservation') terraform.reservation_capacity_in_gb_per_day = 100;
        break;
      case 'Microsoft.ContainerRegistry/registries':
        field('sku', 'sku', 'acrSku');
        field('adminUserEnabled', 'admin_enabled', 'acrAdminUserEnabled');
        field('publicNetworkAccess', 'public_network_access_enabled', 'publicNetworkAccess', properties.publicNetworkAccess === 'Enabled');
        field('zoneRedundancy', 'zone_redundancy_enabled', 'zoneRedundancy', properties.zoneRedundancy, properties.zoneRedundancy ? 'Enabled' : 'Disabled');
        break;
      case 'Microsoft.KeyVault/vaults':
        field('sku', 'sku_name', 'sku');
        mapped.push('enableSoftDelete');
        if (properties.enableSoftDelete === false) throw new Error('Key Vault soft delete cannot be disabled.');
        bicep.enableSoftDelete = true;
        terraform.tenant_id = new ExportExpression('data.azurerm_client_config.current.tenant_id', 'tenant().tenantId');
        field('softDeleteRetentionDays', 'soft_delete_retention_days', 'softDeleteRetentionInDays');
        field('enablePurgeProtection', 'purge_protection_enabled', 'enablePurgeProtection');
        field('enableRbacAuthorization', 'rbac_authorization_enabled', 'enableRbacAuthorization');
        field('publicNetworkAccess', 'public_network_access_enabled', 'publicNetworkAccess', properties.publicNetworkAccess === 'Enabled');
        break;
      case 'Microsoft.App/managedEnvironments': {
        field('zoneRedundant', 'zone_redundancy_enabled', 'zoneRedundant');
        field('internalLoadBalancerEnabled', 'internal_load_balancer_enabled', 'internal');
        const subnet = subnetReference(resource) ?? ((properties.internalLoadBalancerEnabled || properties.zoneRedundant)
          ? input(`${resource.symbol}_subnet_id`, `Infrastructure subnet ID for ${resource.node.data.name}.`) : undefined);
        terraform.infrastructure_subnet_id = subnet;
        if (!subnet) {
          delete terraform.zone_redundancy_enabled;
          delete terraform.internal_load_balancer_enabled;
        }
        bicep.infrastructureSubnetResourceId = subnet;
        const workspace = dependency(resource, 'Microsoft.OperationalInsights/workspaces', 'workspace_id');
        terraform.log_analytics_workspace_id = workspace;
        bicep.appLogsConfiguration = { destination: 'log-analytics', logAnalyticsWorkspaceResourceId: workspace };
        bicep.publicNetworkAccess = properties.internalLoadBalancerEnabled ? 'Disabled' : 'Enabled';
        terraform.workload_profile = [{ name: 'Consumption', workload_profile_type: 'Consumption' }];
        bicep.workloadProfiles = [{ name: 'Consumption', workloadProfileType: 'Consumption' }];
        break;
      }
      case 'Microsoft.App/containerApps': {
        mapped.push('ingressEnabled', 'ingressExternal', 'targetPort', 'transport', 'containerImage', 'cpu', 'memory', 'minReplicas', 'maxReplicas', 'managedIdentity');
        delete terraform.location;
        terraform.container_app_environment_id = dependency(resource, 'Microsoft.App/managedEnvironments', 'environment_id');
        bicep.environmentResourceId = terraform.container_app_environment_id;
        const image = properties.containerImage || input(`${resource.symbol}_container_image`, `Container image for ${resource.node.data.name}.`);
        const cpu = Number(properties.cpu);
        if (!Number.isFinite(cpu) || cpu <= 0) throw new Error('Container CPU must be a positive number.');
        terraform.revision_mode = 'Single';
        terraform.template = [{ container: [{ name: 'app', image, cpu, memory: properties.memory }], min_replicas: properties.minReplicas, max_replicas: properties.maxReplicas }];
        bicep.containers = [{ name: 'app', image, resources: { cpu, memory: properties.memory } }];
        bicep.scaleSettings = { minReplicas: properties.minReplicas, maxReplicas: properties.maxReplicas };
        bicep.disableIngress = !properties.ingressEnabled;
        if (properties.ingressEnabled) {
          terraform.ingress = [{ external_enabled: properties.ingressExternal, target_port: properties.targetPort, transport: properties.transport,
            ...(properties.transport === 'tcp' ? { exposed_port: properties.targetPort } : {}),
            traffic_weight: [{ percentage: 100, latest_revision: true }] }];
          bicep.ingressExternal = properties.ingressExternal;
          bicep.ingressTargetPort = properties.targetPort;
          bicep.ingressTransport = properties.transport;
          bicep.ingressAllowInsecure = false;
          if (properties.transport === 'tcp') bicep.exposedPort = properties.targetPort;
        }
        if (properties.managedIdentity) {
          terraform.identity = [{ type: 'SystemAssigned' }];
          bicep.managedIdentities = { systemAssigned: true };
        }
        break;
      }
    }
    assertMappedProperties(resource, mapped);
    plan.resources.push({ symbol: resource.symbol, terraformType: definition.terraform, bicepModule: `br/public:avm/res/${definition.avm}`, terraform, bicep });
  }
  if (target === 'bicep') {
    for (const database of resources.filter((resource) => resource.armType === 'Microsoft.Sql/servers/databases')) {
      const parent = findExportDependency(database, 'Microsoft.Sql/servers', resources, edges);
      if (!parent) throw new Error(`AVM SQL database "${database.node.data.name}" requires its SQL server in the diagram, linked or containing the database.`);
      const parentPlan = plan.resources.find((entry) => entry.symbol === parent.symbol)!;
      const databasePlan = plan.resources.find((entry) => entry.symbol === database.symbol)!;
      parentPlan.bicep.databases = [...(parentPlan.bicep.databases as object[] ?? []), databasePlan.bicep];
      databasePlan.bicepModule = undefined;
    }
  }
  const usedInputs = new Set<string>();
  const findInputs = (value: unknown): void => {
    if (value instanceof ExportExpression) {
      const expression = target === 'terraform' ? value.terraform : value.bicep;
      for (const name of Object.keys(plan.inputs)) {
        if (new RegExp(target === 'terraform' ? `\\bvar\\.${name}\\b` : `\\b${name}\\b`).test(expression)) usedInputs.add(name);
      }
    } else if (Array.isArray(value)) value.forEach(findInputs);
    else if (value && typeof value === 'object') Object.values(value).forEach(findInputs);
  };
  for (const resource of plan.resources) {
    if (target === 'terraform' || resource.bicepModule) findInputs(resource[target]);
  }
  for (const name of Object.keys(plan.inputs)) if (!usedInputs.has(name)) delete plan.inputs[name];
  return plan;
}

function objectArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw new Error(`${field} must be an array of objects.`);
  return value;
}

function addressPrefixes(value: unknown): string[] {
  const prefixes = objectArray(value, 'ipSpace').map((entry) => entry.addressPrefix);
  if (!prefixes.length || prefixes.some((prefix) => typeof prefix !== 'string' || !prefix)) throw new Error('Virtual networks require address prefixes.');
  return prefixes as string[];
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('DNS servers must be comma-separated IP addresses.');
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}