import type { AzureEdge, AzureNode } from './diagram';
import { createNativeExportPlan, ExportExpression } from './native-export';

export function createBicepTemplate(nodes: AzureNode[], edges: AzureEdge[] = []): string {
  const plan = createNativeExportPlan(nodes, edges, 'bicep');
  const parameters = Object.entries(plan.inputs).filter(([, input]) => input.target !== 'terraform').map(([name, input]) =>
    `@description(${bicepValue(input.description)})\n${input.sensitive ? '@secure()\n' : ''}param ${name} ${input.bicepType ?? 'string'}${input.default !== undefined ? ` = ${bicepValue(input.default)}` : name === 'location' ? ' = resourceGroup().location' : ''}`);
  const modules = plan.resources.filter((resource) => resource.bicepModule).map((resource) =>
    `module ${resource.symbol} '${resource.bicepModule}' = {\n  params: ${bicepValue(resource.bicep, 1)}\n}`);
  return ["targetScope = 'resourceGroup'", ...parameters, ...modules, ''].join('\n\n');
}

function bicepValue(value: unknown, depth = 0): string {
  if (value instanceof ExportExpression) return value.bicep;
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$\{/g, '\\${').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}'`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot export a non-finite number.');
    return Number.isInteger(value) ? String(value) : `json('${value}')`;
  }
  if (typeof value === 'boolean' || value === null) return String(value);
  const indent = '  '.repeat(depth);
  if (Array.isArray(value)) return value.length ? `[\n${value.map((entry) => `${indent}  ${bicepValue(entry, depth + 1)}`).join('\n')}\n${indent}]` : '[]';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return entries.length ? `{\n${entries.map(([key, entry]) => `${indent}  ${/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : bicepValue(key)}: ${bicepValue(entry, depth + 1)}`).join('\n')}\n${indent}}` : '{}';
  }
  throw new Error('Unsupported Bicep value.');
}