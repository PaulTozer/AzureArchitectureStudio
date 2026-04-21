// Data-driven resource type registry.
// Curated definitions from /resource-types.json are loaded at startup.
// For types without curated schemas, ARM schemas are fetched on demand
// from the public GitHub repository and converted automatically.

import {
  fetchArmPropertySchema,
  getConfiguredApiVersion,
} from './arm-schema-service';

export interface PropertyField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'radio' | 'array' | 'password' | 'object' | 'object-array';
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  required?: boolean;
  /** Schema for items in a simple string array */
  itemSchema?: PropertyField;
  visibleWhen?: { field: string; value: string | string[] };
  /** Child fields for 'object' and 'object-array' types */
  children?: PropertyField[];
}

export interface ArmMappingDef {
  skuProperty?: string;
  propertyMappings?: Record<string, string>;
  parameters?: { name: string; type: string; description: string }[];
}

/** Declares an external resource this type depends on (e.g. Bastion needs a Public IP and a subnet). */
export interface ResourceDependencyDef {
  /** Property key on this node where the chosen target resource id is stored */
  key: string;
  /** Display label shown in the dependency panel */
  label: string;
  /** Target resource type key (registry key) the dependency resolves to */
  targetType: string;
  /** Whether the dependency is required for the resource to be valid */
  required?: boolean;
  /** When true, the parent group's id is auto-bound if the parent matches targetType */
  autoFromParent?: boolean;
  /** Optional helper text shown when unfulfilled */
  hint?: string;
  /** Optional exact name(s) the resolved target must have (case-sensitive). Used for Azure-mandated names like AzureBastionSubnet. */
  requiredName?: string | string[];
}

export interface ResourceTypeDefinition {
  key: string;
  displayName: string;
  armType: string;
  apiVersion: string;
  isGroup?: boolean;
  groupVariant?: 'resource-group' | 'vnet' | 'subnet';
  groupStyle?: { width: number; height: number };
  armDefaults?: Record<string, unknown>;
  propertySchema: PropertyField[];
  armMapping?: ArmMappingDef;
  dependencies?: ResourceDependencyDef[];
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
/** Curated definitions from resource-types.json */
let registry: Map<string, ResourceTypeDefinition> = new Map();

/** Maps service-key → ARM resource type (e.g. "network-interfaces" → "Microsoft.Network/networkInterfaces") */
let armTypeMap: Record<string, string> = {};

/** Aliases mapping stencil/service keys to curated registry keys.
 *  Use this when the azure-services.json key differs from the resource-types.json key
 *  (e.g. "bastions" → "azure-bastions"). */
const KEY_ALIASES: Record<string, string> = {
  bastions: 'azure-bastions',
  'bastion-hosts': 'azure-bastions',
  'virtual-machines': 'virtual-machine',
  'storage-accounts': 'storage-account',
  'sql-servers': 'sql-server',
  'sql-databases': 'sql-database',
  'public-ip-addresses': 'public-ip',
  'application-gateways': 'app-gateway',
  'kubernetes-services': 'aks-cluster',
  'api-management-services': 'apim',
  'function-apps': 'function-app',
  'app-services': 'web-app',
  'app-service-plans': 'appservice-plan',
  firewalls: 'azure-firewall',
  'virtual-network-gateways': 'vpn-gateway',
  'resource-groups': 'resource-group',
};

/** Resolves any incoming key to its canonical registry key. */
function resolveKey(key: string): string {
  // Strip any --category dedup suffix from azure-services.json
  const base = key.replace(/--.*$/, '');
  return KEY_ALIASES[base] ?? base;
}

/** Dynamically-resolved definitions (fetched from ARM schemas at runtime) */
const dynamicRegistry: Map<string, ResourceTypeDefinition> = new Map();

// ---------------------------------------------------------------------------
// Startup loading
// ---------------------------------------------------------------------------

export async function loadResourceTypeRegistry(): Promise<void> {
  const [defsRes, mapRes] = await Promise.all([
    fetch('/resource-types.json'),
    fetch('/arm-type-map.json'),
  ]);
  const defs: ResourceTypeDefinition[] = await defsRes.json();
  registry = new Map(defs.map((d) => [d.key, d]));

  try {
    armTypeMap = await mapRes.json();
  } catch {
    armTypeMap = {};
  }
}

// ---------------------------------------------------------------------------
// Synchronous lookups (used for non-property concerns)
// ---------------------------------------------------------------------------

export function getResourceType(key: string): ResourceTypeDefinition | undefined {
  const k = resolveKey(key);
  return registry.get(k) ?? dynamicRegistry.get(k);
}

export function getAllResourceTypes(): ResourceTypeDefinition[] {
  return Array.from(registry.values());
}

export function isGroupType(key: string): boolean {
  return registry.get(resolveKey(key))?.isGroup === true;
}

export function getGroupStyle(key: string): { width: number; height: number } | undefined {
  return registry.get(resolveKey(key))?.groupStyle;
}

export function getGroupVariant(key: string): string | undefined {
  // Subnet nodes are generated from VNet properties, not from the registry
  if (key === 'subnet') return 'subnet';
  return registry.get(resolveKey(key))?.groupVariant;
}

export function getDisplayName(key: string): string {
  const k = resolveKey(key);
  return registry.get(k)?.displayName ?? dynamicRegistry.get(k)?.displayName ?? key;
}

export function getDefaultProperties(key: string): Record<string, unknown> {
  const k = resolveKey(key);
  const def = registry.get(k) ?? dynamicRegistry.get(k);
  if (!def) return {};
  const defaults: Record<string, unknown> = {};
  for (const field of def.propertySchema) {
    if (field.defaultValue !== undefined) {
      defaults[field.key] = field.defaultValue;
    }
  }
  return defaults;
}

// ---------------------------------------------------------------------------
// Async lookup — resolves ARM schema dynamically when no curated def exists
// ---------------------------------------------------------------------------

/**
 * Look up a resource type definition, falling back to dynamic ARM schema
 * resolution when no curated definition exists.
 */
export async function getResourceTypeAsync(
  key: string,
  displayName?: string,
): Promise<ResourceTypeDefinition | undefined> {
  const k = resolveKey(key);
  // 1. Curated definition wins
  const curated = registry.get(k);
  if (curated) return curated;

  // 2. Previously resolved dynamic definition
  const cached = dynamicRegistry.get(k);
  if (cached) return cached;

  // 3. Try to resolve from ARM schema
  const armType = armTypeMap[k] ?? armTypeMap[key];
  if (!armType) return undefined;

  const propertySchema = await fetchArmPropertySchema(armType);
  const apiVersion = getConfiguredApiVersion(armType) ?? 'unknown';

  const def: ResourceTypeDefinition = {
    key: k,
    displayName: displayName ?? humanizeKey(k),
    armType,
    apiVersion,
    propertySchema,
  };

  dynamicRegistry.set(k, def);
  return def;
}

/**
 * Returns the ARM resource type string for a service key, if known.
 */
export function getArmType(key: string): string | undefined {
  return registry.get(key)?.armType ?? armTypeMap[key];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanizeKey(key: string): string {
  return key
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
