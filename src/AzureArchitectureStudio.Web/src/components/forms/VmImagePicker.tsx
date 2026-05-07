import { useEffect, useMemo, useState } from 'react';
import { Field, Combobox, Option, Spinner, Link } from '@fluentui/react-components';
import { useIsAuthenticated } from '@azure/msal-react';
import { useAppContext } from '../../context/AppContext';
import {
  listVmImagePublishers,
  listVmImageOffers,
  listVmImageSkus,
  type AzureVmImageEntry,
} from '../../services';
import type { AzureNodeData } from '../../models';

interface VmImagePickerProps {
  /** Current publisher value, written under properties.imagePublisher. */
  value: string;
  /** Atomic multi-update: writes imagePublisher / imageOffer / imageSku together. */
  onChange: (updates: Record<string, unknown>) => void;
  /** The full property bag for the VM. Used to read sibling fields and location override. */
  properties: Record<string, unknown>;
  /** Node id of the VM being edited so we can walk up to its RG for the inherited region. */
  nodeId: string;
}

const DEFAULT_REGION = 'eastus';

/** A common-publishers fallback for when the user is not signed in. */
const FALLBACK_PUBLISHERS = [
  'Canonical',
  'Debian',
  'MicrosoftWindowsServer',
  'MicrosoftSQLServer',
  'MicrosoftCBLMariner',
  'RedHat',
  'SUSE',
  'OpenLogic',
  'Oracle',
];

/**
 * Live cascading Publisher / Offer / SKU picker for VM `imageReference`.
 * Backed by the ARM image catalog when the user is signed in. Falls back
 * to free-text entry (with curated publisher hints) when offline. The
 * region is inherited from the VM's location override or its enclosing
 * resource group; if neither is set we default to `eastus` so the live
 * catalog still works without forcing a region selection.
 */
export default function VmImagePicker({ value, onChange, properties, nodeId }: VmImagePickerProps) {
  const isAuthenticated = useIsAuthenticated();
  const { selectedScope, azureSubscription, nodes } = useAppContext();

  const subscriptionId = useMemo(() => {
    if (selectedScope?.kind === 'subscription') return selectedScope.subscriptionId;
    if (selectedScope?.kind === 'resourceGroup') return selectedScope.subscriptionId;
    return azureSubscription?.subscriptionId;
  }, [selectedScope, azureSubscription]);

  const { region, regionSource } = useMemo(() => {
    const own = properties.location;
    if (typeof own === 'string' && own.trim()) {
      return { region: own.trim(), regionSource: 'override' as const };
    }
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    let cursor = byId.get(nodeId);
    while (cursor && cursor.parentId) {
      const p = byId.get(cursor.parentId);
      if (!p) break;
      const pData = p.data as AzureNodeData | undefined;
      if (pData?.typeKey === 'resource-group') {
        const loc = pData?.properties?.location;
        if (typeof loc === 'string' && loc.trim()) {
          return { region: loc.trim(), regionSource: 'rg' as const };
        }
        break;
      }
      cursor = p;
    }
    return { region: DEFAULT_REGION, regionSource: 'default' as const };
  }, [properties.location, nodes, nodeId]);

  const publisher = (value as string) ?? '';
  const offer = (properties.imageOffer as string) ?? '';
  const sku = (properties.imageSku as string) ?? '';

  // --- live publisher list -------------------------------------------------
  const [publishers, setPublishers] = useState<string[] | null>(null);
  const [pubLoading, setPubLoading] = useState(false);
  const [pubError, setPubError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !subscriptionId) {
      setPublishers(null);
      setPubError(null);
      setPubLoading(false);
      return;
    }
    let cancelled = false;
    setPubLoading(true);
    setPubError(null);
    listVmImagePublishers(subscriptionId, region)
      .then((list) => {
        if (cancelled) return;
        if (!list || list.length === 0) {
          setPublishers(null);
          setPubError('No publishers returned — using fallback list.');
        } else {
          setPublishers(list.map((p) => p.name).sort((a, b) => a.localeCompare(b)));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPublishers(null);
        setPubError(err instanceof Error ? err.message : 'Failed to load publishers.');
      })
      .finally(() => {
        if (!cancelled) setPubLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, subscriptionId, region, reloadKey]);

  // --- live offer list (depends on publisher) -----------------------------
  const [offers, setOffers] = useState<string[] | null>(null);
  const [offerLoading, setOfferLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !subscriptionId || !publisher) {
      setOffers(null);
      setOfferLoading(false);
      return;
    }
    let cancelled = false;
    setOfferLoading(true);
    listVmImageOffers(subscriptionId, region, publisher)
      .then((list: AzureVmImageEntry[] | null) => {
        if (cancelled) return;
        setOffers(list ? list.map((o) => o.name).sort((a, b) => a.localeCompare(b)) : null);
      })
      .catch(() => {
        if (!cancelled) setOffers(null);
      })
      .finally(() => {
        if (!cancelled) setOfferLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, subscriptionId, region, publisher, reloadKey]);

  // --- live sku list (depends on publisher + offer) -----------------------
  const [skus, setSkus] = useState<string[] | null>(null);
  const [skuLoading, setSkuLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !subscriptionId || !publisher || !offer) {
      setSkus(null);
      setSkuLoading(false);
      return;
    }
    let cancelled = false;
    setSkuLoading(true);
    listVmImageSkus(subscriptionId, region, publisher, offer)
      .then((list: AzureVmImageEntry[] | null) => {
        if (cancelled) return;
        setSkus(list ? list.map((s) => s.name).sort((a, b) => a.localeCompare(b)) : null);
      })
      .catch(() => {
        if (!cancelled) setSkus(null);
      })
      .finally(() => {
        if (!cancelled) setSkuLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, subscriptionId, region, publisher, offer, reloadKey]);

  // --- search state -------------------------------------------------------
  const [pubQuery, setPubQuery] = useState('');
  const [offerQuery, setOfferQuery] = useState('');
  const [skuQuery, setSkuQuery] = useState('');

  const publisherList = publishers ?? FALLBACK_PUBLISHERS;
  const offerList = offers ?? (offer ? [offer] : []);
  const skuList = skus ?? (sku ? [sku] : []);

  const filterBy = (items: string[], q: string) => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((s) => s.toLowerCase().includes(t)).slice(0, 200);
  };
  const pubMatches = useMemo(() => filterBy(publisherList, pubQuery), [publisherList, pubQuery]);
  const offerMatches = useMemo(() => filterBy(offerList, offerQuery), [offerList, offerQuery]);
  const skuMatches = useMemo(() => filterBy(skuList, skuQuery), [skuList, skuQuery]);

  const sourceHint = !subscriptionId
    ? 'Sign in and pick a subscription to load the live image catalog.'
    : pubLoading
      ? 'Fetching publishers…'
      : publishers
        ? regionSource === 'default'
          ? `Live: ${publishers.length} publishers (default region ${region}).`
          : `Live: ${publishers.length} publishers in ${region}.`
        : pubError ?? 'Using fallback publisher list.';

  return (
    <>
      <Field label="Image Publisher" required hint={sourceHint}>
        <Combobox
          freeform
          value={pubQuery || publisher}
          selectedOptions={publisher ? [publisher] : []}
          placeholder="Search publishers…"
          onFocus={(e) => (e.target as HTMLInputElement).select?.()}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setPubQuery(v);
            // Allow free-text publishers (rare custom ones) — push the
            // typed value as we go.
            onChange({ imagePublisher: v });
          }}
          onOptionSelect={(_, d) => {
            const picked = d.optionValue ?? '';
            if (!picked) return;
            // Picking a new publisher invalidates the cascading children.
            onChange({ imagePublisher: picked, imageOffer: '', imageSku: '' });
            setPubQuery('');
            setOfferQuery('');
            setSkuQuery('');
          }}
          size="small"
        >
          {pubMatches.map((p) => (
            <Option key={p} value={p} text={p}>
              {p}
            </Option>
          ))}
          {pubMatches.length === 0 && (
            <Option key="__no_pub" value="" disabled text="No matches">
              No matches
            </Option>
          )}
        </Combobox>
      </Field>

      <Field
        label="Image Offer"
        required
        hint={
          offerLoading
            ? 'Fetching offers…'
            : !publisher
              ? 'Pick a publisher first.'
              : offers
                ? `Live: ${offers.length} offers under ${publisher}.`
                : 'Free-text — sign in to browse offers.'
        }
      >
        <Combobox
          freeform
          value={offerQuery || offer}
          selectedOptions={offer ? [offer] : []}
          placeholder={publisher ? 'Search offers…' : 'Pick a publisher first'}
          disabled={!publisher}
          onFocus={(e) => (e.target as HTMLInputElement).select?.()}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setOfferQuery(v);
            onChange({ imageOffer: v });
          }}
          onOptionSelect={(_, d) => {
            const picked = d.optionValue ?? '';
            if (!picked) return;
            onChange({ imageOffer: picked, imageSku: '' });
            setOfferQuery('');
            setSkuQuery('');
          }}
          size="small"
        >
          {offerMatches.map((o) => (
            <Option key={o} value={o} text={o}>
              {o}
            </Option>
          ))}
          {publisher && offerMatches.length === 0 && (
            <Option key="__no_offer" value="" disabled text="No matches">
              No matches
            </Option>
          )}
        </Combobox>
      </Field>

      <Field
        label="Image SKU"
        required
        hint={
          skuLoading
            ? 'Fetching SKUs…'
            : !publisher || !offer
              ? 'Pick a publisher and offer first.'
              : skus
                ? `Live: ${skus.length} SKUs under ${publisher}/${offer}.`
                : 'Free-text — sign in to browse SKUs.'
        }
      >
        <Combobox
          freeform
          value={skuQuery || sku}
          selectedOptions={sku ? [sku] : []}
          placeholder={offer ? 'Search SKUs…' : 'Pick an offer first'}
          disabled={!publisher || !offer}
          onFocus={(e) => (e.target as HTMLInputElement).select?.()}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setSkuQuery(v);
            onChange({ imageSku: v });
          }}
          onOptionSelect={(_, d) => {
            const picked = d.optionValue ?? '';
            if (!picked) return;
            onChange({ imageSku: picked });
            setSkuQuery('');
          }}
          size="small"
        >
          {skuMatches.map((s) => (
            <Option key={s} value={s} text={s}>
              {s}
            </Option>
          ))}
          {publisher && offer && skuMatches.length === 0 && (
            <Option key="__no_sku" value="" disabled text="No matches">
              No matches
            </Option>
          )}
        </Combobox>
      </Field>

      {(pubLoading || offerLoading || skuLoading) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--colorNeutralForeground3)' }}>
          <Spinner size="extra-tiny" />
          <span>Loading from {region}…</span>
        </div>
      )}
      {!pubLoading && publishers && (
        <Link appearance="subtle" onClick={() => setReloadKey((k) => k + 1)} style={{ fontSize: 11 }}>
          Refresh from Azure
        </Link>
      )}
    </>
  );
}
