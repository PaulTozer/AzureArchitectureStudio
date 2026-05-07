import { useEffect, useMemo, useState } from 'react';
import { Field, Dropdown, Option } from '@fluentui/react-components';
import { useIsAuthenticated } from '@azure/msal-react';
import { useAppContext } from '../../context/AppContext';
import { getRegionAvailabilityZones } from '../../services';
import type { AzureNodeData } from '../../models';

interface AvailabilityZonePickerProps {
  /** Field key in the property bag (e.g. "availabilityZone"). */
  fieldKey: string;
  label: string;
  required?: boolean;
  /** Current value (zone string like "1", or "" for "no zone"). */
  value: string;
  /** Singular onChange — the picker only owns its own field. */
  onChange: (key: string, value: unknown) => void;
  properties: Record<string, unknown>;
  nodeId: string;
  /** When true the picker writes a CSV string (e.g. "1,2,3") instead of a single zone. */
  multi?: boolean;
}

const DEFAULT_REGION = 'eastus';

/**
 * Region-aware Availability Zone picker. Looks up the zones supported
 * in the resource's effective region (override → enclosing RG → default)
 * and disables the dropdown when no zones are available, preventing the
 * user from picking "Zone 1" in regions like uksouth's pair `ukwest`
 * which has no AZs.
 */
export default function AvailabilityZonePicker({
  fieldKey,
  label,
  required,
  value,
  onChange,
  properties,
  nodeId,
  multi,
}: AvailabilityZonePickerProps) {
  const isAuthenticated = useIsAuthenticated();
  const { selectedScope, azureSubscription, nodes } = useAppContext();

  const subscriptionId = useMemo(() => {
    if (selectedScope?.kind === 'subscription') return selectedScope.subscriptionId;
    if (selectedScope?.kind === 'resourceGroup') return selectedScope.subscriptionId;
    return azureSubscription?.subscriptionId;
  }, [selectedScope, azureSubscription]);

  const region = useMemo(() => {
    const own = properties.location;
    if (typeof own === 'string' && own.trim()) return own.trim();
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    let cursor = byId.get(nodeId);
    while (cursor && cursor.parentId) {
      const p = byId.get(cursor.parentId);
      if (!p) break;
      const pData = p.data as AzureNodeData | undefined;
      if (pData?.typeKey === 'resource-group') {
        const loc = pData?.properties?.location;
        if (typeof loc === 'string' && loc.trim()) return loc.trim();
        break;
      }
      cursor = p;
    }
    return DEFAULT_REGION;
  }, [properties.location, nodes, nodeId]);

  const [zones, setZones] = useState<string[] | null>(null); // null = unknown
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !subscriptionId) {
      setZones(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getRegionAvailabilityZones(subscriptionId, region)
      .then((z) => {
        if (cancelled) return;
        setZones(z);
      })
      .catch(() => {
        if (!cancelled) setZones(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, subscriptionId, region]);

  // When region changes to one that doesn't support a previously-saved
  // zone, clear the value so we don't ship invalid ARM later.
  useEffect(() => {
    if (!zones) return;
    if (!value) return;
    if (multi) {
      const csv = (value || '').split(',').map((s) => s.trim()).filter(Boolean);
      const allowed = csv.filter((z) => zones.includes(z));
      if (allowed.length !== csv.length) onChange(fieldKey, allowed.join(','));
    } else if (!zones.includes(value)) {
      onChange(fieldKey, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones]);

  const supported = zones && zones.length > 0;
  const disabled = zones !== null && !supported;

  const hint = loading
    ? 'Checking zone support…'
    : zones === null
      ? subscriptionId
        ? `Sign-in required to verify zone support in ${region}.`
        : 'Sign in to verify zone support.'
      : supported
        ? `Region ${region} supports zones: ${zones.join(', ')}.`
        : `Region ${region} does not support availability zones.`;

  // Render single vs multi as different controls.
  if (multi) {
    const selected = (value || '').split(',').map((s) => s.trim()).filter(Boolean);
    return (
      <Field label={label} required={required} hint={hint}>
        <Dropdown
          multiselect
          disabled={disabled}
          selectedOptions={selected}
          value={selected.join(', ')}
          placeholder={disabled ? 'No zones in this region' : 'Pick zones'}
          onOptionSelect={(_, d) => {
            const next = d.selectedOptions ?? [];
            onChange(fieldKey, next.join(','));
          }}
          size="small"
        >
          {(zones ?? ['1', '2', '3']).map((z) => (
            <Option key={z} value={z}>{`Zone ${z}`}</Option>
          ))}
        </Dropdown>
      </Field>
    );
  }

  return (
    <Field label={label} required={required} hint={hint}>
      <Dropdown
        disabled={disabled}
        selectedOptions={value ? [value] : ['']}
        value={value ? `Zone ${value}` : 'No zone'}
        onOptionSelect={(_, d) => onChange(fieldKey, d.optionValue ?? '')}
        size="small"
      >
        <Option value="">No zone</Option>
        {(zones ?? ['1', '2', '3']).map((z) => (
          <Option key={z} value={z}>{`Zone ${z}`}</Option>
        ))}
      </Dropdown>
    </Field>
  );
}
