/**
 * useRequiredProperties — companion to `useDependencies`. Inspects a node's
 * `properties` against its `propertySchema` and surfaces any required fields
 * the user (or the AI) hasn't filled in.
 *
 * The schema honours `visibleWhen`, so a field that's hidden under the
 * current values is NOT considered missing. Object / object-array children
 * are walked recursively when the parent is itself required (or has been
 * given a non-empty value), so e.g. a required nested key is only flagged
 * once the parent block is in scope.
 */

import type { AzureNode, AzureNodeData } from '../models';
import { getResourceType } from '../models';
import type { PropertyField } from '../models/resource-registry';

export interface MissingRequiredProperty {
  /** Top-level property key (or dotted path for nested fields). */
  key: string;
  /** Human-readable label for the field. */
  label: string;
}

/** True when a value should be treated as "not provided" for validation. */
function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** Test a `visibleWhen` clause against a property bag. */
function isVisible(field: PropertyField, props: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  const dep = props[field.visibleWhen.field];
  const expected = field.visibleWhen.value;
  return Array.isArray(expected)
    ? expected.includes(dep as string)
    : dep === expected;
}

function walk(
  fields: PropertyField[],
  props: Record<string, unknown>,
  pathPrefix: string,
  out: MissingRequiredProperty[],
): void {
  for (const f of fields) {
    if (!isVisible(f, props)) continue;

    const path = pathPrefix ? `${pathPrefix}.${f.key}` : f.key;
    const value = props[f.key];

    // For objects / object-arrays we don't flag the container itself —
    // missing children inside an unfilled container are usually noise.
    // Only descend when the user has actually started filling the block.
    if (f.type === 'object' && f.children && f.children.length > 0) {
      const child = (value as Record<string, unknown>) ?? {};
      // If the parent isn't required AND the user hasn't touched it, skip.
      if (!f.required && Object.keys(child).length === 0) continue;
      walk(f.children, child, path, out);
      continue;
    }

    if (f.type === 'object-array') {
      // Don't recurse into array items for required-field validation —
      // the array itself can be marked required which is enough.
      if (f.required && isEmptyValue(value)) {
        out.push({ key: path, label: f.label });
      }
      continue;
    }

    if (!f.required) continue;

    // Use the schema default when no explicit value has been set.
    const effective = value !== undefined ? value : f.defaultValue;
    if (isEmptyValue(effective)) {
      out.push({ key: path, label: f.label });
    }
  }
}

/**
 * Returns the list of required properties on `node` that currently have no
 * value. Empty list ⇒ all required fields are filled.
 */
export function evaluateRequiredProperties(node: AzureNode): MissingRequiredProperty[] {
  const data = node.data as AzureNodeData;
  const def = getResourceType(data.typeKey);
  if (!def || !def.propertySchema || def.propertySchema.length === 0) return [];

  const out: MissingRequiredProperty[] = [];
  walk(def.propertySchema, data.properties ?? {}, '', out);
  return out;
}

/** True if any required property on `node` is empty. */
export function hasMissingRequiredProperties(node: AzureNode): boolean {
  return evaluateRequiredProperties(node).length > 0;
}
