/**
 * Helpers to "shrink-wrap" group nodes so their dimensions snug around
 * their direct children. Used after a drag to remove dead space (or grow
 * the container if a child moved past its right/bottom edge).
 *
 * These operate on plain React Flow node arrays — no async layout, no
 * elk dependency — so they're safe to call from drag-end callbacks.
 */
import type { AzureNode } from '../models';

const HEADER_PAD = 56;
const SIDE_PAD = 24;

/** Pull a numeric width from style, fallback to width / measured / default. */
function nodeWidth(n: AzureNode, fallback = 100): number {
  if (typeof n.style?.width === 'number') return n.style.width;
  if (typeof n.width === 'number') return n.width;
  if (typeof n.measured?.width === 'number') return n.measured.width;
  return fallback;
}
function nodeHeight(n: AzureNode, fallback = 100): number {
  if (typeof n.style?.height === 'number') return n.style.height;
  if (typeof n.height === 'number') return n.height;
  if (typeof n.measured?.height === 'number') return n.measured.height;
  return fallback;
}

/**
 * Resize the named groups in `groupIds` to enclose their immediate
 * children with HEADER_PAD on top and SIDE_PAD on the other three sides.
 *
 * Order matters: we sort `groupIds` deepest-first so an inner group's
 * style.width is up-to-date before its outer parent measures it.
 *
 * Children are NOT moved — if a user has dragged a child to a negative
 * coordinate the group will simply grow leftward by setting style.width
 * to maxRight (rather than shifting children, which would feel surprising).
 */
export function refitGroupsBottomUp(
  nodes: AzureNode[],
  groupIds: Set<string>,
): AzureNode[] {
  if (groupIds.size === 0) return nodes;

  // Build child index once.
  const childrenByParent = new Map<string, AzureNode[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    if (!childrenByParent.has(n.parentId)) childrenByParent.set(n.parentId, []);
    childrenByParent.get(n.parentId)!.push(n);
  }

  // Compute depth so we process inner groups first.
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = byId.get(id);
    while (cur?.parentId) {
      d++;
      cur = byId.get(cur.parentId);
    }
    return d;
  };
  const ordered = Array.from(groupIds).sort((a, b) => depthOf(b) - depthOf(a));

  // Mutate a working copy keyed by id so changes propagate during traversal.
  const working = new Map(nodes.map((n) => [n.id, { ...n }] as const));

  for (const gid of ordered) {
    const group = working.get(gid);
    if (!group || group.type !== 'azureGroup') continue;
    const kids = childrenByParent.get(gid) ?? [];
    if (kids.length === 0) continue;

    let maxRight = 0;
    let maxBottom = 0;
    for (const k of kids) {
      // If a child is itself a group we may have just resized, read the
      // updated copy from `working`, otherwise the original node is fine.
      const w = working.get(k.id) ?? k;
      const right = (w.position?.x ?? 0) + nodeWidth(w);
      const bottom = (w.position?.y ?? 0) + nodeHeight(w);
      if (right > maxRight) maxRight = right;
      if (bottom > maxBottom) maxBottom = bottom;
    }

    const newW = Math.max(maxRight + SIDE_PAD, 200);
    const newH = Math.max(maxBottom + SIDE_PAD, HEADER_PAD + 64);
    working.set(gid, {
      ...group,
      style: { ...(group.style ?? {}), width: newW, height: newH },
    });
  }

  return nodes.map((n) => working.get(n.id) ?? n);
}

/**
 * Convenience: refit `startId` and every group above it up to the root.
 */
export function refitAncestors(
  nodes: AzureNode[],
  startId: string | undefined,
): AzureNode[] {
  if (!startId) return nodes;
  const ids = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  let cur: string | undefined = startId;
  while (cur) {
    ids.add(cur);
    cur = byId.get(cur)?.parentId;
  }
  return refitGroupsBottomUp(nodes, ids);
}
