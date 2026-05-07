import { useEffect, useState } from 'react';
import { MessageBar, MessageBarBody, MessageBarTitle, MessageBarActions, Button } from '@fluentui/react-components';
import { AUTH_REQUIRED_EVENT, reauthenticate } from '../services';

/**
 * Top-of-app banner that appears whenever an Azure ARM call fails because
 * the user's session needs interactive re-authentication (MFA expired,
 * conditional access, password change, consent prompt, etc.). Clicking
 * "Sign in again" performs a full-page redirect through Entra ID — the
 * SPA state (selected scope, design, etc.) is preserved in localStorage
 * and rehydrated when the redirect completes.
 */
export default function AuthInteractionBanner() {
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ reason?: string }>).detail;
      setReason(detail?.reason ?? '');
      setVisible(true);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handler);
  }, []);

  if (!visible) return null;

  return (
    <div style={{ padding: '4px 8px' }}>
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>Re-authentication required</MessageBarTitle>
          Your Azure session has expired or needs MFA. Sign in again to keep your selected scope and continue loading live data.
          {reason ? <span style={{ marginLeft: 8, opacity: 0.7, fontSize: 11 }}>({reason})</span> : null}
        </MessageBarBody>
        <MessageBarActions>
          <Button
            appearance="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await reauthenticate();
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign in again
          </Button>
          <Button appearance="subtle" onClick={() => setVisible(false)}>
            Dismiss
          </Button>
        </MessageBarActions>
      </MessageBar>
    </div>
  );
}
