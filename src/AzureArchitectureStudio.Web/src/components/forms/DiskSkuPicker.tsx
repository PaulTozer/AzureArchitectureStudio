import { useEffect, useMemo, useState } from 'react';
import { Field, Dropdown, Option } from '@fluentui/react-components';
import { useIsAuthenticated } from '@azure/msal-react';
import { useAppContext } from '../../context/AppContext';
import { getRegionAvailabilityZones } from '../../services';
import { resolveKey } from '../../models/resource-registry';
import type { AzureNodeData } from '../../models';

interface DiskSkuPickerProps {
  fieldKey: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (key: string, value: unknown) => void;
  properties: Record<string, unknown>;
  nodeId: string;
}

const DEFAULT_REGION = 'eastus';

interface SkuOption {
  label: string;
  value: string;
  zonal: boolean; // true => *_ZRS, requires AZ-enabled region
}

const ALL_SKUS: SkuOption[] = [
  { label: 'Standard HDD (Standard_LRS)', value: 'Standard_LRS', zonal: false },
  { label: 'Standard SSD (StandardSSD_LRS)', value: 'StandardSSD_LRS', zonal: false },
  { label: 'Standard SSD ZRS (StandardSSD_ZRS)', value: 'StandardSSD_ZRS', zonal: true },
  { label: 'Premium SSD (Premium_LRS)', value: 'Premium_LRS', zonal: false },
  { label: 'Premium SSD ZRS (Premium_ZRS)', value: 'Premium_ZRS', zonal: true },
  { label: 'Premium SSD v2 (PremiumV2_LRS)', value: 'PremiumV2_LRS', zonal: false },
  { label: 'Ultra SSD (UltraSSD_LRS)', value: 'UltraSSD_LRS', zonal: false },
];

/**
 * Region-aware managed-disk SKU picker. Hides the *_ZRS options when the
 * effective region has no availability zones (ZRS requires AZs). Falls
 * back to showing every SKU when we can't determine zone support yet
 * (offline, no auth) so the design experience is never blocked.
 */
export default function DiskSkuPicker({
  fieldKey,
  label,
  required,
  value,
  onChange,
  properties,
  nodeId,
}: DiskSkuPickerProps) {
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
      if (pData && resolveKey(pData.typeKey) === 'resource-group') {
        const loc = pData?.properties?.location;
        if (typeof loc === 'string' && loc.trim()) return loc.trim();
        break;
      }
      cursor = p;
    }
    return DEFAULT_REGION;
  }, [properties.location, nodes, nodeId]);

  const [zones, setZones] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !subscriptionId) {
      setZones(null);
      return;
    }
    let cancelled = false;
    getRegionAvailabilityZones(subscriptionId, region)
      .then((z) => {
        if (!cancelled) setZones(z);
      })
      .catch(() => {
        if (!cancelled) setZones(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, subscriptionId, region]);

  // When zones become known and the current SKU is ZRS in a non-zonal
  // region, downgrade to the matching LRS variant so we never serialise
  // an invalid template.
  useEffect(() => {
    if (zones === null) return;
    if (zones.length > 0) return;
    if (!value.endsWith('_ZRS')) return;
    const lrs = value.replace(/_ZRS$/, '_LRS');
    onChange(fieldKey, lrs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones]);

  const supportsZones = zones === null ? true : zones.length > 0;
  const visibleSkus = supportsZones ? ALL_SKUS : ALL_SKUS.filter((s) => !s.zonal);

  const hint = !subscriptionId
    ? 'Sign in to filter SKUs by region zone support.'
    : zones === null
      ? `Checking zone support in ${region}…`
      : supportsZones
        ? `Region ${region} supports zones — ZRS SKUs available.`
        : `Region ${region} has no availability zones — ZRS SKUs hidden.`;

  return (
    <Field label={label} required={required} hint={hint}>
      <Dropdown
        selectedOptions={value ? [value] : []}
        value={visibleSkus.find((s) => s.value === value)?.label ?? value}
        onOptionSelect={(_, d) => onChange(fieldKey, d.optionValue ?? '')}
        size="small"
      >
        {visibleSkus.map((s) => (
          <Option key={s.value} value={s.value}>
            {s.label}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}
