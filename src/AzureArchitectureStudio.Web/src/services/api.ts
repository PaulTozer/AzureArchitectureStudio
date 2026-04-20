import { msalInstance, loginRequest } from './auth-config';

const API_BASE = '';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return {};

  try {
    const response = await msalInstance.acquireTokenSilent({
      ...loginRequest,
      account: accounts[0],
    });
    return { Authorization: `Bearer ${response.accessToken}` };
  } catch {
    return {};
  }
}

// Design service — save/load/delete designs (replaces gRPC DesignService)
export const designService = {
  async save(name: string, data: string): Promise<number> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/designs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ name, data }),
    });
    return res.status;
  },

  async load(name: string): Promise<{ status: number; data?: string }> {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${API_BASE}/api/designs/${encodeURIComponent(name)}`,
      { headers }
    );
    if (!res.ok) return { status: res.status };
    const json = await res.json();
    return { status: res.status, data: json.data };
  },

  async getSaved(): Promise<{ status: number; names?: string[] }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/designs`, { headers });
    if (!res.ok) return { status: res.status };
    const json = await res.json();
    return { status: res.status, names: json.names };
  },

  async delete(name: string): Promise<number> {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${API_BASE}/api/designs/${encodeURIComponent(name)}`,
      { method: 'DELETE', headers }
    );
    return res.status;
  },
};

// Deploy service — subscription management and deployment
export const deployService = {
  async getLinkedSubscriptions(): Promise<unknown[]> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/subscriptions`, { headers });
    if (!res.ok) return [];
    return res.json();
  },

  async linkSubscription(info: {
    subscriptionId: string;
    tenantId: string;
    clientId: string;
    clientSecret: string;
  }): Promise<number> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(info),
    });
    return res.status;
  },

  async getResourceGroups(
    subscriptionId: string
  ): Promise<{ name: string; location: string }[]> {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${API_BASE}/api/subscriptions/${encodeURIComponent(subscriptionId)}/resource-groups`,
      { headers }
    );
    if (!res.ok) return [];
    return res.json();
  },

  async deploy(params: {
    subscriptionId: string;
    resourceGroupName: string;
    armTemplate: string;
    parameters: string;
  }): Promise<AsyncIterable<{ status: string; message: string }>> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(params),
    });

    // Return an async iterable over streaming response
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    return {
      async *[Symbol.asyncIterator]() {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim()) {
              yield JSON.parse(line);
            }
          }
        }
        if (buffer.trim()) {
          yield JSON.parse(buffer);
        }
      },
    };
  },
};

// Bicep decompiler — calls the server to decompile ARM → Bicep
export const bicepService = {
  async decompile(
    armJson: string
  ): Promise<{ bicepFile?: string; error?: string }> {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/api/bicep/decompile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ armTemplate: armJson }),
    });
    return res.json();
  },
};

// Azure services — dynamic resource type discovery
export const azureServicesApi = {
  async getResourceTypes(azureToken: string): Promise<unknown> {
    const res = await fetch(`${API_BASE}/api/azureservices/resource-types`, {
      headers: { Authorization: `Bearer ${azureToken}` },
    });
    if (!res.ok) throw new Error(`Azure API error: ${res.status}`);
    return res.json();
  },

  async getSupportServices(azureToken: string): Promise<unknown> {
    const res = await fetch(`${API_BASE}/api/azureservices/support-services`, {
      headers: { Authorization: `Bearer ${azureToken}` },
    });
    if (!res.ok) throw new Error(`Azure API error: ${res.status}`);
    return res.json();
  },
};
