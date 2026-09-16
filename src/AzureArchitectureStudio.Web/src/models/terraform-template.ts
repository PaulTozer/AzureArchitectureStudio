import type { AzureEdge, AzureNode } from './diagram';
import { createNativeExportPlan, ExportExpression } from './native-export';
import { resolveKey } from './resource-registry';

export function createTerraformTemplate(nodes: AzureNode[], edges: AzureEdge[] = []): string {
  const plan = createNativeExportPlan(nodes, edges);
  const subscription = nodes.find((node) => resolveKey(node.data.typeKey) === 'subscriptions');
  const group = nodes.find((node) => resolveKey(node.data.typeKey) === 'resource-group');
  const nativeResources: Record<string, Record<string, unknown>> = {};
  for (const resource of plan.resources) {
    nativeResources[resource.terraformType] ??= {};
    nativeResources[resource.terraformType][resource.symbol] = literal(resource.terraform);
  }
  return JSON.stringify({
    terraform: { required_version: '>= 1.5.0', required_providers: { azurerm: { source: 'hashicorp/azurerm', version: '~> 4.81.0' } } },
    provider: { azurerm: { features: {}, subscription_id: '${var.subscription_id}' } },
    variable: {
      subscription_id: { type: 'string', default: literal(subscription?.data.properties.subscriptionId || undefined) },
      resource_group_name: { type: 'string', description: 'Existing resource group.', default: literal(group?.data.name) },
      ...Object.fromEntries(Object.entries(plan.inputs).filter(([, input]) => input.target !== 'bicep').map(([name, input]) => [name, {
        type: input.type ?? 'string', description: literal(input.description), default: literal(input.default), sensitive: input.sensitive,
      }])),
    },
    ...(nativeResources.azurerm_key_vault ? { data: { azurerm_client_config: { current: {} } } } : {}),
    resource: nativeResources,
  }, null, 2);
}

function literal(value: unknown): unknown {
  if (value instanceof ExportExpression) return '${' + value.terraform + '}';
  if (typeof value === 'string') return value.replace(/\$\{/g, () => '$${').replace(/%\{/g, '%%{');
  if (Array.isArray(value)) return value.map(literal);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [literal(key) as string, literal(entry)]));
  return value;
}