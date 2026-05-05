/**
 * useEdgeRouting — recompute each edge's source/target handle to use the
 * shortest of the four (bottom|right) × (top|left) paths between source
 * and target node sides.
 *
 * Runs whenever node positions/sizes/parentage or edges change. Only writes
 * back to setEdges if at least one edge needs updating, and only updates
 * the changed fields.
 */

import { useEffect } from 'react';
import type { AzureNode } from '../models';

type RFEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  [key: string]: unknown;
};

interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_NODE_W = 96;
const DEFAULT_NODE_H = 96;

function getNodeSize(n: AzureNode): { width: number; height: number } {
  const w =
    (n.measured?.width as number | undefined)
    ?? (typeof n.style?.width === 'number' ? (n.style.width as number) : undefined)
    ?? (n.width as number | undefined)
    ?? DEFAULT_NODE_W;
  const h =
    (n.measured?.height as number | undefined)
    ?? (typeof n.style?.height === 'number' ? (n.style.height as number) : undefined)
    ?? (n.height as number | undefined)
    ?? DEFAULT_NODE_H;
  return { width: w, height: h };
}

function buildAbsoluteBoxes(nodes: AzureNode[]): Map<string, NodeBox> {
  const map = new Map<string, NodeBox>();
  const byId = new Map(nodes.map((n) => [n.id, n] as const));

  function box(id: string): NodeBox {
    const cached = map.get(id);
    if (cached) return cached;
    const n = byId.get(id);
    if (!n) {
      const empty = { x: 0, y: 0, width: 0, height: 0 };
      map.set(id, empty);
      return empty;
    }
    const { width, height } = getNodeSize(n);
    let x = n.position.x;
    let y = n.position.y;
    const pid = (n as { parentId?: string }).parentId;
    if (pid && byId.has(pid)) {
      const p = box(pid);
      x += p.x;
      y += p.y;
    }
    const out = { x, y, width, height };
    map.set(id, out);
    return out;
  }

  for (const n of nodes) box(n.id);
  return map;
}

interface HandlePoint { x: number; y: number; handle: 'top' | 'right' | 'bottom' | 'left' }

function sourceHandles(b: NodeBox): HandlePoint[] {
  return [
    { x: b.x + b.width / 2, y: b.y + b.height, handle: 'bottom' },
    { x: b.x + b.width, y: b.y + b.height / 2, handle: 'right' },
  ];
}

function targetHandles(b: NodeBox): HandlePoint[] {
  return [
    { x: b.x + b.width / 2, y: b.y, handle: 'top' },
    { x: b.x, y: b.y + b.height / 2, handle: 'left' },
  ];
}

function pickShortest(s: NodeBox, t: NodeBox): { source: HandlePoint; target: HandlePoint } {
  let best: { source: HandlePoint; target: HandlePoint; d: number } | null = null;
  for (const sh of sourceHandles(s)) {
    for (const th of targetHandles(t)) {
      const dx = sh.x - th.x;
      const dy = sh.y - th.y;
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { source: sh, target: th, d };
    }
  }
  // Will always be set because both arrays are non-empty.
  return best!;
}

export function useEdgeRouting(
  nodes: AzureNode[],
  edges: RFEdge[],
  setEdges: React.Dispatch<React.SetStateAction<RFEdge[]>>,
) {
  useEffect(() => {
    if (edges.length === 0 || nodes.length === 0) return;
    const boxes = buildAbsoluteBoxes(nodes);

    let changed = false;
    const next: RFEdge[] = edges.map((e) => {
      const sBox = boxes.get(e.source);
      const tBox = boxes.get(e.target);
      if (!sBox || !tBox) return e;
      const { source, target } = pickShortest(sBox, tBox);
      if (e.sourceHandle === source.handle && e.targetHandle === target.handle) return e;
      changed = true;
      return { ...e, sourceHandle: source.handle, targetHandle: target.handle };
    });

    if (changed) setEdges(next);
    // We intentionally exclude setEdges from deps — it's stable from useState.
    // Re-run when the spatial layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);
}
