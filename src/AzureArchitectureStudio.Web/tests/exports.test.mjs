import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
let server;
let createDiagramArmTemplate;
let createTerraformTemplate;
let createBicepTemplate;

before(async () => {
  server = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false } });
  const registry = await server.ssrLoadModule('/src/models/resource-registry.ts');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(await readFile(new URL(`../public${url}`, import.meta.url)));
  try {
    await registry.loadResourceTypeRegistry();
  } finally {
    globalThis.fetch = originalFetch;
  }
  ({ createDiagramArmTemplate } = await server.ssrLoadModule('/src/models/arm-template.ts'));
  ({ createTerraformTemplate } = await server.ssrLoadModule('/src/models/terraform-template.ts'));
  ({ createBicepTemplate } = await server.ssrLoadModule('/src/models/bicep-template.ts'));
});

after(async () => { await server?.close(); });

test('Every deployable curated catalog type has a native Terraform and AVM mapping', async () => {
  const catalog = JSON.parse(await readFile(new URL('../public/resource-types.json', import.meta.url), 'utf8'));
  const scopeContainers = ['entra-tenant', 'management-groups', 'subscriptions', 'resource-group'];
  for (const definition of catalog.filter((entry) => !scopeContainers.includes(entry.key))) {
    const nodes = definition.key === 'sql-database'
      ? [node('server', 'sql-server'), node('catalog-resource', definition.key, {}, 'server')]
      : [node('catalog-resource', definition.key)];
    for (const generate of [createTerraformTemplate, createBicepTemplate]) {
      assert.doesNotThrow(() => generate(nodes), `${definition.key} must export`);
    }
  }
});

const node = (id, typeKey, properties = {}, parentId) => ({
  id, parentId, position: { x: 0, y: 0 },
  data: { typeKey, name: id, properties, location: '' },
});

test('ARM exports resources, omits the resource group, and preserves inline subnets', () => {
  const template = createDiagramArmTemplate([
    node('rg', 'resource-group', { location: 'eastus2' }),
    node('vnet', 'virtual-networks', {
      ipSpace: [{ addressPrefix: '10.0.0.0/16' }],
      subnets: [{ name: 'apps', addressPrefix: '10.0.0.0/24', delegations: 'Microsoft.App/environments' }],
    }, 'rg'),
    node('vnet__subnet__0', 'subnet', {}, 'vnet'),
  ]);
  assert.equal(template.parameters.location.defaultValue, 'eastus2');
  assert.equal(template.resources.length, 1);
  assert.deepEqual(template.resources[0].properties.addressSpace.addressPrefixes, ['10.0.0.0/16']);
  assert.deepEqual(template.resources[0].properties.subnets, [{
    name: 'apps', properties: {
      addressPrefix: '10.0.0.0/24',
      delegations: [{ name: 'delegation', properties: { serviceName: 'Microsoft.App/environments' } }],
    },
  }]);
});

test('ARM rejects empty, container-only, unsupported, and multi-resource-group diagrams', () => {
  assert.throws(() => createDiagramArmTemplate([]), /no deployable resources/);
  assert.throws(() => createDiagramArmTemplate([node('rg', 'resource-group')]), /no deployable resources/);
  assert.throws(() => createDiagramArmTemplate([node('unknown', 'unsupported-type')]), /no supported ARM definition/);
  assert.throws(() => createDiagramArmTemplate([node('one', 'resource-group'), node('two', 'resource-groups')]), /one resource group/);
});

test('Terraform exports native storage resources and escapes literal template markers', () => {
  const configuration = JSON.parse(createTerraformTemplate([node('storage', 'storage-account', {
    sku: 'Standard_GRS', tags: { literal: '${not_a_variable} %{not_a_directive}', quotes: '"hello"\nworld' },
  })]));
  const storage = configuration.resource.azurerm_storage_account.resource_storage;
  assert.equal(configuration.terraform.required_providers.azurerm.source, 'hashicorp/azurerm');
  assert.equal(configuration.terraform.required_providers.azurerm.version, '~> 4.81.0');
  assert.equal(configuration.resource.azurerm_resource_group_template_deployment, undefined);
  assert.equal(storage.resource_group_name, '${var.resource_group_name}');
  assert.equal(storage.account_tier, 'Standard');
  assert.equal(storage.account_replication_type, 'GRS');
  assert.equal(storage.tags.literal, '$${not_a_variable} %%{not_a_directive}');
  assert.equal(storage.tags.quotes, '"hello"\nworld');
});

test('Bicep exports a pinned AVM storage module, including defaults and literal escaping', () => {
  const bicep = createBicepTemplate([node('storage', 'storage-account', { tags: { note: "it's ${literal}\ntext" } })]);
  assert.match(bicep, /module resource_storage 'br\/public:avm\/res\/storage\/storage-account:0\.33\.0'/);
  assert.match(bicep, /skuName: 'Standard_LRS'/);
  assert.match(bicep, /enableTelemetry: false/);
  assert.ok(bicep.includes("it\\'s \\${literal}\\ntext"));
  assert.doesNotMatch(bicep, /^resource /m);
});

test('Native exports connect subnet, environment, workspace and container app resources', () => {
  const nodes = [
    node('network', 'virtual-networks', { subnets: [{ name: 'apps', addressPrefix: '10.0.0.0/24', delegations: 'Microsoft.App/environments' }] }),
    node('network__subnet__0', 'subnet', {}, 'network'),
    node('logs', 'log-analytics'),
    node('environment', 'container-apps-environments', {}, 'network__subnet__0'),
    node('web', 'container-apps', { containerImage: 'example/app:v1', managedIdentity: true }, 'environment'),
  ];
  nodes[1].data.name = 'apps';
  const edges = [{ id: 'logs-link', source: 'environment', target: 'logs' }];
  const terraform = JSON.parse(createTerraformTemplate(nodes, edges));
  assert.equal(terraform.resource.azurerm_container_app.resource_web.container_app_environment_id, '${azurerm_container_app_environment.resource_environment.id}');
  assert.equal(terraform.resource.azurerm_container_app_environment.resource_environment.log_analytics_workspace_id, '${azurerm_log_analytics_workspace.resource_logs.id}');
  assert.equal(terraform.resource.azurerm_container_app_environment.resource_environment.infrastructure_subnet_id, '${azurerm_subnet.resource_network_subnet_apps.id}');
  assert.equal(terraform.resource.azurerm_container_app.resource_web.template[0].container[0].cpu, 0.5);
  const bicep = createBicepTemplate(nodes, edges);
  assert.match(bicep, /environmentResourceId: resource_environment.outputs.resourceId/);
  assert.match(bicep, /infrastructureSubnetResourceId: resource_network.outputs.subnetResourceIds\[0\]/);
  assert.match(bicep, /delegation: 'Microsoft.App\/environments'/);
  assert.match(bicep, /cpu: json\('0.5'\)/);
});

test('Native exports fail closed for unsupported resources and properties', () => {
  for (const generate of [createTerraformTemplate, createBicepTemplate]) {
    assert.throws(() => generate([]), /no deployable resources/);
    assert.throws(() => generate([node('rg', 'resource-group'), node('other', 'resource-groups')]), /one existing resource group/);
    assert.throws(() => generate([node('unknown', 'unmapped-type')]), /unsupported resource type/);
    assert.throws(() => generate([node('storage', 'storage-account', { customProperty: true })]), /unsupported properties: customProperty/);
    assert.throws(() => generate([node('storage', 'storage-account', { enableHns: 'false' })]), /Invalid enableHns/);
    assert.throws(() => generate([node('nsg', 'nsg', { defaultAction: 'Allow' })]), /default inbound rules/);
    assert.throws(() => generate([node('vnet', 'virtual-networks', { subnets: [{ name: 'apps', addressPrefix: '10.0.0.0/24', unknown: true }] })]), /Unsupported subnet properties/);
    const nodes = [node('app', 'container-apps'), node('one', 'container-apps-environments'), node('two', 'container-apps-environments')];
    assert.throws(() => generate(nodes, [{ source: 'app', target: 'one' }, { source: 'app', target: 'two' }]), /multiple connected/);
  }
});

test('Native exports unwrap advanced editor fields without losing configuration', () => {
  for (const generate of [createTerraformTemplate, createBicepTemplate]) {
    for (const advanced of [{}, { unused: '' }, null]) {
      const baseline = [node('gateway', 'virtual-network-gateways')];
      const edited = [node('gateway', 'virtual-network-gateways', { __armSpecAdvanced__: advanced })];
      assert.equal(generate(edited), generate(baseline));
      assert.deepEqual(edited[0].data.properties, { __armSpecAdvanced__: advanced });
    }
    assert.equal(
      generate([node('storage', 'storage-account', { __armSpecAdvanced__: { enableHns: true } })]),
      generate([node('storage', 'storage-account', { enableHns: true })]),
    );
    assert.throws(() => generate([node('storage', 'storage-account', { __armSpecAdvanced__: { customProperty: false } })]), /unsupported properties: customProperty/);
    assert.throws(() => generate([node('storage', 'storage-account', { __armSpecAdvanced__: { enableHns: 'false' } })]), /Invalid enableHns/);
    assert.throws(() => generate([node('storage', 'storage-account', { enableHns: false, __armSpecAdvanced__: { enableHns: true } })]), /both standard and advanced/);
    assert.throws(() => generate([node('storage', 'storage-account', { __armSpecAdvanced__: [] })]), /Invalid advanced properties/);
  }
});

test('Gateway exports preserve active-active and BGP modes from advanced settings', () => {
  for (const activeActive of [false, true]) {
    for (const enableBgp of [false, true]) {
      const nodes = [node('gateway', 'virtual-network-gateways', { enableBgp, __armSpecAdvanced__: { activeActive } })];
      const terraform = JSON.parse(createTerraformTemplate(nodes));
      const gateway = terraform.resource.azurerm_virtual_network_gateway.resource_gateway;
      assert.equal(gateway.active_active, activeActive);
      assert.equal(gateway.bgp_enabled, enableBgp);
      assert.equal(gateway.ip_configuration.length, activeActive ? 2 : 1);
      const bicep = createBicepTemplate(nodes);
      assert.ok(bicep.includes(`clusterMode: '${activeActive ? 'activeActive' : 'activePassive'}${enableBgp ? 'Bgp' : 'NoBgp'}'`));
      if (activeActive) {
        assert.equal(gateway.ip_configuration[1].subnet_id, gateway.ip_configuration[0].subnet_id);
        assert.equal(gateway.ip_configuration[1].public_ip_address_id, '${var.resource_gateway_secondary_public_ip_id}');
        assert.equal(terraform.variable.resource_gateway_secondary_public_ip_id.default, undefined);
        assert.match(bicep, /existingSecondaryPublicIPResourceId: resource_gateway_secondary_public_ip_id/);
      } else {
        assert.equal(terraform.variable.resource_gateway_secondary_public_ip_id, undefined);
        assert.doesNotMatch(bicep, /secondary_public_ip_id/);
      }
      assert.equal(createTerraformTemplate([node('gateway', 'virtual-network-gateways', { activeActive, enableBgp })]), createTerraformTemplate(nodes));
    }
  }
  for (const generate of [createTerraformTemplate, createBicepTemplate]) {
    assert.throws(() => generate([node('gateway', 'virtual-network-gateways', { activeActive: 'false' })]), /Invalid activeActive/);
    for (const incompatible of [{ gatewayType: 'ExpressRoute' }, { vpnType: 'PolicyBased' }, { sku: 'Basic' }]) {
      assert.throws(() => generate([node('gateway', 'virtual-network-gateways', { activeActive: true, ...incompatible })]), /Active-active gateways require/);
    }
  }
});

test('Native exports preserve addresses on reorder and emit missing inputs without fake values', () => {
  const nodes = [node('app', 'container-apps'), node('storage', 'storage-account')];
  const terraform = JSON.parse(createTerraformTemplate(nodes));
  assert.deepEqual(terraform.resource, JSON.parse(createTerraformTemplate([...nodes].reverse())).resource);
  assert.equal(terraform.variable.resource_app_environment_id.default, undefined);
  assert.equal(terraform.variable.resource_app_container_image.default, undefined);
  assert.equal(terraform.resource.azurerm_container_app.resource_app.template[0].container[0].image, '${var.resource_app_container_image}');
  assert.match(createBicepTemplate(nodes), /param resource_app_environment_id string\n/);
  assert.match(createBicepTemplate(nodes), /param resource_app_container_image string\n/);
  const located = node('storage', 'storage-account');
  located.data.location = 'westus2';
  assert.equal(JSON.parse(createTerraformTemplate([located])).resource.azurerm_storage_account.resource_storage.location, 'westus2');
});

test('All supported defaults export, with optional generated fixtures for CLI validation', async () => {
  const nodes = [
    node('storage', 'storage-account', { tags: { "quote'${key}": "it's ${literal}\ntext" } }),
    node('network', 'virtual-networks', { subnets: [{ name: 'apps', addressPrefix: '10.0.0.0/24', delegations: 'Microsoft.App/environments' }], enableDdosProtection: true, dnsServers: '10.0.0.4, 10.0.0.5' }),
    node('network__subnet__0', 'subnet', {}, 'network'),
    node('nsg', 'nsg'), node('ip', 'public-ip'), node('logs', 'log-analytics'),
    node('registry', 'container-registry'), node('vault', 'key-vault'),
    node('environment', 'container-apps-environments', {}, 'network__subnet__0'),
    node('app', 'container-apps', { containerImage: 'example/app:v1', managedIdentity: true }, 'environment'),
    node('private.example.com', 'private-dns-zones'),
  ];
  nodes[2].data.name = 'apps';
  const edges = [
    { source: 'environment', target: 'logs' },
    { source: 'network__subnet__0', target: 'nsg' },
    { source: 'private.example.com', target: 'network' },
  ];
  const terraform = createTerraformTemplate(nodes, edges);
  const bicep = createBicepTemplate(nodes, edges);
  const configuration = JSON.parse(terraform);
  assert.equal(configuration.resource.azurerm_storage_account.resource_storage.tags["quote'$${key}"], "it's $${literal}\ntext");
  assert.equal(Object.keys(configuration.resource).length, 13);
  assert.equal((bicep.match(/^module /gm) ?? []).length, 10);
  assert.doesNotMatch(terraform, /template_deployment|template_content|azapi_resource/);
  assert.match(bicep, /networkSecurityGroupResourceId: resource_nsg.outputs.resourceId/);
  if (process.env.EXPORT_VALIDATION_DIR) {
    await mkdir(process.env.EXPORT_VALIDATION_DIR, { recursive: true });
    await writeFile(join(process.env.EXPORT_VALIDATION_DIR, 'main.tf.json'), terraform);
    await writeFile(join(process.env.EXPORT_VALIDATION_DIR, 'main.bicep'), bicep);
  }
});

test('Full catalog fixtures preserve native types, secure inputs, and SQL parent composition', async () => {
  const catalog = JSON.parse(await readFile(new URL('../public/resource-types.json', import.meta.url), 'utf8'));
  const nodes = catalog.filter((entry) => !['entra-tenant', 'management-groups', 'subscriptions', 'resource-group'].includes(entry.key))
    .map((entry) => node(entry.key, entry.key, {}, entry.key === 'sql-database' ? 'sql-server' : undefined));
  nodes.push(
    node('windowsvm', 'virtual-machine', { osType: 'windows', authenticationType: 'password', adminPassword: 'must-not-export' }),
    node('flexfunction', 'function-app', { hostingPlan: 'flex-consumption', runtimeStack: 'dotnet-isolated|v8.0', managedIdentity: true }),
    node('wafgateway', 'app-gateway', { tier: 'WAF_v2', enableAutoScale: true, wafMode: 'Prevention' }),
    node('activegateway', 'virtual-network-gateways', { enableBgp: true, __armSpecAdvanced__: { activeActive: true } }),
    node('wafcdn', 'front-door', { enableWaf: true, enableCaching: true }),
    node('aadsql', 'sql-server', { enableAadAuth: true, aadOnlyAuthentication: true, identityType: 'SystemAssigned' }),
    node('haPostgres', 'postgresql', { enableEntraAuth: true, sku: 'Standard_D2s_v3', highAvailability: 'ZoneRedundant' }),
    node('continuouscosmos', 'cosmos-db', { apiKind: 'MongoDB', backupPolicy: 'Continuous7Days' }),
  );
  for (const os of ['linux', 'windows']) {
    for (const runtimeStack of ['dotnet|v8.0', 'node|~22', 'java|21']) {
      nodes.push(node(`${os}${runtimeStack.replace(/[^a-z0-9]/gi, '')}`, 'web-app', { os, runtimeStack }));
      nodes.push(node(`${os}fn${runtimeStack.replace(/[^a-z0-9]/gi, '')}`, 'function-app', { os, runtimeStack, hostingPlan: 'premium' }));
    }
  }
  nodes.push(node('linuxpython', 'web-app', { runtimeStack: 'python|3.12' }), node('linuxphp', 'web-app', { runtimeStack: 'php|8.3' }),
    node('linuxdocker', 'web-app', { publish: 'docker', dockerImage: 'example/app:v1' }),
    node('windowsdocker', 'web-app', { os: 'windows', publish: 'docker', dockerImage: 'example/app:v1' }));
  for (const resource of nodes) resource.data.name = resource.data.typeKey === 'dns-zone' ? 'example.com' : resource.id.replace(/-/g, '').toLowerCase();
  const terraform = createTerraformTemplate(nodes);
  const bicep = createBicepTemplate(nodes);
  const configuration = JSON.parse(terraform);
  assert.equal(configuration.variable.resource_sqlserver_admin_password.sensitive, true);
  assert.equal(configuration.variable.resource_sqlserver_admin_password.default, undefined);
  assert.match(bicep, /@secure\(\)\nparam resource_sqlserver_admin_password string/);
  assert.match(bicep, /databases: \[/);
  assert.doesNotMatch(terraform, /azapi_resource|template_deployment/);
  assert.doesNotMatch(terraform + bicep, /must-not-export/);
  assert.ok(configuration.resource.azurerm_function_app_flex_consumption.resource_flexfunction);
  if (process.env.EXPORT_VALIDATION_DIR) {
    await writeFile(join(process.env.EXPORT_VALIDATION_DIR, 'main.tf.json'), terraform);
    await writeFile(join(process.env.EXPORT_VALIDATION_DIR, 'main.bicep'), bicep);
  }
});

test('Scope containers select an existing deployment context without provisioning tenants or subscriptions', () => {
  const nodes = [node('tenant', 'entra-tenant'), node('management', 'management-groups', {}, 'tenant'),
    node('subscription', 'subscriptions', { subscriptionId: 'test-subscription' }, 'management'),
    node('rg', 'resource-group', {}, 'subscription'), node('storage', 'storage-account', {}, 'rg')];
  const terraform = JSON.parse(createTerraformTemplate(nodes));
  assert.equal(terraform.variable.subscription_id.default, 'test-subscription');
  assert.equal(terraform.variable.resource_group_name.default, 'rg');
  assert.equal(Object.keys(terraform.resource).length, 1);
  assert.equal((createBicepTemplate(nodes).match(/^module /gm) ?? []).length, 1);
  assert.throws(() => createTerraformTemplate([...nodes, node('another', 'subscriptions')]), /one existing tenant and subscription/);
});

test('Provider and AVM limitations fail explicitly instead of dropping selected settings', () => {
  assert.throws(() => createTerraformTemplate([node('bus', 'service-bus', { zoneRedundant: true })]), /service-managed/);
  assert.throws(() => createTerraformTemplate([node('site', 'static-web-app', { appLocation: '/client' })]), /deployment workflow/);
  assert.throws(() => createTerraformTemplate([node('bastion', 'azure-bastions', { enablePrivateOnly: true })]), /read-only/);
  assert.throws(() => createBicepTemplate([node('bastion', 'azure-bastions', { tier: 'Standard', enableTunneling: false })]), /cannot be represented/);
  assert.throws(() => createTerraformTemplate([node('function', 'function-app', { os: 'windows', hostingPlan: 'flex-consumption' })]), /Linux only/);
  assert.throws(() => createBicepTemplate([node('database', 'sql-database')]), /requires its SQL server/);
});

test('Catalog aliases retain defaults and exporters only request inputs used by that format', () => {
  for (const [alias, canonical] of [
    ['azure-cosmos-db', 'cosmos-db'], ['load-balancers', 'load-balancer'], ['application-insights', 'app-insights'],
    ['azure-firewalls', 'azure-firewall'], ['managed-disks', 'managed-disk'], ['network-security-groups', 'nsg'],
    ['dns-zones', 'dns-zone'], ['azure-front-door-profiles', 'front-door'], ['azure-service-bus', 'service-bus'],
  ]) {
    assert.equal(createTerraformTemplate([node('resource', alias)]), createTerraformTemplate([node('resource', canonical)]));
    assert.equal(createBicepTemplate([node('resource', `${alias}--networking`)]), createBicepTemplate([node('resource', canonical)]));
  }
  const firewall = JSON.parse(createTerraformTemplate([node('firewall', 'azure-firewall')]));
  assert.ok(firewall.variable.resource_firewall_subnet_id);
  assert.equal(firewall.variable.resource_firewall_virtual_network_id, undefined);
  const bicep = createBicepTemplate([node('firewall', 'azure-firewall')]);
  assert.match(bicep, /param resource_firewall_virtual_network_id string/);
  assert.doesNotMatch(bicep, /param resource_firewall_subnet_id/);
});

test('Bicep and Terraform use resource names with stable collision handling and connected references', () => {
  const nodes = [node('azure-1789561257002', 'container-apps-environments'), node('azure-1789561312929', 'container-apps', {}, 'azure-1789561257002')];
  nodes[0].data.name = 'Prod-Apps.Eastus';
  nodes[1].data.name = 'prod-web-eastus';
  const terraform = JSON.parse(createTerraformTemplate(nodes));
  assert.equal(terraform.resource.azurerm_container_app.resource_prod_web_eastus.container_app_environment_id, '${azurerm_container_app_environment.resource_prod_apps_eastus.id}');
  assert.equal(terraform.resource.azurerm_container_app.resource_prod_web_eastus.name, 'prod-web-eastus');
  const bicep = createBicepTemplate(nodes);
  assert.match(bicep, /module resource_prod_apps_eastus /);
  assert.match(bicep, /environmentResourceId: resource_prod_apps_eastus.outputs.resourceId/);
  assert.doesNotMatch(bicep + JSON.stringify(terraform), /178956/);

  const duplicates = ['prod-app', 'prod.app', 'prod_app_2', '', '123 app', 'prod-app'].map((name, index) => {
    const resource = node(`id-${index}`, 'storage-account'); resource.data.name = name; return resource;
  });
  const config = JSON.parse(createTerraformTemplate(duplicates));
  const names = Object.keys(config.resource.azurerm_storage_account);
  assert.equal(new Set(names).size, duplicates.length);
  assert.ok(names.includes('resource_prod_app_2'));
  assert.ok(names.includes('resource_unnamed'));
  assert.ok(names.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)));
  assert.deepEqual(config.resource, JSON.parse(createTerraformTemplate([...duplicates].reverse())).resource);
  const moduleNames = [...createBicepTemplate(duplicates).matchAll(/^module (\w+) /gm)].map((match) => match[1]);
  assert.deepEqual(moduleNames, names);
});

test('Subnet names are readable and normalized collisions retain their own references', () => {
  const network = node('opaque-network-id', 'virtual-networks', { subnets: [
    { name: 'app-net', addressPrefix: '10.0.0.0/24' }, { name: 'app.net', addressPrefix: '10.0.1.0/24' },
  ] });
  network.data.name = 'prod-vnet';
  const subnet = node('opaque-network-id__subnet__1', 'subnet', {}, network.id);
  subnet.data.name = 'app.net';
  const environment = node('opaque-environment-id', 'container-apps-environments', {}, subnet.id);
  environment.data.name = 'prod-env';
  const nodes = [network, subnet, environment];
  const config = JSON.parse(createTerraformTemplate(nodes));
  assert.equal(config.resource.azurerm_subnet.resource_prod_vnet_subnet_app_net.name, 'app-net');
  assert.equal(config.resource.azurerm_subnet.resource_prod_vnet_subnet_app_net_2.name, 'app.net');
  assert.equal(config.resource.azurerm_container_app_environment.resource_prod_env.infrastructure_subnet_id, '${azurerm_subnet.resource_prod_vnet_subnet_app_net_2.id}');
  assert.match(createBicepTemplate(nodes), /infrastructureSubnetResourceId: resource_prod_vnet.outputs.subnetResourceIds\[1\]/);
});