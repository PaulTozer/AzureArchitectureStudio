/**
 * useBindingSync — Keeps "bound" child nodes anchored to their designated
 * corner inside a parent group node.
 *
 * When a parent group is resized, bound children are repositioned to stay
 * in their assigned corner (e.g. bottom-left for an NSG inside a subnet).
 */

import { useEffect, useRef } from 'react';
import type { AzureNode, AzureNodeData, BindingCorner } from '../models';

/** Which resource typeKeys can be bound to which parent group typeKeys */
export const BINDABLE_ASSOCIATIONS: Record<string, string[]> = {
  nsg: ['subnet', 'virtual-networks'],
  'route-table': ['subnet'],
};

const PADDING = 8;
const HEADER_HEIGHT = 32;
const DEFAULT_NODE_WIDTH = 80;
const DEFAULT_NODE_HEIGHT = 80;

/**
 * Returns true if the given child typeKey can be bound inside the given
 * parent typeKey.
 */
export function canBind(childTypeKey: string, parentTypeKey: string): boolean {
  const allowed = BINDABLE_ASSOCIATIONS[childTypeKey];
  return !!allowed && allowed.includes(parentTypeKey);
}

/** Cycle to the next corner clockwise */
export function nextCorner(current: BindingCorner): BindingCorner {
  const order: BindingCorner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

/**
 * Compute the position for a bound node in a given corner of its parent.
 */
export function cornerPosition(
  corner: BindingCorner,
  parentWidth: number,
  parentHeight: number,
  nodeWidth: number = DEFAULT_NODE_WIDTH,
  nodeHeight: number = DEFAULT_NODE_HEIGHT,
): { x: number; y: number } {
  switch (corner) {
    case 'top-left':
      return { x: PADDING, y: HEADER_HEIGHT + PADDING };
    case 'top-right':
      return { x: parentWidth - nodeWidth - PADDING, y: HEADER_HEIGHT + PADDING };
    case 'bottom-right':
      return { x: parentWidth - nodeWidth - PADDING, y: parentHeight - nodeHeight - PADDING };
    case 'bottom-left':
    default:
      return { x: PADDING, y: parentHeight - nodeHeight - PADDING };
  }
}

/**
 * React hook that monitors parent group sizes and repositions any child
 * nodes that have `data.binding` set.
 */
export function useBindingSync(
  nodes: AzureNode[],
  setNodes: React.Dispatch<React.SetStateAction<AzureNode[]>>,
) {
  // Track previous parent dimensions so we only react on actual resizes
  const prevDims = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    // Build a map of parent id → measured dimensions
    const parentDims = new Map<string, { w: number; h: number }>();
    for (const n of nodes) {
      if (n.type === 'azureGroup') {
        const w = n.measured?.width ?? n.width ?? (n.style?.width as number | undefined) ?? 0;
        const h = n.measured?.height ?? n.height ?? (n.style?.height as number | undefined) ?? 0;
        parentDims.set(n.id, { w, h });
      }
    }

    // Check if any parent that has bound children changed size
    const boundChildren = nodes.filter((n) => {
      const d = n.data as AzureNodeData;
      return d.binding && n.parentId;
    });

    if (boundChildren.length === 0) return;

    // Fingerprint parent dims for parents that have bound children
    const relevantParentIds = new Set(boundChildren.map((n) => n.parentId!));
    let changed = false;
    const nextFp = new Map<string, string>();
    for (const pid of relevantParentIds) {
      const d = parentDims.get(pid);
      const fp = d ? `${d.w}x${d.h}` : '0x0';
      nextFp.set(pid, fp);
      if (prevDims.current.get(pid) !== fp) changed = true;
    }

    if (!changed) return;
    prevDims.current = nextFp;

    setNodes((cur) =>
      cur.map((n) => {
        const d = n.data as AzureNodeData;
        if (!d.binding || !n.parentId) return n;

        const pd = parentDims.get(n.parentId);
        if (!pd) return n;

        const nodeW = n.measured?.width ?? n.width ?? DEFAULT_NODE_WIDTH;
        const nodeH = n.measured?.height ?? n.height ?? DEFAULT_NODE_HEIGHT;
        const pos = cornerPosition(d.binding.corner, pd.w, pd.h, nodeW, nodeH);

        // Only update if position actually differs (avoid loops)
        if (Math.abs(n.position.x - pos.x) < 1 && Math.abs(n.position.y - pos.y) < 1) {
          return n;
        }

        return { ...n, position: pos };
      }),
    );
  }, [nodes, setNodes]);
}
