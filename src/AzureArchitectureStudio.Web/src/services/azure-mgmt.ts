import { msalInstance, azureManagementRequest } from './auth-config';

const ARM_BASE = 'https://management.azure.com';

export interface AzureSubscription {
  id: string;            // /subscriptions/{guid}
  subscriptionId: string;
  displayName: string;
  state: string;
  tenantId: string;
}

export interface AzureResourceGroup {
  id: string;
  name: string;
  location: string;
}

export interface AzureManagementGroup {
  id: string;            // /providers/Microsoft.Management/managementGroups/{name}
  name: string;          // unique name (the "id" segment)
  type: string;
  properties: {
    displayName: string;
    tenantId?: string;
  };
}

/** Discriminated union representing where a deployment / listing is scoped. */
export type ScopeRef =
  | { kind: 'managementGroup'; id: string; name: string; displayName: string }
  | { kind: 'subscription'; id: string; subscriptionId: string; displayName: string; tenantId: string }
  | {
      kind: 'resourceGroup';
      id: string;
      name: string;
      location: string;
      subscriptionId: string;
      subscriptionName: string;
    };

/** Acquire an ARM access token (silent, fall back to popup). */
export async function getArmAccessToken(): Promise<string | null> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;
  try {
    const r = await msalInstance.acquireTokenSilent({
      ...azureManagementRequest,
      account: accounts[0],
    });
    return r.accessToken;
  } catch {
    try {
      const r = await msalInstance.acquireTokenPopup(azureManagementRequest);
      return r.accessToken;
    } catch {
      return null;
    }
  }
}

async function armFetch<T>(path: string, apiVersion: string): Promise<T | null> {
  const token = await getArmAccessToken();
  if (!token) return null;
  // Don't double-add api-version when the caller already supplied one
  // (e.g. when following a nextLink path).
  const hasApiVersion = /[?&]api-version=/i.test(path);
  const url = hasApiVersion
    ? `${ARM_BASE}${path}`
    : `${ARM_BASE}${path}${path.includes('?') ? '&' : '?'}api-version=${apiVersion}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function listSubscriptions(): Promise<AzureSubscription[]> {
  const data = await armFetch<{ value: AzureSubscription[] }>(
    '/subscriptions',
    '2022-12-01',
  );
  return data?.value ?? [];
}

export async function listResourceGroups(
  subscriptionId: string,
): Promise<AzureResourceGroup[]> {
  const data = await armFetch<{ value: AzureResourceGroup[] }>(
    `/subscriptions/${subscriptionId}/resourcegroups`,
    '2021-04-01',
  );
  return data?.value ?? [];
}

/**
 * List management groups visible to the signed-in user.
 * Requires at least Reader on the MG; otherwise returns an empty list.
 */
export async function listManagementGroups(): Promise<AzureManagementGroup[]> {
  const data = await armFetch<{ value: AzureManagementGroup[] }>(
    '/providers/Microsoft.Management/managementGroups',
    '2021-04-01',
  );
  return data?.value ?? [];
}

// ---------------------------------------------------------------------------
// Resource enumeration (used by the Import flow)
// ---------------------------------------------------------------------------

/** Generic ARM resource record returned by /resources. */
export interface AzureArmResource {
  id: string;            // /subscriptions/{sub}/resourceGroups/{rg}/providers/{type}/{name}[/...]
  name: string;
  type: string;          // e.g. "Microsoft.Storage/storageAccounts"
  location?: string;
  kind?: string;
  tags?: Record<string, string>;
  sku?: { name?: string; tier?: string };
  /** Populated when the listing was requested with $expand=properties. */
  properties?: Record<string, unknown>;
}

/** List ALL resources in a subscription (all RGs, all types). */
export async function listResourcesInSubscription(
  subscriptionId: string,
): Promise<AzureArmResource[]> {
  const out: AzureArmResource[] = [];
  let next: string | null =
    `/subscriptions/${subscriptionId}/resources?$expand=properties`;
  while (next) {
    const data: { value: AzureArmResource[]; nextLink?: string } | null = await armFetch(
      next,
      '2021-04-01',
    );
    if (!data) break;
    out.push(...(data.value ?? []));
    next = data.nextLink ? extractArmPath(data.nextLink) : null;
  }
  return out;
}

/** List all resources within a specific resource group. */
export async function listResourcesInResourceGroup(
  subscriptionId: string,
  resourceGroupName: string,
): Promise<AzureArmResource[]> {
  const out: AzureArmResource[] = [];
  let next: string | null =
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/resources?$expand=properties`;
  while (next) {
    const data: { value: AzureArmResource[]; nextLink?: string } | null = await armFetch(
      next,
      '2021-04-01',
    );
    if (!data) break;
    out.push(...(data.value ?? []));
    next = data.nextLink ? extractArmPath(data.nextLink) : null;
  }
  return out;
}

/** Subscription record returned when descending a management group. */
export interface AzureMgChildSubscription {
  id: string;            // /subscriptions/{guid}
  name: string;          // guid
  displayName?: string;
}

/** List subscriptions that descend from a management group (recursive expansion). */
export async function listSubscriptionsUnderManagementGroup(
  managementGroupName: string,
): Promise<AzureMgChildSubscription[]> {
  // The descendants endpoint returns subscriptions and child MGs in one call.
  const out: AzureMgChildSubscription[] = [];
  const seen = new Set<string>();
  let next: string | null =
    `/providers/Microsoft.Management/managementGroups/${managementGroupName}/descendants`;
  while (next) {
    const data: {
      value: Array<{ id: string; name: string; type: string; properties?: { displayName?: string } }>;
      nextLink?: string;
    } | null = await armFetch(next, '2021-04-01');
    if (!data) break;
    for (const item of data.value ?? []) {
      if (item.type === '/subscriptions' || item.type === 'Microsoft.Management/managementGroups/subscriptions') {
        if (!seen.has(item.name)) {
          seen.add(item.name);
          out.push({
            id: `/subscriptions/${item.name}`,
            name: item.name,
            displayName: item.properties?.displayName,
          });
        }
      }
    }
    next = data.nextLink ? extractArmPath(data.nextLink) : null;
  }
  return out;
}

/** Strip the management.azure.com host from an ARM nextLink to leave just the path+query. */
function extractArmPath(absoluteUrl: string): string | null {
  try {
    const u = new URL(absoluteUrl);
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

/**
 * Fetch full per-resource details for each id, replacing the `properties`
 * field on the corresponding entry in the input list. Best-effort:
 * resources whose api-version is unknown or whose GET fails are returned
 * unchanged.
 *
 * @param resources Resources from `listResourcesIn*` (basic listing).
 * @param apiVersionForType A function returning a per-type API version.
 */
export async function enrichResourcesWithFullProperties(
  resources: AzureArmResource[],
  apiVersionForType: (armType: string) => string | undefined,
  concurrency: number = 8,
): Promise<AzureArmResource[]> {
  const out = resources.slice();
  let i = 0;
  const workers: Promise<void>[] = [];
  const fetchOne = async (idx: number) => {
    const r = out[idx];
    const apiVersion = apiVersionForType(r.type) ?? '2022-09-01';
    try {
      const data = await armFetch<AzureArmResource>(r.id, apiVersion);
      if (data && data.properties) {
        out[idx] = { ...r, properties: data.properties };
      }
    } catch {
      // Best-effort: keep the original.
    }
  };
  const next = async () => {
    while (i < out.length) {
      const my = i++;
      await fetchOne(my);
    }
  };
  for (let k = 0; k < Math.min(concurrency, out.length); k++) {
    workers.push(next());
  }
  await Promise.all(workers);
  return out;
}

