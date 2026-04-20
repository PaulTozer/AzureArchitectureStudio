// Data-driven resource type registry.
// Instead of hardcoding every resource type in switch statements,
// definitions are loaded from /resource-types.json at startup.

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

// In-memory registry populated at startup
let registry: Map<string, ResourceTypeDefinition> = new Map();

export async function loadResourceTypeRegistry(): Promise<void> {
  const res = await fetch('/resource-types.json');
  const defs: ResourceTypeDefinition[] = await res.json();
  registry = new Map(defs.map((d) => [d.key, d]));
}

export function getResourceType(key: string): ResourceTypeDefinition | undefined {
  return registry.get(key);
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
  return registry.get(key)?.displayName ?? key;
}

export function getDefaultProperties(key: string): Record<string, unknown> {
  const def = registry.get(key);
  if (!def) return {};
  const defaults: Record<string, unknown> = {};
  for (const field of def.propertySchema) {
    if (field.defaultValue !== undefined) {
      defaults[field.key] = field.defaultValue;
    }
  }
  return defaults;
}
