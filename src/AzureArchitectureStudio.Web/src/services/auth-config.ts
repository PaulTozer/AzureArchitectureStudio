import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const msalConfig: Configuration = {
  auth: {
    clientId: '53903153-545a-408e-a16d-1cc5a8b304e9',
    authority:
      'https://azdesignapp.b2clogin.com/azdesignapp.onmicrosoft.com/B2C_1_adssigninup',
    knownAuthorities: ['azdesignapp.b2clogin.com'],
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
};

export const loginRequest = {
  scopes: [
    'https://azdesignapp.onmicrosoft.com/b29c5bdd-7bd6-4f43-835f-e2c9c358491e/Server.Access',
  ],
};

export const msalInstance = new PublicClientApplication(msalConfig);
