import { useEffect, useState, useCallback } from 'react';
import {
  Menu,
  MenuTrigger,
  MenuList,
  MenuPopover,
  MenuItem,
  MenuDivider,
  ToolbarButton,
  Spinner,
} from '@fluentui/react-components';
import {
  CloudRegular,
  ArrowSyncRegular,
  ChevronRightRegular,
} from '@fluentui/react-icons';
import { useIsAuthenticated } from '@azure/msal-react';
import { useAppContext } from '../context/AppContext';
import {
  listManagementGroups,
  listSubscriptions,
  listResourceGroups,
  type AzureManagementGroup,
  type AzureSubscription,
  type AzureResourceGroup,
  type ScopeRef,
} from '../services';

/**
 * Toolbar button that lets the signed-in user pick a deployment / browse
 * scope: a Management Group, Subscription, or Resource Group.
 *
 * The chosen value is mirrored into both `selectedScope` and (for subscription/RG)
 * `azureSubscription` on AppContext.
 */
export default function ScopePicker() {
  const isAuthenticated = useIsAuthenticated();
  const { selectedScope, setSelectedScope } = useAppContext();

  const [mgs, setMgs] = useState<AzureManagementGroup[]>([]);
  const [subs, setSubs] = useState<AzureSubscription[]>([]);
  const [rgsBySub, setRgsBySub] = useState<Record<string, AzureResourceGroup[]>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mgList, subList] = await Promise.all([
        listManagementGroups(),
        listSubscriptions(),
      ]);
      setMgs(mgList);
      setSubs(subList);
      setRgsBySub({}); // invalidate RG cache; will lazy-reload on hover

      // If the previously selected scope is gone, clear it.
      if (selectedScope) {
        const stillThere =
          (selectedScope.kind === 'managementGroup' && mgList.some((m) => m.name === selectedScope.name))
          || (selectedScope.kind === 'subscription' && subList.some((s) => s.subscriptionId === selectedScope.subscriptionId))
          || (selectedScope.kind === 'resourceGroup' && subList.some((s) => s.subscriptionId === selectedScope.subscriptionId));
        if (!stillThere) setSelectedScope(null);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedScope, setSelectedScope]);

  useEffect(() => {
    if (!isAuthenticated) {
      setMgs([]);
      setSubs([]);
      setRgsBySub({});
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const ensureRgsLoaded = useCallback(async (subscriptionId: string) => {
    if (rgsBySub[subscriptionId]) return;
    const list = await listResourceGroups(subscriptionId);
    setRgsBySub((prev) => ({ ...prev, [subscriptionId]: list }));
  }, [rgsBySub]);

  if (!isAuthenticated) return null;

  const label = scopeLabel(selectedScope);

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

          {mgs.length > 0 && (
            <>
              <MenuDivider />
              <MenuItem disabled style={{ fontWeight: 600, opacity: 0.7 }}>
                Management Groups
              </MenuItem>
              {mgs.map((m) => (
                <MenuItem
                  key={m.id}
                  onClick={() =>
                    setSelectedScope({
                      kind: 'managementGroup',
                      id: m.id,
                      name: m.name,
                      displayName: m.properties.displayName,
                    })
                  }
                >
                  {m.properties.displayName}
                  <span style={muted}>{m.name}</span>
                </MenuItem>
              ))}
            </>
          )}

          <MenuDivider />
          <MenuItem disabled style={{ fontWeight: 600, opacity: 0.7 }}>
            Subscriptions
          </MenuItem>
          {subs.length === 0 && !loading && (
            <MenuItem disabled>No subscriptions found</MenuItem>
          )}
          {subs.map((s) => (
            <Menu key={s.subscriptionId} positioning="after">
              <MenuTrigger disableButtonEnhancement>
                <MenuItem
                  submenuIndicator={<ChevronRightRegular />}
                  onClick={() =>
                    setSelectedScope({
                      kind: 'subscription',
                      id: s.id,
                      subscriptionId: s.subscriptionId,
                      displayName: s.displayName,
                      tenantId: s.tenantId,
                    })
                  }
                  onMouseEnter={() => void ensureRgsLoaded(s.subscriptionId)}
                  onFocus={() => void ensureRgsLoaded(s.subscriptionId)}
                >
                  {s.displayName}
                  <span style={muted}>{s.subscriptionId}</span>
                </MenuItem>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem
                    onClick={() =>
                      setSelectedScope({
                        kind: 'subscription',
                        id: s.id,
                        subscriptionId: s.subscriptionId,
                        displayName: s.displayName,
                        tenantId: s.tenantId,
                      })
                    }
                  >
                    Use whole subscription
                  </MenuItem>
                  <MenuDivider />
                  <MenuItem disabled style={{ fontWeight: 600, opacity: 0.7 }}>
                    Resource Groups
                  </MenuItem>
                  {(rgsBySub[s.subscriptionId] ?? []).length === 0 && (
                    <MenuItem disabled>
                      {rgsBySub[s.subscriptionId] ? 'None' : 'Loading…'}
                    </MenuItem>
                  )}
                  {(rgsBySub[s.subscriptionId] ?? []).map((rg) => (
                    <MenuItem
                      key={rg.id}
                      onClick={() =>
                        setSelectedScope({
                          kind: 'resourceGroup',
                          id: rg.id,
                          name: rg.name,
                          location: rg.location,
                          subscriptionId: s.subscriptionId,
                          subscriptionName: s.displayName,
                        })
                      }
                    >
                      {rg.name}
                      <span style={muted}>{rg.location}</span>
                    </MenuItem>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

const muted: React.CSSProperties = {
  color: 'var(--colorNeutralForeground3)',
  marginLeft: 8,
  fontSize: 11,
};

function scopeLabel(scope: ScopeRef | null): string {
  if (!scope) return 'Select scope';
  switch (scope.kind) {
    case 'managementGroup':
      return `MG: ${scope.displayName}`;
    case 'subscription':
      return `Sub: ${scope.displayName}`;
    case 'resourceGroup':
      return `RG: ${scope.name}`;
  }
}

