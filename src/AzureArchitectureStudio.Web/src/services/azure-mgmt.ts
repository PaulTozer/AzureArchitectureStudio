import { msalInstance, azureManagementRequest } from './auth-config';
import { InteractionRequiredAuthError } from '@azure/msal-browser';

const ARM_BASE = 'https://management.azure.com';

/** Event name fired on `window` whenever ARM token acquisition needs an
 *  interactive sign-in (MFA expired, conditional access, password change,
 *  consent required, etc.). UI components can listen and surface a
 *  banner / button to call `reauthenticate()`. */
export const AUTH_REQUIRED_EVENT = 'aas:auth-required';

function signalAuthRequired(reason: string) {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { reason } }));
  } catch {
    // ignore
  }
}

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

/** Acquire an ARM access token silently. Returns null when there is
 *  no signed-in account or when interaction is required (MFA / CA /
 *  consent). In the latter case fires the global `aas:auth-required`
 *  event so the UI can show a re-sign-in prompt. We deliberately do NOT
 *  fall back to `acquireTokenPopup` here because popups are commonly
 *  blocked and a hung popup is what makes the app appear to spin. */
export async function getArmAccessToken(): Promise<string | null> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;
  try {
    const r = await msalInstance.acquireTokenSilent({
      ...azureManagementRequest,
      account: accounts[0],
    });
    return r.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      signalAuthRequired(err.errorCode || 'interaction_required');
    } else {
      // Network or unknown error — surface as auth-required too so the
      // user has a clear path to recover instead of an endless spinner.
      signalAuthRequired((err as { errorCode?: string })?.errorCode ?? 'token_error');
    }
    return null;
  }
}

/** Trigger an interactive re-authentication. Uses `acquireTokenRedirect`
 *  (with `loginRedirect` as a fallback) because redirect flows are not
 *  blocked by popup blockers and reliably complete MFA. App state is
 *  preserved across the redirect via `localStorage`. */
export async function reauthenticate(): Promise<void> {
  const accounts = msalInstance.getAllAccounts();
  try {
    if (accounts.length > 0) {
      await msalInstance.acquireTokenRedirect({
        ...azureManagementRequest,
        account: accounts[0],
      });
    } else {
      await msalInstance.loginRedirect(azureManagementRequest);
    }
  } catch {
    // As a last resort try a popup; user may have to retry.
    try {
      await msalInstance.acquireTokenPopup(azureManagementRequest);
    } catch {
      // give up — banner stays visible so the user can try again
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
  if (res.status === 401 || res.status === 403) {
    // Token was accepted by MSAL but rejected by ARM — typically the
    // session has been revoked or CA needs re-evaluation. Treat the same
    // as silent-token failure so the user gets a recovery path.
    signalAuthRequired(`http_${res.status}`);
    return null;
  }
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

// ---------------------------------------------------------------------------
// VM sizes (live, per-region)
// ---------------------------------------------------------------------------

/** A VM SKU as returned by /providers/Microsoft.Compute/locations/{loc}/vmSizes. */
export interface AzureVmSize {
  name: string;                    // e.g. "Standard_D4s_v5"
  numberOfCores: number;           // vCPU count
  memoryInMB: number;              // RAM in megabytes
  osDiskSizeInMB?: number;
  resourceDiskSizeInMB?: number;
  maxDataDiskCount?: number;
}

/**
 * List every VM size offered in a given region under a given subscription.
 * Returns null when the call fails (no auth, no permission, no quota etc.)
 * so callers can fall back to a static catalog.
 */
export async function listVmSizes(
  subscriptionId: string,
  location: string,
): Promise<AzureVmSize[] | null> {
  const data = await armFetch<{ value: AzureVmSize[] }>(
    `/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${location}/vmSizes`,
    '2024-07-01',
  );
  return data?.value ?? null;
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

  // For any ARM type we don't know via the curated registry, ask Azure
  // what api versions exist for that namespace and pick the most recent
  // stable one. We cache the per-namespace lookup so we never hit ARM
  // more than once per provider per import.
  const providerLookup = await buildProviderApiVersionLookup(resources);

  let i = 0;
  const workers: Promise<void>[] = [];
  const resolveApiVersion = (armType: string): string => {
    const fromCurated = apiVersionForType(armType);
    if (fromCurated) return fromCurated;
    const fromProvider = providerLookup.get(armType.toLowerCase());
    if (fromProvider) return fromProvider;
    // Last-ditch generic fallback. Will likely 400 for some types but
    // we already tried the curated map and the provider catalog.
    return '2022-09-01';
  };
  const fetchOne = async (idx: number) => {
    const r = out[idx];
    const apiVersion = resolveApiVersion(r.type);
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

/**
 * Build a per-ARM-type api-version lookup by asking ARM what apiVersions
 * are registered for each namespace seen in `resources`. Falls back to
 * an empty map on any failure.
 */
async function buildProviderApiVersionLookup(
  resources: AzureArmResource[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // Group namespaces -> a sample subscription id so we can scope the
  // provider GET (the tenant-level providers endpoint sometimes omits
  // apiVersions; subscription scope is reliable).
  const namespaceToSub = new Map<string, string>();
  for (const r of resources) {
    const ns = r.type.split('/')[0];
    if (!ns) continue;
    if (!namespaceToSub.has(ns.toLowerCase())) {
      const sub = /\/subscriptions\/([^/]+)/i.exec(r.id)?.[1];
      if (sub) namespaceToSub.set(ns.toLowerCase(), sub);
    }
  }

  await Promise.all(
    Array.from(namespaceToSub.entries()).map(async ([nsLower, sub]) => {
      // Find the canonical-cased namespace from the first resource.
      const sample = resources.find((r) => r.type.toLowerCase().startsWith(nsLower + '/'));
      const ns = sample ? sample.type.split('/')[0] : nsLower;
      try {
        interface ProviderResponse {
          resourceTypes?: Array<{
            resourceType?: string;
            apiVersions?: string[];
          }>;
        }
        const data = await armFetch<ProviderResponse>(
          `/subscriptions/${sub}/providers/${ns}`,
          '2022-09-01',
        );
        if (!data?.resourceTypes) return;
        for (const rt of data.resourceTypes) {
          if (!rt.resourceType || !rt.apiVersions || rt.apiVersions.length === 0) continue;
          const fullType = `${ns}/${rt.resourceType}`.toLowerCase();
          // apiVersions are typically returned newest-first; prefer the
          // first non-preview, otherwise take the first entry.
          const stable = rt.apiVersions.find((v) => !/preview|alpha|beta/i.test(v));
          result.set(fullType, stable ?? rt.apiVersions[0]);
        }
      } catch {
        // ignore — type will get the generic fallback.
      }
    }),
  );

  return result;
}

