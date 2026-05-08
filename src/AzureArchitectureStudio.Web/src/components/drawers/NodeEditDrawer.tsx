import { useEffect, useState } from 'react';
import {
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Input,
  Field,
  Switch,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Dropdown,
  Option,
} from '@fluentui/react-components';
import { DismissRegular, WarningRegular } from '@fluentui/react-icons';
import { useAppContext } from '../../context/AppContext';
import type { AzureNode, AzureNodeData } from '../../models';
import { getResourceType, getResourceTypeAsync, getDisplayName } from '../../models';
import type { ResourceTypeDefinition } from '../../models';
import { evaluateDependencies } from '../../hooks/useDependencies';
import { evaluateRequiredProperties } from '../../hooks/useRequiredProperties';
import { parseSubnetNodeId } from '../../hooks/useSubnetSync';
import { regionOptions } from '../../models/azure-regions';
import { resolveKey } from '../../models/resource-registry';
import SchemaForm from '../forms/SchemaForm';
import { dbg } from '../../utils/debug';

interface NodeEditDrawerProps {
  node: AzureNode;
  open: boolean;
  onClose: () => void;
}

export default function NodeEditDrawer({
  node,
  open,
  onClose,
}: NodeEditDrawerProps) {
  const { updateNodeData, nodes, edges } = useAppContext();
  const data = node.data as AzureNodeData;

  // If this node is a subnet child of a VNet, edits to its name and
  // address prefix must be routed back into the VNet's properties.subnets
  // array (the source of truth) rather than the child's own data — the
  // child is regenerated from the parent on every render.
  const subnetRef = parseSubnetNodeId(node.id);
  const parentVnet = subnetRef ? nodes.find((n) => n.id === subnetRef.vnetId) : undefined;
  const parentVnetData = parentVnet?.data as AzureNodeData | undefined;
  const parentSubnets = (parentVnetData?.properties?.subnets as Array<Record<string, unknown>> | undefined) ?? [];
  const subnetEntry = subnetRef ? parentSubnets[subnetRef.index] : undefined;

  // Display values: prefer the parent's subnet entry over the child's
  // local data so we always show the source-of-truth value.
  const displayName = (subnetEntry?.name as string | undefined) ?? data.name;
  const displayAddressPrefix = (subnetEntry?.addressPrefix as string | undefined)
    ?? (data.properties?.addressPrefix as string | undefined) ?? '';

  const writeSubnetField = (field: 'name' | 'addressPrefix', value: string) => {
    if (!subnetRef || !parentVnet || !parentVnetData) return;
    const next = parentSubnets.map((s, i) =>
      i === subnetRef.index ? { ...s, [field]: value } : s,
    );
    dbg('NodeEditDrawer:writeSubnetField', { vnetId: subnetRef.vnetId, index: subnetRef.index, field, value });
    updateNodeData(subnetRef.vnetId, {
      properties: { ...parentVnetData.properties, subnets: next },
    });
  };

  // Try sync first; if missing, resolve async
  const [resourceDef, setResourceDef] = useState<ResourceTypeDefinition | undefined>(
    () => getResourceType(data.typeKey),
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const syncDef = getResourceType(data.typeKey);
    // Always show the curated def immediately if present so the form has
    // something to render — but ALSO kick off the async enrichment so the
    // "Advanced (from ARM spec)" group gets merged in once the GitHub
    // schema fetch completes.
    if (syncDef) {
      setResourceDef(syncDef);
      setLoading(false);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    getResourceTypeAsync(data.typeKey).then((def) => {
      if (cancelled) return;
      if (def) setResourceDef(def);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [data.typeKey, data.label]);

  const handleChange = (field: keyof AzureNodeData, value: unknown) => {
    dbg('NodeEditDrawer:handleChange', {
      nodeId: node.id,
      typeKey: data.typeKey,
      field,
      value,
      prevValue: data[field],
      isSubnetChild: !!subnetRef,
    });
    // Subnet children: route the name into the VNet's subnets array.
    if (subnetRef && field === 'name') {
      writeSubnetField('name', String(value ?? ''));
      return;
    }
    updateNodeData(node.id, { [field]: value } as Partial<AzureNodeData>);
  };

  const handlePropertyChange = (key: string, value: unknown) => {
    if (key === 'subnets') {
      dbg('NodeEditDrawer:handlePropertyChange', {
        nodeId: node.id,
        key,
        value,
        prevValue: data.properties?.[key],
      });
    }
    // Subnet children: route addressPrefix changes back into the VNet props.
    if (subnetRef && key === 'addressPrefix') {
      writeSubnetField('addressPrefix', String(value ?? ''));
      return;
    }
    updateNodeData(node.id, {
      properties: { ...data.properties, [key]: value },
    });
  };

  return (
    <OverlayDrawer position="end" open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              icon={<DismissRegular />}
              onClick={onClose}
            />
          }
        >
          {getDisplayName(data.typeKey)}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {/* Common fields: Name and Location */}
        <Field label="Name" required>
          <Input
            value={displayName}
            onChange={(_, d) => handleChange('name', d.value)}
            size="small"
          />
        </Field>

        {/* Location override — shown for every Azure resource except
            containers that don't carry a location of their own (resource
            group has its own dedicated Region field, subscriptions and
            management groups have none). Subnet children inherit from
            their VNet so we hide it for them too. */}
        {(() => {
          const tk = resolveKey(data.typeKey);
          const noLocationTypes = new Set([
            'resource-group',
            'subscriptions',
            'management-groups',
          ]);
          if (noLocationTypes.has(tk)) return null;
          if (subnetRef) return null;

          // Walk up parentId to find the enclosing resource group's region
          // so we can show it as the inherited default in the placeholder.
          let inherited: string | undefined;
          let cursor: AzureNode | undefined = node;
          const byId = new Map(nodes.map((n) => [n.id, n] as const));
          while (cursor && cursor.parentId) {
            const p = byId.get(cursor.parentId);
            if (!p) break;
            const pData = p.data as AzureNodeData | undefined;
            if (pData && resolveKey(pData.typeKey) === 'resource-group') {
              const loc = pData?.properties?.location as string | undefined;
              if (loc) inherited = loc;
              break;
            }
            cursor = p as AzureNode;
          }

          const opts = regionOptions();
          const current = (data.properties?.location as string | undefined) ?? '';
          const currentLabel = current
            ? opts.find((o) => o.value === current)?.label ?? current
            : '';
          return (
            <Field
              label="Location"
              hint={
                current
                  ? 'Overrides the resource group region.'
                  : inherited
                    ? `Inherits from resource group (${inherited}).`
                    : 'Inherits from resource group.'
              }
            >
              <Dropdown
                value={currentLabel}
                placeholder={
                  inherited
                    ? `Inherit from resource group (${inherited})`
                    : 'Inherit from resource group'
                }
                onOptionSelect={(_, d) => {
                  // Empty value clears the override (back to inheritance).
                  handlePropertyChange('location', d.optionValue || undefined);
                }}
                size="small"
              >
                <Option value="">— Inherit from resource group —</Option>
                {opts.map((o) => (
                  <Option key={o.value} value={o.value}>
                    {o.label}
                  </Option>
                ))}
              </Dropdown>
            </Field>
          );
        })()}

        {/* Resource-specific properties — driven by registry schema */}
        {loading ? (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Spinner size="tiny" />
            <span style={{ fontSize: 12, color: 'var(--colorNeutralForeground3)' }}>
              Loading resource properties…
            </span>
          </div>
        ) : resourceDef && resourceDef.propertySchema.length > 0 ? (
          <>
            {(() => {
              const missing = evaluateRequiredProperties(node);
              if (missing.length === 0) return null;
              return (
                <MessageBar intent="warning" icon={<WarningRegular />} style={{ marginTop: 12 }}>
                  <MessageBarBody>
                    <MessageBarTitle>
                      {missing.length === 1
                        ? 'Missing required value'
                        : `Missing ${missing.length} required values`}
                    </MessageBarTitle>
                    {missing.map((m) => (
                      <div key={m.key} style={{ fontSize: 12 }}>
                        • {m.label}
                      </div>
                    ))}
                  </MessageBarBody>
                </MessageBar>
              );
            })()}
            <SchemaForm
              schema={resourceDef.propertySchema}
              properties={
                subnetRef
                  ? { ...data.properties, addressPrefix: displayAddressPrefix }
                  : data.properties
              }
              nodeId={node.id}
              onChange={handlePropertyChange}
              onMultiChange={(updates) => {
                updateNodeData(node.id, {
                  properties: { ...data.properties, ...updates },
                });
              }}
            />
          </>
        ) : (
          <p style={{ marginTop: 12, color: 'var(--colorNeutralForeground3)', fontSize: 12 }}>
            No configurable properties available for this resource type.
          </p>
        )}

        {/* Dependencies section */}
        {(() => {
          const statuses = evaluateDependencies(node, nodes, edges);
          if (statuses.length === 0) return null;
          const unmet = statuses.filter((s) => s.dep.required && !s.fulfilled);
          return (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Dependencies</div>
              {unmet.length > 0 && (
                <MessageBar intent="warning" icon={<WarningRegular />} style={{ marginBottom: 8 }}>
                  <MessageBarBody>
                    <MessageBarTitle>Missing required dependencies</MessageBarTitle>
                    {unmet.map((s) => {
                      const expected = s.nameMismatch
                        ? Array.isArray(s.nameMismatch.expected)
                          ? s.nameMismatch.expected.join("' or '")
                          : s.nameMismatch.expected
                        : null;
                      const reason = s.nameMismatch
                        ? ` — name is '${s.nameMismatch.actual || '(empty)'}' but must be '${expected}'`
                        : s.dep.hint
                          ? ` — ${s.dep.hint}`
                          : '';
                      return (
                        <div key={s.dep.key} style={{ fontSize: 12 }}>
                          • {s.dep.label}{reason}
                        </div>
                      );
                    })}
                  </MessageBarBody>
                </MessageBar>
              )}
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {statuses.map((s) => (
                  <li key={s.dep.key} style={{ color: s.fulfilled ? 'var(--colorPaletteGreenForeground1)' : 'var(--colorNeutralForeground2)' }}>
                    {s.fulfilled ? '✓' : '○'} {s.dep.label}
                    {s.fulfilled && s.source && (
                      <span style={{ color: 'var(--colorNeutralForeground3)', marginLeft: 4 }}>
                        (via {s.source})
                      </span>
                    )}
                    {!s.fulfilled && s.nameMismatch && (
                      <span style={{ color: 'var(--colorPaletteRedForeground1)', marginLeft: 4 }}>
                        (wrong name: '{s.nameMismatch.actual || '(empty)'}')
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

        {/* Show ARM type for reference */}
        {resourceDef && (
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--colorNeutralForeground3)' }}>
            ARM type: {resourceDef.armType} (api {resourceDef.apiVersion})
          </div>
        )}
      </DrawerBody>
    </OverlayDrawer>
  );
}
