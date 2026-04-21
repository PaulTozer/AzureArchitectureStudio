/**
 * useBindingSync — Keeps "bound" child nodes anchored to their designated
 * corner inside a parent group node.
 *
 * When a parent group is resized, bound children are repositioned to stay
 * in their assigned corner (e.g. bottom-left for an NSG inside a subnet).
 */

import { useEffect, useRef } from 'react';
import type { AzureNode, AzureNodeData, BindingCorner } from '../models';

/** Which resource typeKeys can be bound to which parent group typeKeys.
 *  Include both the resource-types.json key and the azure-services.json key
 *  so binding works regardless of which stencil the user dragged from.
 */
export const BINDABLE_ASSOCIATIONS: Record<string, string[]> = {
  'nsg': ['subnet', 'virtual-networks'],
  'network-security-groups': ['subnet', 'virtual-networks'],
  'route-table': ['subnet'],
  'route-tables': ['subnet'],
};

const PADDING = 8;
const HEADER_HEIGHT = 32;
const DEFAULT_NODE_WIDTH = 80;
const DEFAULT_NODE_HEIGHT = 80;

/**
 * Returns true if the given child typeKey can be bound inside the given
 * parent typeKey.  Also strips any `--category` dedup suffix before matching.
 */
export function canBind(childTypeKey: string, parentTypeKey: string): boolean {
  const base = childTypeKey.replace(/--.*$/, '');
  const allowed = BINDABLE_ASSOCIATIONS[childTypeKey] ?? BINDABLE_ASSOCIATIONS[base];
  return !!allowed && allowed.includes(parentTypeKey);
}

/** Cycle to the next corner clockwise */
export function nextCorner(current: BindingCorner): BindingCorner {
  const order: BindingCorner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

/**
 * Compute the position for a bound node so its center sits on the corner of
 * the parent group (Microsoft-style: icon hangs off the boundary).
 */
export function cornerPosition(
  corner: BindingCorner,
  parentWidth: number,
  parentHeight: number,
  nodeWidth: number = DEFAULT_NODE_WIDTH,
  nodeHeight: number = DEFAULT_NODE_HEIGHT,
): { x: number; y: number } {
  const halfW = nodeWidth / 2;
  const halfH = nodeHeight / 2;
  switch (corner) {
    case 'top-left':
      return { x: -halfW, y: -halfH };
    case 'top-right':
      return { x: parentWidth - halfW, y: -halfH };
    case 'bottom-right':
      return { x: parentWidth - halfW, y: parentHeight - halfH };
    case 'bottom-left':
    default:
      return { x: -halfW, y: parentHeight - halfH };
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
      return d.binding && d.binding.corner && n.parentId;
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
        if (!d.binding || !d.binding.corner || !n.parentId) return n;

        const pd = parentDims.get(n.parentId);
        if (!pd || pd.w <= 0 || pd.h <= 0) return n;

        const nodeW = 32;
        const nodeH = 32;
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
