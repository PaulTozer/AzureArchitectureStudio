import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

// Entra ID (Azure AD) client app for Azure Management API access.
// Configure via Vite env vars (.env.local):
//   VITE_AZURE_CLIENT_ID  – your SPA app registration client ID
//   VITE_AZURE_TENANT_ID  – tenant ID, or 'organizations' (default) for any work/school account,
//                           or 'common' to also allow personal Microsoft accounts
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID ?? '';
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID ?? 'organizations';

const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
};

/** Scope for calling Azure Resource Manager (ARM) REST APIs. */
export const azureManagementRequest = {
  scopes: ['https://management.azure.com/user_impersonation'],
};

/** Backwards-compat alias used by api.ts for backend calls. */
export const loginRequest = azureManagementRequest;

export const msalInstance = new PublicClientApplication(msalConfig);

export const isAuthConfigured = clientId.length > 0;
