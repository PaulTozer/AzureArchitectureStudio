// ARM template generation — data-driven via resource-registry.ts

import { getResourceType } from './resource-registry';

export interface Parameter {
  type: string;
  defaultValue?: string;
  metadata?: Record<string, string>;
}

export interface DeploymentTemplate {
  $schema: string;
  contentVersion: string;
  parameters: Record<string, Parameter>;
  variables: Record<string, unknown>;
  resources: ArmResource[];
}

export interface ArmResource {
  type: string;
  apiVersion: string;
  name: string;
  location: string;
  dependsOn?: string[];
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export function createArmTemplate(): DeploymentTemplate {
  return {
    $schema:
      'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    parameters: {
      location: {
        type: 'string',
        defaultValue: '[resourceGroup().location]',
        metadata: { description: 'Location for all resources.' },
      },
    },
    variables: {},
    resources: [],
  };
}

/**
 * Helper: set a nested value on an object given a dotted path.
 *   setNestedValue(obj, 'properties.addressSpace.addressPrefixes', [...])
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Generate ARM resources for a node using its registry definition.
 * No more giant switch statement — the registry drives everything.
 */
export function getArmResourcesForNode(
  typeKey: string,
  name: string,
  properties: Record<string, unknown>
): { resources: ArmResource[]; parameters: Record<string, Parameter> } {
  const def = getResourceType(typeKey);

  // Fallback for unknown types — still emit a skeleton resource
  if (!def) {
    return {
      resources: [
        {
          type: `Unknown/${typeKey}`,
          apiVersion: '2023-01-01',
          name,
          location: "[parameters('location')]",
          properties: { ...properties },
        },
      ],
      parameters: {},
    };
  }

  const armResource: ArmResource = {
    type: def.armType,
    apiVersion: def.apiVersion,
    name,
    location: "[parameters('location')]",
    properties: {},
  };

  // Apply static defaults from the registry (kind, sku, etc.)
  if (def.armDefaults) {
    Object.assign(armResource, def.armDefaults);
  }

  // Apply property mappings: user properties → ARM properties paths
  const mapping = def.armMapping;
  if (mapping?.propertyMappings) {
    for (const [propKey, armPath] of Object.entries(mapping.propertyMappings)) {
      const val = properties[propKey];
      if (val !== undefined && val !== null && val !== '') {
        // Special handling for array fields (like ipSpace → addressPrefixes)
        if (Array.isArray(val)) {
          const fieldDef = def.propertySchema.find((f) => f.key === propKey);
          if (fieldDef?.type === 'array' && fieldDef.itemSchema) {
            const itemKey = fieldDef.itemSchema.key;
            const mapped = val.map((item: Record<string, string>) => item[itemKey]);
            setNestedValue(armResource, armPath, mapped);
          } else {
            setNestedValue(armResource, armPath, val);
          }
        } else {
          setNestedValue(armResource, armPath, val);
        }
      }
    }
  }

  // Handle SKU shorthand
  if (mapping?.skuProperty) {
    const skuVal = properties[mapping.skuProperty];
    if (skuVal) {
      armResource.sku = { name: skuVal };
    }
  }

  const parameters: Record<string, Parameter> = {};

  // Emit declared parameters
  if (mapping?.parameters) {
    for (const p of mapping.parameters) {
      const paramName = p.name.includes('Name')
        ? `${name}${p.name}`
        : p.name;
      parameters[paramName] = {
        type: p.type,
        metadata: { description: p.description },
      };
    }
  }

  return { resources: [armResource], parameters };
}

