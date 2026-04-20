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
  Divider,
} from '@fluentui/react-components';
import { AddRegular, DeleteRegular, ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import { useState } from 'react';
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

    case 'object':
      return (
        <ObjectField
          field={field}
          value={(value as Record<string, unknown>) ?? {}}
          onChange={onChange}
        />
      );

    case 'object-array':
      return (
        <ObjectArrayField
          field={field}
          value={(value as Record<string, unknown>[]) ?? []}
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

// ---------------------------------------------------------------------------
// Nested object — renders child fields in a collapsible section
// ---------------------------------------------------------------------------
interface ObjectFieldProps {
  field: PropertyField;
  value: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

function ObjectField({ field, value, onChange }: ObjectFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const children = field.children ?? [];
  if (children.length === 0) return null;

  const handleChildChange = (childKey: string, childValue: unknown) => {
    onChange(field.key, { ...value, [childKey]: childValue });
  };

  return (
    <div style={{ marginTop: 4 }}>
      <Button
        appearance="subtle"
        size="small"
        icon={expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
        onClick={() => setExpanded(!expanded)}
        style={{ fontWeight: 600, paddingLeft: 0 }}
      >
        {field.label}
      </Button>
      {expanded && (
        <div style={{ marginLeft: 12, borderLeft: '2px solid var(--colorNeutralStroke2)', paddingLeft: 12, marginTop: 4 }}>
          {children.map((child) => {
            if (child.visibleWhen) {
              const dep = value[child.visibleWhen.field];
              if (dep !== child.visibleWhen.value) return null;
            }
            return (
              <SchemaField
                key={child.key}
                field={child}
                value={value[child.key] ?? child.defaultValue}
                properties={value}
                onChange={handleChildChange}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Array of objects — each item is a collapsible card with child fields
// ---------------------------------------------------------------------------
interface ObjectArrayFieldProps {
  field: PropertyField;
  value: Record<string, unknown>[];
  onChange: (key: string, value: unknown) => void;
}

function ObjectArrayField({ field, value, onChange }: ObjectArrayFieldProps) {
  const children = field.children ?? [];
  if (children.length === 0) return null;

  const items = value.length > 0 ? value : [];

  const handleAdd = () => {
    const blank: Record<string, unknown> = {};
    for (const c of children) {
      if (c.defaultValue !== undefined) blank[c.key] = c.defaultValue;
    }
    onChange(field.key, [...items, blank]);
  };

  const handleRemove = (index: number) => {
    onChange(field.key, items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, childKey: string, childValue: unknown) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [childKey]: childValue };
    onChange(field.key, updated);
  };

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{field.label}</span>
        <Tooltip content={`Add ${field.label}`} relationship="label">
          <Button appearance="subtle" icon={<AddRegular />} size="small" onClick={handleAdd} />
        </Tooltip>
      </div>
      {items.map((item, index) => (
        <ObjectArrayItem
          key={index}
          index={index}
          item={item}
          children={children}
          onRemove={() => handleRemove(index)}
          onChange={(childKey, childValue) => handleItemChange(index, childKey, childValue)}
        />
      ))}
      {items.length === 0 && (
        <p style={{ fontSize: 11, color: 'var(--colorNeutralForeground3)', margin: '4px 0' }}>
          No items. Click + to add.
        </p>
      )}
    </div>
  );
}

interface ObjectArrayItemProps {
  index: number;
  item: Record<string, unknown>;
  children: PropertyField[];
  onRemove: () => void;
  onChange: (childKey: string, childValue: unknown) => void;
}

function ObjectArrayItem({ index, item, children, onRemove, onChange }: ObjectArrayItemProps) {
  const [expanded, setExpanded] = useState(false);
  const itemLabel = (item.name as string) || `#${index + 1}`;

  return (
    <div style={{ borderLeft: '2px solid var(--colorNeutralStroke2)', paddingLeft: 12, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Button
          appearance="subtle"
          size="small"
          icon={expanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
          onClick={() => setExpanded(!expanded)}
          style={{ padding: 0, minWidth: 'auto' }}
        />
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{itemLabel}</span>
        <Button appearance="subtle" icon={<DeleteRegular />} size="small" onClick={onRemove} />
      </div>
      {expanded && (
        <div style={{ marginLeft: 8, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {children.map((child) => {
            if (child.visibleWhen) {
              const dep = item[child.visibleWhen.field];
              if (dep !== child.visibleWhen.value) return null;
            }
            return (
              <SchemaField
                key={child.key}
                field={child}
                value={item[child.key] ?? child.defaultValue}
                properties={item}
                onChange={onChange}
              />
            );
          })}
          <Divider style={{ marginTop: 4 }} />
        </div>
      )}
    </div>
  );
}
