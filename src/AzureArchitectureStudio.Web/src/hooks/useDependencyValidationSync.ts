/**
 * useDependencyValidationSync — Recomputes node `isValid` based on whether
 * required dependencies are fulfilled (parent-of-type, edge-connected, or
 * property reference). Surfaces the existing warning icon on nodes when a
 * required dependency is missing.
 */

import { useEffect, useRef } from 'react';
import type { AzureEdge, AzureNode, AzureNodeData } from '../models';
import { evaluateDependencies, hasUnfulfilledRequired } from './useDependencies';

export function useDependencyValidationSync(
  nodes: AzureNode[],
  edges: AzureEdge[],
  setNodes: React.Dispatch<React.SetStateAction<AzureNode[]>>,
) {
  const prevRef = useRef<string>('');

  useEffect(() => {
    // Build a fingerprint of all nodes' computed validity to detect changes
    const computed = new Map<string, boolean>();
    for (const n of nodes) {
      const statuses = evaluateDependencies(n, nodes, edges);
      const valid = statuses.length === 0 ? true : !hasUnfulfilledRequired(statuses);
      computed.set(n.id, valid);
    }
    const fp = JSON.stringify(Array.from(computed.entries()));
    if (fp === prevRef.current) return;
    prevRef.current = fp;

    setNodes((cur) =>
      cur.map((n) => {
        const valid = computed.get(n.id);
        if (valid === undefined) return n;
        const d = n.data as AzureNodeData;
        if (d.isValid === valid) return n;
        return { ...n, data: { ...d, isValid: valid } };
      }),
    );
  }, [nodes, edges, setNodes]);
}
