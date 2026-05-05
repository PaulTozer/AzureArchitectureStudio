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
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${ARM_BASE}${path}${sep}api-version=${apiVersion}`, {
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
