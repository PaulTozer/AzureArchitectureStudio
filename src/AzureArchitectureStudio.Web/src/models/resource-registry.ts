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
  type: 'string' | 'number' | 'boolean' | 'select' | 'radio' | 'array' | 'password' | 'object' | 'object-array' | 'azure-picker' | 'vm-size-picker' | 'vm-image-picker' | 'availability-zone-picker';
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  /**
   * For 'select' fields. Names a shared option list defined in code
   * instead of inlining the options in JSON. Supported values:
   *   'azureRegions'      — every Azure commercial region
   *   'vmFamilies'        — every Azure VM family in the curated catalog
   *   'vmSizes:<family>'  — every SKU within a given family, e.g.
   *                         'vmSizes:Dsv5'.
   * The resolver lives in `SchemaForm`.
   */
  optionsSource?: 'azureRegions' | 'vmFamilies' | `vmSizes:${string}`;
  placeholder?: string;
  required?: boolean;
  /** Schema for items in a simple string array */
  itemSchema?: PropertyField;
  visibleWhen?: { field: string; value: string | string[] };
  /**
   * For cascading selects: when this field's value changes, also reset these
   * sibling fields. The new value of each reset field is the `defaultValue` of
   * whichever schema field with that key is visible under the new value of
   * this field (i.e. its `visibleWhen` matches), or `undefined` if none match.
   */
  resetFields?: string[];
  /** Child fields for 'object' and 'object-array' types */
  children?: PropertyField[];
  /**
   * For 'azure-picker' fields. Names a remote ARM source the dropdown is
   * populated from once the user is signed in.
   */
  azureSource?: 'subscription' | 'managementGroup';
  /**
   * For 'azure-picker' fields. Maps the chosen item's properties onto
   * sibling fields when a selection is made (in addition to setting
   * `field.key` itself). e.g. picking a subscription can also fill the
   * displayName property.
   *
   * Keys are property names on the resource; values are dotted paths into
   * the picked item.
   */
  azureFieldMap?: Record<string, string>;
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
  /**
   * Optional list of intermediary type keys that "wrap" the targetType.
   * If the dep can't be matched directly, the validator follows one hop to
   * a node of one of these types and treats the dep as fulfilled when that
   * intermediary itself sits inside / is connected to a node of targetType.
   *
   * Example: a Virtual Machine's `subnet` dep accepts `network-interface`
   * via this path — if the VM is wired to a NIC and the NIC is in a
   * subnet, the VM's subnet dep is considered satisfied.
   */
  acceptVia?: string[];
}

export interface ResourceTypeDefinition {
  key: string;
  displayName: string;
  armType: string;
  apiVersion: string;
  isGroup?: boolean;
  groupVariant?: 'resource-group' | 'vnet' | 'subnet' | 'subscription';
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
  'front-door-and-cdn-profiles': 'front-door',
  'load-balancer-hub': 'load-balancer',
  'network-watcher': 'network-watcher',
  nat: 'nat-gateways',
  'azure-cache-for-redis': 'redis-cache',
  'container-registries': 'container-registry',
  'key-vaults': 'key-vault',
  'service-bus-namespaces': 'service-bus',
  'event-hubs': 'event-hub',
  'log-analytics-workspaces': 'log-analytics',
  'static-web-apps': 'static-web-app',
  'azure-database-for-mysql-flexible-servers': 'mysql',
  'azure-database-for-postgresql-flexible-servers': 'postgresql',
  disks: 'managed-disk',
};

/** Resolves any incoming key to its canonical registry key. */
export function resolveKey(key: string): string {
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
 *
 * For curated definitions that DO exist we still attempt to enrich them
 * by fetching the full ARM schema and merging in any properties the
 * curated schema didn't already cover. The curated entries always win
 * on conflicts (for label/select-options/etc.), but extra fields from the
 * ARM spec get surfaced under an "Advanced" group.
 */
export async function getResourceTypeAsync(
  key: string,
  displayName?: string,
): Promise<ResourceTypeDefinition | undefined> {
  const k = resolveKey(key);
  // 1. Curated definition wins — but try to enrich it once with ARM schema.
  const curated = registry.get(k);
  if (curated) {
    return enrichCuratedAsync(k, curated);
  }

  // 2. Previously resolved dynamic definition (only cache real ARM resolutions)
  const cached = dynamicRegistry.get(k);
  if (cached) return cached;

  // Ensure the ARM type map is loaded — drawer may open before App finishes.
  if (Object.keys(armTypeMap).length === 0) {
    try { await loadResourceTypeRegistry(); } catch { /* ignore */ }
  }

  // 3. Try to resolve from ARM schema
  const armType = armTypeMap[k] ?? armTypeMap[key];
  if (armType) {
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

  // 4. Fallback: provide generic properties for any unmapped service.
  // Do NOT cache — if the map loads later we want a fresh attempt.
  return {
    key: k,
    displayName: displayName ?? humanizeKey(k),
    armType: '',
    apiVersion: '',
    propertySchema: [
      { key: 'tags', label: 'Tags', type: 'string', placeholder: 'Comma-separated key:value pairs' },
    ],
  };
}

/** Cache of curated-definitions already enriched with ARM-schema fields. */
const enrichedRegistry: Map<string, ResourceTypeDefinition> = new Map();

async function enrichCuratedAsync(
  k: string,
  curated: ResourceTypeDefinition,
): Promise<ResourceTypeDefinition> {
  const cached = enrichedRegistry.get(k);
  if (cached) return cached;

  // Nothing to fetch if the curated entry has no armType.
  if (!curated.armType) {
    enrichedRegistry.set(k, curated);
    return curated;
  }

  let extras: PropertyField[] = [];
  try {
    extras = await fetchArmPropertySchema(curated.armType);
  } catch {
    extras = [];
  }

  // Skip any field already present on the curated schema (by key).
  const existingKeys = new Set(curated.propertySchema.map((f) => f.key));
  const missing = extras.filter((f) => !existingKeys.has(f.key));

  // Strip generic ARM noise that's never user-editable in our context.
  const NOISE = new Set([
    'provisioningState',
    'state',
    'fullyQualifiedDomainName',
    'privateEndpointConnections',
    'kind',
    'currentSku',
    'restorableDroppedDatabaseId',
    'sourceDatabaseId',
    'sourceDatabaseDeletionDate',
    'recoveryServicesRecoveryPointId',
    'longTermRetentionBackupResourceId',
    'recoverableDatabaseId',
    'restorePointInTime',
    'createMode',
    'currentBackupStorageRedundancy',
    'requestedServiceObjectiveName',
    'currentServiceObjectiveName',
    'serviceLevelObjective',
    'edition',
    'managedBy',
    'creationDate',
    'earliestRestoreDate',
    'databaseId',
    'currentBackupStorageRedundancyName',
    'paused',
    'resumedDate',
    'pausedDate',
    'creationTime',
  ]);
  const filtered = missing.filter((f) => !NOISE.has(f.key));

  if (filtered.length === 0) {
    enrichedRegistry.set(k, curated);
    return curated;
  }

  // Wrap the extras in an "Advanced (from ARM spec)" object group so users
  // can collapse them without distracting from the curated essentials.
  const enriched: ResourceTypeDefinition = {
    ...curated,
    propertySchema: [
      ...curated.propertySchema,
      {
        key: '__armSpecAdvanced__',
        label: 'Advanced',
        type: 'object',
        children: filtered,
      },
    ],
  };
  enrichedRegistry.set(k, enriched);
  return enriched;
}

/**
 * Returns the ARM resource type string for a service key, if known.
 */
export function getArmType(key: string): string | undefined {
  return registry.get(key)?.armType ?? armTypeMap[key];
}

/**
 * Returns the raw `arm-type-map.json` mapping (service-key → ARM type).
 * Used by the Import flow to recognise resources whose curated registry
 * entry doesn't carry an `armType` directly.
 */
export function getArmTypeMap(): Record<string, string> {
  return armTypeMap;
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
