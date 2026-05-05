import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { msalInstance } from './services';

// MSAL v3+ requires explicit initialize() before any login/acquireToken call,
// AND handleRedirectPromise() must run on every page load so loginRedirect
// can finish processing the auth response Entra appends to the URL hash.
async function bootstrap() {
  try {
    await msalInstance.initialize();
    await msalInstance.handleRedirectPromise();
  } catch (err) {
    console.error('MSAL bootstrap failed', err);
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
