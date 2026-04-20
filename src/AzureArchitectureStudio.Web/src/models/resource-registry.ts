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
  type: 'string' | 'number' | 'boolean' | 'select' | 'radio' | 'array' | 'password';
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  required?: boolean;
  itemSchema?: PropertyField;
  visibleWhen?: { field: string; value: string };
}

export interface ArmMappingDef {
  skuProperty?: string;
  propertyMappings?: Record<string, string>;
  parameters?: { name: string; type: string; description: string }[];
}

export interface ResourceTypeDefinition {
  key: string;
  displayName: string;
  armType: string;
  apiVersion: string;
  isGroup?: boolean;
  groupStyle?: { width: number; height: number };
  armDefaults?: Record<string, unknown>;
  propertySchema: PropertyField[];
  armMapping?: ArmMappingDef;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
/** Curated definitions from resource-types.json */
let registry: Map<string, ResourceTypeDefinition> = new Map();

/** Maps service-key → ARM resource type (e.g. "network-interfaces" → "Microsoft.Network/networkInterfaces") */
let armTypeMap: Record<string, string> = {};

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
  return registry.get(key) ?? dynamicRegistry.get(key);
}

export function getAllResourceTypes(): ResourceTypeDefinition[] {
  return Array.from(registry.values());
}

export function isGroupType(key: string): boolean {
  return registry.get(key)?.isGroup === true;
}

export function getGroupStyle(key: string): { width: number; height: number } | undefined {
  return registry.get(key)?.groupStyle;
}

export function getDisplayName(key: string): string {
  return registry.get(key)?.displayName ?? dynamicRegistry.get(key)?.displayName ?? key;
}

export function getDefaultProperties(key: string): Record<string, unknown> {
  const def = registry.get(key) ?? dynamicRegistry.get(key);
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
  // 1. Curated definition wins
  const curated = registry.get(key);
  if (curated) return curated;

  // 2. Previously resolved dynamic definition
  const cached = dynamicRegistry.get(key);
  if (cached) return cached;

  // 3. Try to resolve from ARM schema
  const armType = armTypeMap[key];
  if (!armType) return undefined;

  const propertySchema = await fetchArmPropertySchema(armType);
  const apiVersion = getConfiguredApiVersion(armType) ?? 'unknown';

  const def: ResourceTypeDefinition = {
    key,
    displayName: displayName ?? humanizeKey(key),
    armType,
    apiVersion,
    propertySchema,
  };

  dynamicRegistry.set(key, def);
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
