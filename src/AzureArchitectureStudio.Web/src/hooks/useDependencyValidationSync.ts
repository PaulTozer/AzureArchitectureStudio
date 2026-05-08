/**
 * useDependencyValidationSync — Recomputes each node's `isValid` flag based on
 *   - whether required dependencies are fulfilled (parent-of-type,
 *     edge-connected, or property reference); and
 *   - whether all required property fields on the node carry a value.
 *
 * Drives the existing canvas warning icon. Also stamps a short
 * `validationSummary` string onto `data` so the warning's tooltip can tell
 * the user what's actually wrong without opening the drawer.
 */

import { useEffect, useRef } from 'react';
import type { AzureEdge, AzureNode, AzureNodeData } from '../models';
import { evaluateDependencies, hasUnfulfilledRequired } from './useDependencies';
import { evaluateRequiredProperties } from './useRequiredProperties';

export function useDependencyValidationSync(
  nodes: AzureNode[],
  edges: AzureEdge[],
  setNodes: React.Dispatch<React.SetStateAction<AzureNode[]>>,
) {
  const prevRef = useRef<string>('');

  useEffect(() => {
    interface Computed {
      valid: boolean;
      summary: string;
    }
    const computed = new Map<string, Computed>();
    for (const n of nodes) {
      const statuses = evaluateDependencies(n, nodes, edges);
      const depMissing = statuses.length > 0 && hasUnfulfilledRequired(statuses);
      const missingProps = evaluateRequiredProperties(n);
      const valid = !depMissing && missingProps.length === 0;

      // Build a short, human-readable summary used for the tooltip.
      const parts: string[] = [];
      if (depMissing) {
        const labels = statuses
          .filter((s) => s.dep.required && !s.fulfilled)
          .map((s) => s.dep.label);
        parts.push(`Missing dependency: ${labels.join(', ')}`);
      }
      if (missingProps.length > 0) {
        parts.push(
          `Missing required ${missingProps.length === 1 ? 'value' : 'values'}: ` +
            missingProps.map((p) => p.label).join(', '),
        );
      }
      computed.set(n.id, { valid, summary: parts.join(' · ') });
    }
    const fp = JSON.stringify(Array.from(computed.entries()));
    if (fp === prevRef.current) return;
    prevRef.current = fp;

    setNodes((cur) =>
      cur.map((n) => {
        const c = computed.get(n.id);
        if (!c) return n;
        const d = n.data as AzureNodeData;
        if (d.isValid === c.valid && d.validationSummary === c.summary) return n;
        return {
          ...n,
          data: { ...d, isValid: c.valid, validationSummary: c.summary },
        };
      }),
    );
  }, [nodes, edges, setNodes]);
}
