import { useEffect, useMemo, useState } from 'react';
import {
  Field,
  Combobox,
  Option,
  Spinner,
  Link,
} from '@fluentui/react-components';
import { useIsAuthenticated } from '@azure/msal-react';
import {
  listSubscriptions,
  listManagementGroups,
  type AzureSubscription,
  type AzureManagementGroup,
} from '../../services';
import type { PropertyField } from '../../models/resource-registry';

interface AzurePickerFieldProps {
  field: PropertyField;
  value: unknown;
  /** Single-field update (used as a fallback). */
  onChange: (key: string, value: unknown) => void;
  /** Optional batched multi-field update; preferred when present. */
  onMultiChange?: (updates: Record<string, unknown>) => void;
}

interface PickerItem {
  key: string;       // unique key
  label: string;     // display
  value: unknown;    // value to assign to field.key
  raw: Record<string, unknown>; // full source record for azureFieldMap
}

/** Pull a value out of an object using a dotted path (e.g. "properties.displayName"). */
function pluck(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[seg];
    return undefined;
  }, obj);
}

export default function AzurePickerField({
  field,
  value,
  onChange,
  onMultiChange,
}: AzurePickerFieldProps) {
  const isAuthenticated = useIsAuthenticated();
  const [items, setItems] = useState<PickerItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the data source once the user is signed in.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!field.azureSource) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loader = async (): Promise<PickerItem[]> => {
      if (field.azureSource === 'subscription') {
        const subs = await listSubscriptions();
        return subs.map<PickerItem>((s: AzureSubscription) => ({
          key: s.subscriptionId,
          label: `${s.displayName} (${s.subscriptionId})`,
          value: s.subscriptionId,
          raw: s as unknown as Record<string, unknown>,
        }));
      }
      if (field.azureSource === 'managementGroup') {
        const mgs = await listManagementGroups();
        return mgs.map<PickerItem>((m: AzureManagementGroup) => ({
          key: m.id,
          label: `${m.properties?.displayName ?? m.name} (${m.name})`,
          // Default value stored is the full resource id (e.g.
          // /providers/Microsoft.Management/managementGroups/<name>) — that
          // matches the parentManagementGroupId schema and the MG's own id.
          value: m.id,
          raw: m as unknown as Record<string, unknown>,
        }));
      }
      return [];
    };

    loader()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, field.azureSource]);

  const selectedLabel = useMemo(() => {
    if (!items || value === undefined || value === null || value === '') return '';
    return items.find((i) => i.value === value)?.label ?? String(value);
  }, [items, value]);

  if (!isAuthenticated) {
    // Fall back to a plain text-equivalent message; the user can still type
    // free text into a sibling field when signed out, but we keep the
    // picker visible so the schema is consistent.
    return (
      <Field
        label={field.label}
        required={field.required}
        hint="Sign in with Azure to pick from your tenant."
      >
        <Combobox
          freeform
          value={(value as string) ?? ''}
          onChange={(e) => onChange(field.key, (e.target as HTMLInputElement).value)}
          size="small"
          placeholder={field.placeholder ?? 'Sign in to load list...'}
          disabled
        />
      </Field>
    );
  }

  return (
    <Field
      label={field.label}
      required={field.required}
      validationState={error ? 'warning' : undefined}
      validationMessage={error ?? undefined}
    >
      <Combobox
        freeform
        value={selectedLabel || ((value as string) ?? '')}
        size="small"
        placeholder={
          loading
            ? 'Loading...'
            : (items && items.length === 0)
              ? 'No items found'
              : field.placeholder
        }
        onChange={(e) => {
          // User typed free text — store as raw.
          onChange(field.key, (e.target as HTMLInputElement).value);
        }}
        onOptionSelect={(_, d) => {
          const picked = items?.find((i) => i.key === d.optionValue);
          if (!picked) {
            onChange(field.key, d.optionValue ?? '');
            return;
          }
          // Build batched update: the picker key plus any mapped sibling
          // fields declared on the schema.
          const updates: Record<string, unknown> = { [field.key]: picked.value };
          if (field.azureFieldMap) {
            for (const [propKey, srcPath] of Object.entries(field.azureFieldMap)) {
              if (propKey === field.key) continue;
              const v = pluck(picked.raw, srcPath);
              if (v !== undefined) updates[propKey] = v;
            }
          }
          if (onMultiChange) {
            onMultiChange(updates);
          } else {
            for (const [k, v] of Object.entries(updates)) onChange(k, v);
          }
        }}
      >
        {(items ?? []).map((it) => (
          <Option key={it.key} value={it.key} text={it.label}>
            {it.label}
          </Option>
        ))}
      </Combobox>
      {!loading && (!items || items.length === 0) && !error && (
        <Link
          appearance="subtle"
          onClick={() => {
            // Trigger reload by toggling a state — simplest is to remount
            // by clearing items.
            setItems(null);
            setError(null);
            setLoading(true);
            const reload = async () => {
              try {
                if (field.azureSource === 'subscription') {
                  const subs = await listSubscriptions();
                  setItems(
                    subs.map((s) => ({
                      key: s.subscriptionId,
                      label: `${s.displayName} (${s.subscriptionId})`,
                      value: s.subscriptionId,
                      raw: s as unknown as Record<string, unknown>,
                    })),
                  );
                } else if (field.azureSource === 'managementGroup') {
                  const mgs = await listManagementGroups();
                  setItems(
                    mgs.map((m) => ({
                      key: m.id,
                      label: `${m.properties?.displayName ?? m.name} (${m.name})`,
                      value: m.id,
                      raw: m as unknown as Record<string, unknown>,
                    })),
                  );
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load.');
              } finally {
                setLoading(false);
              }
            };
            void reload();
          }}
          style={{ fontSize: 11 }}
        >
          Refresh from Azure
        </Link>
      )}
    </Field>
  );
}
