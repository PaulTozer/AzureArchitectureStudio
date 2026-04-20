/**
 * ARM Schema Service
 * Fetches Azure Resource Manager JSON Schema definitions from the public
 * GitHub repository and converts them into PropertyField[] for the form renderer.
 *
 * Flow:
 *   armType (e.g. "Microsoft.Network/networkInterfaces")
 *     → derive provider namespace ("Microsoft.Network")
 *     → look up schema file name + API version from providerConfig
 *     → fetch JSON schema from GitHub raw content
 *     → find resourceDefinition for the resource type name
 *     → resolve $ref to the PropertiesFormat definition
 *     → convert JSON Schema properties → PropertyField[]
 *     → cache and return
 */

import type { PropertyField } from './resource-registry';

// ---------------------------------------------------------------------------
// Provider configuration
// Maps provider namespace → schema file name override + preferred API version.
// File names default to "{provider}.json" when not specified.
// ---------------------------------------------------------------------------
const providerConfig: Record<string, { fileName?: string; apiVersion: string }> = {
  'Microsoft.Network': { fileName: 'Microsoft.Network.NRP', apiVersion: '2024-01-01' },
  'Microsoft.Compute': { apiVersion: '2024-03-01' },
  'Microsoft.Storage': { apiVersion: '2024-01-01' },
  'Microsoft.Web': { apiVersion: '2023-01-01' },
  'Microsoft.Sql': { apiVersion: '2023-08-01' },
  'Microsoft.KeyVault': { apiVersion: '2023-02-01' },
  'Microsoft.ContainerService': { fileName: 'Microsoft.ContainerService.Aks', apiVersion: '2024-01-01' },
  'Microsoft.ContainerRegistry': { apiVersion: '2023-07-01' },
  'Microsoft.Cache': { apiVersion: '2023-08-01' },
  'Microsoft.Cdn': { apiVersion: '2023-05-01' },
  'Microsoft.DocumentDB': { apiVersion: '2023-11-15' },
  'Microsoft.ApiManagement': { apiVersion: '2023-03-01-preview' },
  'Microsoft.ServiceBus': { apiVersion: '2021-11-01' },
  'Microsoft.EventHub': { apiVersion: '2024-01-01' },
  'Microsoft.CognitiveServices': { apiVersion: '2022-10-01' },
  'Microsoft.DBforMySQL': { apiVersion: '2022-01-01' },
  'Microsoft.DBforPostgreSQL': { apiVersion: '2022-12-01' },
  'Microsoft.SignalRService': { apiVersion: '2022-02-01' },
  'Microsoft.OperationalInsights': { apiVersion: '2022-10-01' },
  'Microsoft.Insights': { apiVersion: '2023-01-01' },
  'Microsoft.ManagedIdentity': { apiVersion: '2023-01-31' },
  'Microsoft.ContainerInstance': { apiVersion: '2023-05-01' },
  'Microsoft.App': { apiVersion: '2024-03-01' },
  'Microsoft.EventGrid': { apiVersion: '2022-06-15' },
};

const GITHUB_RAW_BASE =
  'https://raw.githubusercontent.com/Azure/azure-resource-manager-schemas/main/schemas';

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const providerSchemaCache = new Map<string, any>();
const propertyFieldCache = new Map<string, PropertyField[]>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch property fields for an ARM resource type.
 * Returns an empty array when the type is unknown or the schema cannot be
 * resolved (no error thrown).
 */
export async function fetchArmPropertySchema(
  armType: string,
): Promise<PropertyField[]> {
  if (propertyFieldCache.has(armType)) {
    return propertyFieldCache.get(armType)!;
  }

  const slashIdx = armType.indexOf('/');
  if (slashIdx === -1) return [];

  const provider = armType.substring(0, slashIdx);
  const resourceTypeName = armType.substring(slashIdx + 1);

  const config = providerConfig[provider];
  if (!config) return [];

  try {
    const schema = await loadProviderSchema(provider, config);
    if (!schema) return [];

    // Find the resource definition — try the exact name first, then a
    // case-insensitive search.
    const resourceDefs = schema.resourceDefinitions ?? {};
    let resDef = resourceDefs[resourceTypeName];
    if (!resDef) {
      const lower = resourceTypeName.toLowerCase();
      const match = Object.keys(resourceDefs).find(
        (k) => k.toLowerCase() === lower,
      );
      if (match) resDef = resourceDefs[match];
    }
    if (!resDef) return [];

    // The "properties" field of the resource definition typically contains a
    // $ref or oneOf to a "...PropertiesFormat" definition.
    const propsSpec = resDef.properties?.properties;
    if (!propsSpec) return [];

    const propsDef = resolvePropertySpec(propsSpec, schema);
    if (!propsDef?.properties) return [];

    const fields = convertProperties(propsDef.properties, schema);
    propertyFieldCache.set(armType, fields);
    return fields;
  } catch {
    return [];
  }
}

/**
 * Returns the API version configured for a given ARM resource type, or
 * undefined if the provider is not configured.
 */
export function getConfiguredApiVersion(armType: string): string | undefined {
  const slashIdx = armType.indexOf('/');
  if (slashIdx === -1) return undefined;
  return providerConfig[armType.substring(0, slashIdx)]?.apiVersion;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadProviderSchema(
  provider: string,
  config: { fileName?: string; apiVersion: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const cacheKey = `${provider}@${config.apiVersion}`;
  if (providerSchemaCache.has(cacheKey)) {
    return providerSchemaCache.get(cacheKey);
  }

  const fileName = config.fileName ?? provider;
  const url = `${GITHUB_RAW_BASE}/${config.apiVersion}/${fileName}.json`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const schema = await res.json();
  providerSchemaCache.set(cacheKey, schema);
  return schema;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolvePropertySpec(spec: any, root: any): any {
  // Direct $ref
  if (spec.$ref && spec.$ref.startsWith('#/')) {
    return resolveLocalRef(root, spec.$ref);
  }
  // oneOf pattern: [ { $ref: "#/definitions/FooFormat" }, { $ref: "common/expression" } ]
  if (Array.isArray(spec.oneOf)) {
    const localRef = spec.oneOf.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item: any) => item.$ref && item.$ref.startsWith('#/'),
    );
    if (localRef) return resolveLocalRef(root, localRef.$ref);
  }
  // Inline properties
  if (spec.properties) return spec;
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveLocalRef(root: any, ref: string): any {
  const parts = ref.replace('#/', '').split('/');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = root;
  for (const part of parts) {
    current = current?.[part];
    if (current === undefined) return null;
  }
  return current;
}

// ---------------------------------------------------------------------------
// JSON Schema → PropertyField[] conversion
// ---------------------------------------------------------------------------

function convertProperties(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root: any,
): PropertyField[] {
  const fields: PropertyField[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    const field = convertSingleProperty(key, prop, root);
    if (field) fields.push(field);
  }
  return fields;
}

function convertSingleProperty(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prop: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  root: any,
): PropertyField | null {
  const label = humanize(key);
  const description = prop.description as string | undefined;

  // Resolve the actual type info — ARM schemas wrap values in oneOf with
  // an expression alternative we can ignore.
  let resolvedType: string | undefined = prop.type;
  let resolvedEnum: string[] | undefined = prop.enum;

  if (Array.isArray(prop.oneOf)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actual = prop.oneOf.find((o: any) => !o.$ref);
    if (actual) {
      resolvedType = actual.type;
      resolvedEnum = actual.enum;
    } else {
      // All items are $refs — likely complex nested objects, skip.
      // But first check if any local $ref resolves to an enum.
      for (const item of prop.oneOf) {
        if (item.$ref?.startsWith('#/')) {
          const resolved = resolveLocalRef(root, item.$ref);
          if (resolved?.enum) {
            resolvedEnum = resolved.enum;
            resolvedType = resolved.type ?? 'string';
            break;
          }
          // Complex object — skip this property
        }
      }
      if (!resolvedEnum) return null;
    }
  }

  // $ref to a definition (not inside oneOf)
  if (prop.$ref?.startsWith('#/')) {
    const resolved = resolveLocalRef(root, prop.$ref);
    if (resolved?.enum) {
      resolvedEnum = resolved.enum;
      resolvedType = resolved.type ?? 'string';
    } else {
      return null; // Complex nested type
    }
  }

  // Enum → select dropdown
  if (resolvedEnum && resolvedEnum.length > 0) {
    return {
      key,
      label,
      type: 'select',
      options: resolvedEnum.map((v: string) => ({
        label: String(v),
        value: String(v),
      })),
      placeholder: description,
    };
  }

  switch (resolvedType) {
    case 'string':
      return { key, label, type: 'string', placeholder: description };
    case 'boolean':
      return { key, label, type: 'boolean', defaultValue: false };
    case 'integer':
    case 'number':
      return { key, label, type: 'number', defaultValue: 0 };
    default:
      return null; // Skip object/array/unknown types
  }
}

/**
 * Convert camelCase/PascalCase key to human-readable label.
 * "enableAcceleratedNetworking" → "Enable Accelerated Networking"
 */
function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase());
}
