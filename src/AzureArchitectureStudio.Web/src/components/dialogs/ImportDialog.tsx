import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Field,
  Dropdown,
  Option,
  Spinner,
  MessageBar,
  MessageBarBody,
  Divider,
} from '@fluentui/react-components';
import {
  listSubscriptions,
  listResourceGroups,
  listManagementGroups,
  listResourcesInSubscription,
  listResourcesInResourceGroup,
  listSubscriptionsUnderManagementGroup,
  type AzureSubscription,
  type AzureResourceGroup,
  type AzureManagementGroup,
  type AzureArmResource,
} from '../../services';
import { useAppContext } from '../../context/AppContext';
import { buildNodesFromArmResources } from '../../models/arm-import';
import { autoLayout } from '../../utils/auto-layout';
import type { AzureNode } from '../../models';

type ScopeKind = 'managementGroup' | 'subscription' | 'resourceGroup';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onToast: (message: string, intent: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function ImportDialog({ open, onClose, onToast }: ImportDialogProps) {
  const { azureServices, setNodes, setEdges } = useAppContext();

  // Scope kind
  const [scopeKind, setScopeKind] = useState<ScopeKind>('subscription');

  // Pickable lists
  const [mgs, setMgs] = useState<AzureManagementGroup[] | null>(null);
  const [subs, setSubs] = useState<AzureSubscription[] | null>(null);
  const [rgs, setRgs] = useState<AzureResourceGroup[] | null>(null);
  const [loadingLists, setLoadingLists] = useState(false);

  // Selections
  const [selectedMg, setSelectedMg] = useState<string>('');
  const [selectedSub, setSelectedSub] = useState<string>('');
  const [selectedRg, setSelectedRg] = useState<string>('');

  // Preview
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<AzureArmResource[] | null>(null);
  const [importing, setImporting] = useState(false);

  // Reset state on open.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setSelectedMg('');
    setSelectedSub('');
    setSelectedRg('');
    setRgs(null);
  }, [open]);

  // Initial load: subs + mgs in parallel.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingLists(true);
      try {
        const [s, m] = await Promise.all([listSubscriptions(), listManagementGroups()]);
        if (cancelled) return;
        setSubs(s);
        setMgs(m);
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load RGs when a subscription is picked under the resourceGroup scope.
  useEffect(() => {
    if (scopeKind !== 'resourceGroup' || !selectedSub) return;
    let cancelled = false;
    (async () => {
      setRgs(null);
      const list = await listResourceGroups(selectedSub);
      if (!cancelled) setRgs(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeKind, selectedSub]);

  const handlePreview = useCallback(async () => {
    setPreview(null);
    setPreviewing(true);
    try {
      let resources: AzureArmResource[] = [];
      if (scopeKind === 'subscription') {
        if (!selectedSub) {
          onToast('Pick a subscription first.', 'warning');
          return;
        }
        resources = await listResourcesInSubscription(selectedSub);
      } else if (scopeKind === 'resourceGroup') {
        if (!selectedSub || !selectedRg) {
          onToast('Pick a subscription and a resource group.', 'warning');
          return;
        }
        resources = await listResourcesInResourceGroup(selectedSub, selectedRg);
      } else if (scopeKind === 'managementGroup') {
        if (!selectedMg) {
          onToast('Pick a management group first.', 'warning');
          return;
        }
        const childSubs = await listSubscriptionsUnderManagementGroup(selectedMg);
        if (childSubs.length === 0) {
          onToast('No subscriptions found under this management group.', 'warning');
          return;
        }
        const lists = await Promise.all(
          childSubs.map((s) => listResourcesInSubscription(s.name)),
        );
        resources = lists.flat();
      }
      setPreview(resources);
      if (resources.length === 0) {
        onToast('No resources found in the selected scope.', 'info');
      }
    } catch (err) {
      console.error(err);
      onToast('Failed to enumerate resources.', 'error');
    } finally {
      setPreviewing(false);
    }
  }, [scopeKind, selectedMg, selectedSub, selectedRg, onToast]);

  const handleImport = useCallback(async () => {
    if (!preview || preview.length === 0) {
      onToast('Preview the scope first.', 'warning');
      return;
    }
    setImporting(true);
    try {
      const result = buildNodesFromArmResources(preview, { iconCatalog: azureServices });
      // Run the imported subgraph through ELK for a clean layout before
      // appending. Best-effort — if elk fails, we still ship the unlaid
      // nodes so the import succeeds.
      let laidOut = result.nodes;
      try {
        laidOut = await autoLayout(result.nodes, result.edges);
      } catch (layoutErr) {
        console.warn('Auto-layout failed, using grid fallback', layoutErr);
      }
      setNodes((prev: AzureNode[]) => [...prev, ...laidOut]);
      if (result.edges.length > 0) {
        setEdges((prev) => [...prev, ...result.edges]);
      }
      const skipped = result.total - result.imported;
      const skippedMsg = skipped > 0 ? ` (${skipped} unsupported types skipped)` : '';
      const groupCount = result.nodes.filter((n) => n.type === 'azureGroup').length;
      onToast(
        `Imported ${result.imported} resource(s) into ${groupCount} group(s) with ${result.edges.length} link(s)${skippedMsg}.`,
        'success',
      );
      // Ask the diagram panel to fit the new content into view.
      window.dispatchEvent(new CustomEvent('aas:fit-view'));
      onClose();
    } catch (err) {
      console.error(err);
      onToast('Import failed.', 'error');
    } finally {
      setImporting(false);
    }
  }, [preview, azureServices, setNodes, setEdges, onToast, onClose]);

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }} modalType="modal">
      <DialogSurface style={{ maxWidth: 640 }}>
        <DialogBody>
          <DialogTitle>Import from Azure</DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <MessageBar intent="info">
              <MessageBarBody>
                Pick a scope and we'll enumerate its existing resources and add them to the canvas.
              </MessageBarBody>
            </MessageBar>

            <Field label="Scope">
              <Dropdown
                value={scopeKindLabel(scopeKind)}
                selectedOptions={[scopeKind]}
                onOptionSelect={(_, d) => {
                  setScopeKind((d.optionValue as ScopeKind) ?? 'subscription');
                  setPreview(null);
                }}
              >
                <Option value="managementGroup">Management Group</Option>
                <Option value="subscription">Subscription</Option>
                <Option value="resourceGroup">Resource Group</Option>
              </Dropdown>
            </Field>

            {scopeKind === 'managementGroup' && (
              <Field label="Management Group">
                <Dropdown
                  placeholder={loadingLists ? 'Loading...' : 'Pick a management group'}
                  value={mgs?.find((m) => m.name === selectedMg)?.properties?.displayName ?? selectedMg}
                  selectedOptions={selectedMg ? [selectedMg] : []}
                  onOptionSelect={(_, d) => {
                    setSelectedMg(d.optionValue ?? '');
                    setPreview(null);
                  }}
                >
                  {(mgs ?? []).map((m) => (
                    <Option key={m.id} value={m.name} text={m.properties?.displayName ?? m.name}>
                      {m.properties?.displayName ?? m.name} ({m.name})
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            )}

            {(scopeKind === 'subscription' || scopeKind === 'resourceGroup') && (
              <Field label="Subscription">
                <Dropdown
                  placeholder={loadingLists ? 'Loading...' : 'Pick a subscription'}
                  value={subs?.find((s) => s.subscriptionId === selectedSub)?.displayName ?? selectedSub}
                  selectedOptions={selectedSub ? [selectedSub] : []}
                  onOptionSelect={(_, d) => {
                    setSelectedSub(d.optionValue ?? '');
                    setSelectedRg('');
                    setPreview(null);
                  }}
                >
                  {(subs ?? []).map((s) => (
                    <Option key={s.subscriptionId} value={s.subscriptionId} text={s.displayName}>
                      {s.displayName} ({s.subscriptionId})
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            )}

            {scopeKind === 'resourceGroup' && selectedSub && (
              <Field label="Resource Group">
                <Dropdown
                  placeholder={rgs ? 'Pick a resource group' : 'Loading resource groups...'}
                  value={rgs?.find((r) => r.name === selectedRg)?.name ?? selectedRg}
                  selectedOptions={selectedRg ? [selectedRg] : []}
                  onOptionSelect={(_, d) => {
                    setSelectedRg(d.optionValue ?? '');
                    setPreview(null);
                  }}
                >
                  {(rgs ?? []).map((r) => (
                    <Option key={r.id} value={r.name} text={r.name}>
                      {r.name} <span style={{ color: 'var(--colorNeutralForeground3)' }}>({r.location})</span>
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            )}

            <Divider />

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button appearance="secondary" onClick={handlePreview} disabled={previewing}>
                {previewing ? <Spinner size="tiny" /> : 'Preview'}
              </Button>
              {preview && (
                <span style={{ fontSize: 12, color: 'var(--colorNeutralForeground3)' }}>
                  {preview.length} resource(s) found.
                </span>
              )}
            </div>

            {preview && preview.length > 0 && (
              <div
                style={{
                  maxHeight: 220,
                  overflow: 'auto',
                  border: '1px solid var(--colorNeutralStroke2)',
                  borderRadius: 4,
                  padding: 8,
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}
              >
                {preview.slice(0, 200).map((r) => (
                  <div key={r.id} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span style={{ color: 'var(--colorBrandForeground1)' }}>{r.type}</span>{' '}
                    <span>{r.name}</span>
                  </div>
                ))}
                {preview.length > 200 && (
                  <div style={{ color: 'var(--colorNeutralForeground3)', marginTop: 4 }}>
                    …and {preview.length - 200} more.
                  </div>
                )}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              appearance="primary"
              disabled={!preview || preview.length === 0 || importing}
              onClick={handleImport}
            >
              {importing ? <Spinner size="tiny" /> : 'Import'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function scopeKindLabel(k: ScopeKind): string {
  switch (k) {
    case 'managementGroup':
      return 'Management Group';
    case 'subscription':
      return 'Subscription';
    case 'resourceGroup':
      return 'Resource Group';
  }
}
