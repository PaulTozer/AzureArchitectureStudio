import { useEffect, useMemo, useState } from 'react';
import {
  Field,
  Combobox,
  Option,
  Spinner,
  Link,
} from '@fluentui/react-components';
import { useIsAuthenticated } from '@azure/msal-react';
import { useAppContext } from '../../context/AppContext';
import { listVmSizes } from '../../services';
import {
  VM_FAMILIES,
  buildFamiliesFromLiveSizes,
  formatSizeLabelPublic,
  getVmFamily,
  type VmFamily,
} from '../../models/vm-sizes';
import type { AzureNodeData } from '../../models';

interface VmSizePickerProps {
  /** Currently selected size, e.g. "Standard_D4s_v5" — written under properties.vmSize. */
  value: string;
  /** Currently saved family hint, written under properties.vmFamily. */
  familyValue: string;
  /** The full property bag for the VM. Used to discover the per-resource location override. */
  properties: Record<string, unknown>;
  /** Atomic update used to set both vmFamily + vmSize together. */
  onChange: (updates: Record<string, unknown>) => void;
  /** Node id of the VM being edited so we can walk up to its RG for the inherited region. */
  nodeId: string;
}

/**
 * Cascading VM Family + VM Size selector backed by the live ARM
 * `vmSizes` API when a subscription + region are available, with a
 * graceful fallback to the curated static catalog when offline / no
 * subscription / no region. Family is derived from the SKU name so any
 * brand-new family Azure introduces shows up automatically.
 */
export default function VmSizePicker({
  value,
  familyValue,
  properties,
  onChange,
  nodeId,
}: VmSizePickerProps) {
  const isAuthenticated = useIsAuthenticated();
  const { selectedScope, azureSubscription, nodes } = useAppContext();

  // Resolve the subscription id from the active scope (preferred) or the
  // legacy single-subscription state.
  const subscriptionId: string | undefined = useMemo(() => {
    if (selectedScope?.kind === 'subscription') return selectedScope.subscriptionId;
    if (selectedScope?.kind === 'resourceGroup') return selectedScope.subscriptionId;
    return azureSubscription?.subscriptionId;
  }, [selectedScope, azureSubscription]);

  // Resolve the region: prefer a per-resource override, otherwise walk
  // up to the enclosing resource group's location.
  const region: string | undefined = useMemo(() => {
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
    return undefined;
  }, [properties.location, nodes, nodeId]);

  const [liveFamilies, setLiveFamilies] = useState<VmFamily[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Fetch the live list whenever sub or region change. Falls back
  // silently to the catalog on any failure.
  useEffect(() => {
    if (!isAuthenticated || !subscriptionId || !region) {
      setLiveFamilies(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    listVmSizes(subscriptionId, region)
      .then((sizes) => {
        if (cancelled) return;
        if (!sizes || sizes.length === 0) {
          setLiveFamilies(null);
          setError('No VM sizes returned for this region — using offline catalog.');
        } else {
          setLiveFamilies(buildFamiliesFromLiveSizes(sizes));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLiveFamilies(null);
        setError(err instanceof Error ? err.message : 'Failed to load — using offline catalog.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, subscriptionId, region, reloadKey]);

  const families: VmFamily[] = liveFamilies ?? [...VM_FAMILIES];
  const familyByKey = useMemo(() => {
    const m = new Map<string, VmFamily>();
    for (const f of families) m.set(f.key, f);
    return m;
  }, [families]);

  // Pick the family whose key matches `familyValue`, or fall back to the
  // family inferred from the current size, or the first family.
  const activeFamilyKey: string =
    (familyValue && familyByKey.has(familyValue) && familyValue) ||
    inferFamilyForSize(value, families) ||
    families[0]?.key ||
    '';
  const activeFamily = familyByKey.get(activeFamilyKey);

  const familyLabel =
    families.find((f) => f.key === activeFamilyKey)?.shortName
      ? `${activeFamily?.shortName} — ${activeFamily?.description}`
      : '';
  const sizeLabel = useMemo(() => {
    const s = activeFamily?.sizes.find((x) => x.name === value);
    return s ? formatSizeLabelPublic(s) : value;
  }, [activeFamily, value]);

  // Free-text filter state for each combobox. Empty string = show all.
  const [familyQuery, setFamilyQuery] = useState('');
  const [sizeQuery, setSizeQuery] = useState('');

  const familyMatches = useMemo(() => {
    const q = familyQuery.trim().toLowerCase();
    if (!q) return families;
    return families.filter((f) => {
      const haystack = `${f.shortName} ${f.description} ${f.key}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [families, familyQuery]);

  // Across-all-families size search: when the user types a fragment of a
  // SKU name (e.g. "D4s_v5") we surface matches from every family so they
  // can jump straight to it without picking the family first.
  const sizeMatches = useMemo(() => {
    const q = sizeQuery.trim().toLowerCase();
    if (!q) {
      return (activeFamily?.sizes ?? []).map((s) => ({ size: s, family: activeFamily! }));
    }
    const out: { size: typeof families[number]['sizes'][number]; family: VmFamily }[] = [];
    for (const f of families) {
      for (const s of f.sizes) {
        const haystack = `${s.name} ${formatSizeLabelPublic(s)} ${f.shortName}`.toLowerCase();
        if (haystack.includes(q)) out.push({ size: s, family: f });
      }
    }
    return out.slice(0, 200);
  }, [families, activeFamily, sizeQuery]);

  const sourceHint = loading
    ? 'Fetching live VM sizes…'
    : liveFamilies
      ? `Live: ${families.length} families in ${region}.`
      : !subscriptionId
        ? 'Sign in and pick a subscription to load the live SKU list.'
        : !region
          ? 'Set the resource group region (or override location on this VM) to load live SKUs.'
          : error ?? 'Using offline catalog.';

  return (
    <>
      <Field
        label="VM Family"
        required
        hint={sourceHint}
        validationState={error && !loading ? 'warning' : undefined}
      >
        <Combobox
          freeform
          value={familyQuery || familyLabel}
          selectedOptions={activeFamilyKey ? [activeFamilyKey] : []}
          placeholder="Search families…"
          onFocus={(e) => (e.target as HTMLInputElement).select?.()}
          onInput={(e) => setFamilyQuery((e.target as HTMLInputElement).value)}
          onOptionSelect={(_, d) => {
            const fam = familyByKey.get(d.optionValue ?? '');
            if (!fam) return;
            const newSize =
              fam.sizes.find((s) => s.name === fam.defaultSize)?.name ??
              fam.sizes[0]?.name ??
              '';
            onChange({ vmFamily: fam.key, vmSize: newSize });
            setFamilyQuery('');
            setSizeQuery('');
          }}
          size="small"
        >
          {familyMatches.map((f) => (
            <Option key={f.key} value={f.key} text={`${f.shortName} — ${f.description}`}>
              {`${f.shortName} — ${f.description}`}
            </Option>
          ))}
          {familyMatches.length === 0 && (
            <Option key="__no_family_matches" value="" disabled text="No matches">
              No matches
            </Option>
          )}
        </Combobox>
      </Field>

      <Field
        label="VM Size"
        required
        hint="Type any part of a SKU name (e.g. D4s_v5) to search across all families."
      >
        <Combobox
          freeform
          value={sizeQuery || sizeLabel}
          selectedOptions={value ? [value] : []}
          placeholder="Search sizes…"
          onFocus={(e) => (e.target as HTMLInputElement).select?.()}
          onInput={(e) => setSizeQuery((e.target as HTMLInputElement).value)}
          onOptionSelect={(_, d) => {
            const picked = d.optionValue ?? '';
            if (!picked) return;
            // Find which family the picked SKU belongs to so we keep
            // vmFamily in sync (important when search jumped families).
            const owner =
              families.find((f) => f.sizes.some((s) => s.name === picked)) ??
              activeFamily;
            onChange({
              vmFamily: owner?.key ?? activeFamilyKey,
              vmSize: picked,
            });
            setSizeQuery('');
          }}
          size="small"
        >
          {sizeMatches.map(({ size, family }) => {
            const label = formatSizeLabelPublic(size);
            const display = sizeQuery.trim()
              ? `${label}  ·  ${family.shortName}`
              : label;
            return (
              <Option key={`${family.key}:${size.name}`} value={size.name} text={display}>
                {display}
              </Option>
            );
          })}
          {sizeMatches.length === 0 && (
            <Option key="__no_size_matches" value="" disabled text="No matches">
              No matches
            </Option>
          )}
        </Combobox>
      </Field>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--colorNeutralForeground3)' }}>
          <Spinner size="extra-tiny" />
          <span>Loading SKUs from {region}…</span>
        </div>
      )}
      {!loading && liveFamilies && (
        <Link
          appearance="subtle"
          onClick={() => setReloadKey((k) => k + 1)}
          style={{ fontSize: 11 }}
        >
          Refresh from Azure
        </Link>
      )}
    </>
  );
}

/** Match a known size against the available families to recover its family key. */
function inferFamilyForSize(size: string, families: VmFamily[]): string | undefined {
  if (!size) return undefined;
  // Prefer an exact membership check on whatever families we currently have.
  for (const f of families) {
    if (f.sizes.some((s) => s.name === size)) return f.key;
  }
  // Fall back to the curated catalog parser.
  const fam = getVmFamily(size);
  return fam?.key;
}
