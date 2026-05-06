/**
 * Diagram connection validation rules.
 *
 * Returns whether a connection from `sourceTypeKey` to `targetTypeKey`
 * is allowed, plus a human-readable reason when it is not. Used both as
 * a guard inside `onConnect` / `onReconnect` and as React Flow's
 * `isValidConnection` predicate (which drives the red drop cursor).
 *
 * The rules are deliberately permissive about the *direction* of an edge
 * for "talks to" relationships (workload <-> data service, etc.) because
 * users typically draw a wire either way; they are strict about the
 * direction of *hierarchical* relationships (scope, hosting, public-ip
 * association, private-endpoint targets, dns-zone vnet links).
 */

export interface ConnectionCheckResult {
  allowed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Type categories (role-based grouping)
// ---------------------------------------------------------------------------

const SCOPE = ['entra-tenant', 'management-groups', 'subscriptions'] as const;

const COMPUTE_WORKLOADS = [
  'virtual-machine',
  'aks-cluster',
  'web-app',
  'function-app',
  'container-apps',
] as const;

const STATIC_WORKLOADS = ['static-web-app'] as const;

const ALL_WORKLOADS = [...COMPUTE_WORKLOADS, ...STATIC_WORKLOADS] as const;

const DATA_SERVICES = [
  'sql-server',
  'sql-database',
  'cosmos-db',
  'mysql',
  'postgresql',
  'redis-cache',
  'storage-account',
] as const;

const MESSAGING = ['service-bus', 'event-hub', 'signalr'] as const;

const PLATFORM_SERVICES = [
  'key-vault',
  'log-analytics',
  'app-insights',
  'container-registry',
  'apim',
] as const;

const INGRESS = ['front-door', 'app-gateway', 'apim', 'load-balancer'] as const;

const EDGE_NETWORK = [
  'azure-firewall',
  'azure-bastions',
  'vpn-gateway',
] as const;

// Targets that legitimately accept a Private Endpoint.
const PE_TARGETS = [
  'sql-server',
  'sql-database',
  'cosmos-db',
  'mysql',
  'postgresql',
  'redis-cache',
  'storage-account',
  'key-vault',
  'container-registry',
  'service-bus',
  'event-hub',
  'signalr',
  'web-app',
  'function-app',
  'container-apps',
  'apim',
] as const;

// Resources that reasonably emit diagnostics into Log Analytics / App Insights.
const DIAG_EMITTERS = [
  ...ALL_WORKLOADS,
  ...DATA_SERVICES,
  ...MESSAGING,
  ...INGRESS,
  ...EDGE_NETWORK,
  'apim',
  'key-vault',
  'container-registry',
  'azure-firewall',
  'app-gateway',
  'load-balancer',
  'public-ip',
  'nsg',
  'virtual-networks',
] as const;

// Master catalog of every type the validator knows about. Anything not in
// this set is considered "unknown" and is allowed-by-default so adding new
// stencils does not silently break the board.
const KNOWN_TYPES = new Set<string>([
  ...SCOPE,
  'resource-group',
  'virtual-networks',
  'subnet',
  'nsg',
  'public-ip',
  'private-endpoint',
  'dns-zone',
  ...ALL_WORKLOADS,
  ...DATA_SERVICES,
  ...MESSAGING,
  ...PLATFORM_SERVICES,
  ...INGRESS,
  ...EDGE_NETWORK,
  'appservice-plan',
]);

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

type Direction = 'uni' | 'bi';

interface Rule {
  /** Allowed source types. */
  from: ReadonlyArray<string>;
  /** Allowed target types. */
  to: ReadonlyArray<string>;
  /** 'uni' = source -> target only. 'bi' = either direction. */
  direction: Direction;
}

const RULES: Rule[] = [
  // ---- Management scope hierarchy ----
  {
    from: ['subscriptions'],
    to: ['management-groups', 'entra-tenant'],
    direction: 'uni',
  },
  {
    from: ['management-groups'],
    to: ['management-groups', 'entra-tenant'],
    direction: 'uni',
  },
  {
    from: ['resource-group'],
    to: ['subscriptions'],
    direction: 'uni',
  },

  // ---- Compute hosting ----
  {
    from: ['web-app', 'function-app'],
    to: ['appservice-plan'],
    direction: 'uni',
  },
  {
    from: ['sql-server'],
    to: ['sql-database'],
    direction: 'uni',
  },

  // ---- Workload <-> data / messaging / platform services ----
  {
    from: [...ALL_WORKLOADS],
    to: [...DATA_SERVICES, ...MESSAGING, ...PLATFORM_SERVICES],
    direction: 'bi',
  },
  // Workload <-> workload (e.g. function calls web app).
  {
    from: [...ALL_WORKLOADS],
    to: [...ALL_WORKLOADS],
    direction: 'bi',
  },

  // ---- Ingress / edge fronting workloads ----
  {
    from: [...INGRESS],
    to: [...ALL_WORKLOADS],
    direction: 'bi',
  },
  // Front Door -> App Gateway / APIM / Load Balancer (multi-tier ingress).
  {
    from: ['front-door'],
    to: ['app-gateway', 'apim', 'load-balancer'],
    direction: 'uni',
  },
  // App Gateway -> APIM (private APIM behind App Gateway is common).
  {
    from: ['app-gateway'],
    to: ['apim'],
    direction: 'uni',
  },
  // APIM in front of backend data/messaging services.
  {
    from: ['apim'],
    to: [...DATA_SERVICES, ...MESSAGING],
    direction: 'bi',
  },

  // ---- Private Endpoint ----
  {
    from: ['private-endpoint'],
    to: [...PE_TARGETS],
    direction: 'uni',
  },

  // ---- Public IP associations ----
  {
    from: ['public-ip'],
    to: [
      'app-gateway',
      'azure-firewall',
      'vpn-gateway',
      'load-balancer',
      'azure-bastions',
      'virtual-machine',
      'front-door',
    ],
    direction: 'uni',
  },

  // ---- NSG associations ----
  {
    from: ['nsg'],
    to: ['virtual-machine', 'subnet'],
    direction: 'bi',
  },

  // ---- DNS zone vnet link ----
  {
    from: ['dns-zone'],
    to: ['virtual-networks'],
    direction: 'uni',
  },

  // ---- Diagnostics -> Log Analytics / App Insights ----
  {
    from: [...DIAG_EMITTERS],
    to: ['log-analytics', 'app-insights'],
    direction: 'bi',
  },

  // ---- Container workloads pulling images from ACR ----
  {
    from: ['aks-cluster', 'container-apps', 'web-app', 'function-app'],
    to: ['container-registry'],
    direction: 'bi',
  },

  // ---- VPN / Firewall / Bastion attached to vnet/subnet ----
  {
    from: ['vpn-gateway', 'azure-firewall', 'azure-bastions'],
    to: ['virtual-networks', 'subnet'],
    direction: 'bi',
  },

  // ---- Resource group parenting (informational) ----
  {
    from: ['resource-group'],
    to: [
      ...ALL_WORKLOADS,
      ...DATA_SERVICES,
      ...MESSAGING,
      ...PLATFORM_SERVICES,
      ...INGRESS,
      ...EDGE_NETWORK,
      'virtual-networks',
      'public-ip',
      'nsg',
      'private-endpoint',
      'dns-zone',
      'appservice-plan',
    ],
    direction: 'uni',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function checkConnection(
  sourceTypeKey: string | undefined,
  targetTypeKey: string | undefined,
): ConnectionCheckResult {
  if (!sourceTypeKey || !targetTypeKey) {
    return { allowed: true };
  }

  if (sourceTypeKey === targetTypeKey) {
    // Self-loops on the same type are usually meaningful only for MGs (a
    // child MG points at its parent MG) or workload-to-workload comms.
    if (sourceTypeKey === 'management-groups') return { allowed: true };
    if ((ALL_WORKLOADS as ReadonlyArray<string>).includes(sourceTypeKey)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Two ${labelFor(sourceTypeKey)} nodes cannot be linked together.`,
    };
  }

  const sourceKnown = KNOWN_TYPES.has(sourceTypeKey);
  const targetKnown = KNOWN_TYPES.has(targetTypeKey);

  // Be permissive for stencils we have no opinion on yet.
  if (!sourceKnown || !targetKnown) {
    return { allowed: true };
  }

  for (const rule of RULES) {
    if (rule.from.includes(sourceTypeKey) && rule.to.includes(targetTypeKey)) {
      return { allowed: true };
    }
    if (
      rule.direction === 'bi' &&
      rule.from.includes(targetTypeKey) &&
      rule.to.includes(sourceTypeKey)
    ) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: `${labelFor(sourceTypeKey)} cannot be linked to ${labelFor(targetTypeKey)}.`,
  };
}

export function isAllowedConnection(
  sourceTypeKey: string | undefined,
  targetTypeKey: string | undefined,
): boolean {
  return checkConnection(sourceTypeKey, targetTypeKey).allowed;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const LABELS: Record<string, string> = {
  'entra-tenant': 'Entra Tenant',
  'management-groups': 'Management Group',
  subscriptions: 'Subscription',
  'resource-group': 'Resource Group',
  'virtual-networks': 'Virtual Network',
  subnet: 'Subnet',
  nsg: 'Network Security Group',
  'public-ip': 'Public IP',
  'private-endpoint': 'Private Endpoint',
  'dns-zone': 'DNS Zone',
  'virtual-machine': 'Virtual Machine',
  'aks-cluster': 'AKS Cluster',
  'web-app': 'Web App',
  'function-app': 'Function App',
  'container-apps': 'Container App',
  'static-web-app': 'Static Web App',
  'sql-server': 'SQL Server',
  'sql-database': 'SQL Database',
  'cosmos-db': 'Cosmos DB',
  mysql: 'Azure DB for MySQL',
  postgresql: 'Azure DB for PostgreSQL',
  'redis-cache': 'Redis Cache',
  'storage-account': 'Storage Account',
  'service-bus': 'Service Bus',
  'event-hub': 'Event Hub',
  signalr: 'SignalR',
  'key-vault': 'Key Vault',
  'log-analytics': 'Log Analytics Workspace',
  'app-insights': 'Application Insights',
  'container-registry': 'Container Registry',
  apim: 'API Management',
  'front-door': 'Front Door',
  'app-gateway': 'Application Gateway',
  'load-balancer': 'Load Balancer',
  'azure-firewall': 'Azure Firewall',
  'azure-bastions': 'Azure Bastion',
  'vpn-gateway': 'VPN Gateway',
  'appservice-plan': 'App Service Plan',
};

function labelFor(typeKey: string): string {
  return LABELS[typeKey] ?? typeKey;
}
