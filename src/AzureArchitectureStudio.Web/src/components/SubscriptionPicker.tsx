import { useEffect, useState, useCallback } from 'react';
import {
  Menu,
  MenuTrigger,
  MenuList,
  MenuPopover,
  MenuItem,
  ToolbarButton,
  Spinner,
} from '@fluentui/react-components';
import { CloudRegular, ArrowSyncRegular } from '@fluentui/react-icons';
import { useIsAuthenticated } from '@azure/msal-react';
import { useAppContext } from '../context/AppContext';
import { listSubscriptions, type AzureSubscription } from '../services';

export default function SubscriptionPicker() {
  const isAuthenticated = useIsAuthenticated();
  const { azureSubscription, setAzureSubscription } = useAppContext();
  const [subs, setSubs] = useState<AzureSubscription[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listSubscriptions();
      setSubs(list);
      // If current selection no longer exists, clear it
      if (azureSubscription && !list.some((s) => s.subscriptionId === azureSubscription.subscriptionId)) {
        setAzureSubscription(null);
      }
    } finally {
      setLoading(false);
    }
  }, [azureSubscription, setAzureSubscription]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSubs([]);
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  if (!isAuthenticated) return null;

  const label = azureSubscription
    ? azureSubscription.displayName
    : 'Select subscription';

  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <ToolbarButton icon={loading ? <Spinner size="tiny" /> : <CloudRegular />}>
          {label}
        </ToolbarButton>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<ArrowSyncRegular />} onClick={() => void refresh()}>
            Refresh
          </MenuItem>
          {subs.length === 0 && !loading && (
            <MenuItem disabled>No subscriptions found</MenuItem>
          )}
          {subs.map((s) => (
            <MenuItem
              key={s.subscriptionId}
              onClick={() => setAzureSubscription(s)}
            >
              {s.displayName}
              <span style={{ color: 'var(--colorNeutralForeground3)', marginLeft: 8, fontSize: 11 }}>
                {s.subscriptionId}
              </span>
            </MenuItem>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
