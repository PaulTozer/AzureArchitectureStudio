import {
  Field,
  Input,
  Dropdown,
  Option,
  RadioGroup,
  Radio,
  Switch,
  Button,
  Tooltip,
} from '@fluentui/react-components';
import { AddRegular, DeleteRegular } from '@fluentui/react-icons';
import type { PropertyField } from '../../models/resource-registry';

interface SchemaFormProps {
  schema: PropertyField[];
  properties: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

/**
 * Renders form fields dynamically from a PropertyField schema.
 * No per-resource-type code needed — the JSON registry drives everything.
 */
export default function SchemaForm({ schema, properties, onChange }: SchemaFormProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
      {schema.map((field) => {
        // Conditional visibility
        if (field.visibleWhen) {
          const dep = properties[field.visibleWhen.field];
          if (dep !== field.visibleWhen.value) return null;
        }

        return (
          <SchemaField
            key={field.key}
            field={field}
            value={properties[field.key] ?? field.defaultValue}
            properties={properties}
            onChange={onChange}
          />
        );
      })}
    </div>
  );
}

interface SchemaFieldProps {
  field: PropertyField;
  value: unknown;
  properties: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

function SchemaField({ field, value, onChange }: SchemaFieldProps) {
  switch (field.type) {
    case 'string':
    case 'password':
      return (
        <Field label={field.label} required={field.required}>
          <Input
            type={field.type === 'password' ? 'password' : 'text'}
            value={(value as string) ?? ''}
            onChange={(_, d) => onChange(field.key, d.value)}
            size="small"
            placeholder={field.placeholder}
          />
        </Field>
      );

    case 'number':
      return (
        <Field label={field.label} required={field.required}>
          <Input
            type="number"
            value={String(value ?? field.defaultValue ?? 0)}
            onChange={(_, d) => onChange(field.key, Number(d.value))}
            size="small"
          />
        </Field>
      );

    case 'boolean':
      return (
        <Field label={field.label}>
          <Switch
            checked={Boolean(value ?? field.defaultValue)}
            onChange={(_, d) => onChange(field.key, d.checked)}
            label={field.label}
          />
        </Field>
      );

    case 'select':
      return (
        <Field label={field.label} required={field.required}>
          <Dropdown
            value={field.options?.find((o) => o.value === value)?.label ?? ''}
            onOptionSelect={(_, d) => onChange(field.key, d.optionValue)}
            size="small"
          >
            {(field.options ?? []).map((opt) => (
              <Option key={opt.value} value={opt.value}>
                {opt.label}
              </Option>
            ))}
          </Dropdown>
        </Field>
      );

    case 'radio':
      return (
        <Field label={field.label}>
          <RadioGroup
            value={(value as string) ?? ''}
            onChange={(_, d) => onChange(field.key, d.value)}
            layout="horizontal"
          >
            {(field.options ?? []).map((opt) => (
              <Radio key={opt.value} value={opt.value} label={opt.label} />
            ))}
          </RadioGroup>
        </Field>
      );

    case 'array':
      return (
        <ArrayField
          field={field}
          value={(value as Record<string, string>[]) ?? []}
          onChange={onChange}
        />
      );

    default:
      return null;
  }
}

interface ArrayFieldProps {
  field: PropertyField;
  value: Record<string, string>[];
  onChange: (key: string, value: unknown) => void;
}

function ArrayField({ field, value, onChange }: ArrayFieldProps) {
  const items = value.length > 0 ? value : (field.defaultValue as Record<string, string>[]) ?? [];
  const itemKey = field.itemSchema?.key ?? 'value';

  const handleAdd = () => {
    onChange(field.key, [...items, { [itemKey]: '' }]);
  };

  const handleRemove = (index: number) => {
    onChange(field.key, items.filter((_, i) => i !== index));
  };

  const handleChange = (index: number, val: string) => {
    const updated = [...items];
    updated[index] = { [itemKey]: val };
    onChange(field.key, updated);
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Field label={field.label} />
        <Tooltip content={`Add ${field.itemSchema?.label ?? 'item'}`} relationship="label">
          <Button
            appearance="subtle"
            icon={<AddRegular />}
            size="small"
            onClick={handleAdd}
          />
        </Tooltip>
      </div>
      {items.map((item, index) => (
        <div key={index} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Input
            value={item[itemKey] ?? ''}
            onChange={(_, d) => handleChange(index, d.value)}
            size="small"
            placeholder={field.itemSchema?.placeholder}
            style={{ flex: 1 }}
          />
          {items.length > 1 && (
            <Button
              appearance="subtle"
              icon={<DeleteRegular />}
              size="small"
              onClick={() => handleRemove(index)}
            />
          )}
        </div>
      ))}
    </>
  );
}
