import {
  Field,
  Dropdown,
  Option,
} from '@fluentui/react-components';

interface StorageAccountFormProps {
  properties: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

const skuOptions = [
  { label: 'Standard LRS', value: 'Standard_LRS' },
  { label: 'Standard GRS', value: 'Standard_GRS' },
  { label: 'Standard RAGRS', value: 'Standard_RAGRS' },
  { label: 'Standard ZRS', value: 'Standard_ZRS' },
  { label: 'Premium LRS', value: 'Premium_LRS' },
];

export default function StorageAccountForm({
  properties,
  onChange,
}: StorageAccountFormProps) {
  const sku = (properties.sku as string) ?? 'Standard_LRS';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      <Field label="SKU">
        <Dropdown
          value={skuOptions.find((s) => s.value === sku)?.label ?? 'Standard LRS'}
          onOptionSelect={(_, d) => onChange('sku', d.optionValue)}
          size="small"
        >
          {skuOptions.map((s) => (
            <Option key={s.value} value={s.value}>
              {s.label}
            </Option>
          ))}
        </Dropdown>
      </Field>
    </div>
  );
}
