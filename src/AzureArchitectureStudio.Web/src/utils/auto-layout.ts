/**
 * Deterministic graph layout for the diagram canvas.
 *
 * Uses elkjs (a JS port of the Eclipse Layout Kernel) to place nodes and
 * route edges. Honours React Flow's parent/child relationships, so groups
 * (resource groups, vnets, subnets) are sized to fit their children and
 * children are positioned relative to their parent.
 */

import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
import type { AzureNode, AzureEdge } from '../models';

const elk = new ELK();

const NODE_WIDTH = 100;
const NODE_HEIGHT = 100;

const LAYOUT_OPTIONS = {
  // Use the simple "box" packer instead of "layered" — layered crashes
  // on certain nested-hierarchy + cross-hierarchy-edge shapes that we
  // routinely produce after re-parenting (issue elkjs/elkjs#129). The
  // deterministic packer below produces the final layout anyway; we
  // only ask elk for a left-to-right ordering hint.
  'elk.algorithm': 'box',
  'elk.spacing.nodeNode': '40',
  'elk.padding': '[top=56,left=24,right=24,bottom=24]',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
} as const;

interface NodeBox {
  width: number;
  height: number;
}

function getNodeBox(n: AzureNode): NodeBox {
  if (n.type === 'azureGroup') {
    let w =
      (typeof n.style?.width === 'number' ? n.style.width : undefined) ??
      n.width ??
      n.measured?.width ??
      400;
    let h =
      (typeof n.style?.height === 'number' ? n.style.height : undefined) ??
      n.height ??
      n.measured?.height ??
      300;
    // VNets carry their subnets in `data.properties.subnets`; subnets are
    // synthesised at render-time by useSubnetSync, so they're not in the
    // graph elk sees. Pre-size the VNet box big enough to fit them.
    const data = n.data as { typeKey?: string; properties?: { subnets?: unknown[] } } | undefined;
    if (data?.typeKey === 'virtual-networks' && Array.isArray(data.properties?.subnets)) {
      const count = Math.max(1, data.properties!.subnets!.length);
      const subnetW = 200;
      const subnetH = 160;
      const gap = 12;
      const sidePad = 16;
      const header = 36;
      w = Math.max(w, sidePad * 2 + count * subnetW + (count - 1) * gap);
      h = Math.max(h, header + sidePad * 2 + subnetH);
    }
    return { width: w, height: h };
  }
  return { width: NODE_WIDTH, height: NODE_HEIGHT };
}

/**
 * Layout the supplied nodes (with edges to influence ordering) and return
 * a new array of nodes with updated positions and group dimensions.
 *
 * Position coordinates are returned in React Flow's expected scheme: child
 * nodes are positioned relative to their parent, top-level nodes are
 * absolute on the canvas.
 */
export async function autoLayout(
  nodes: AzureNode[],
  edges: AzureEdge[],
): Promise<AzureNode[]> {
  if (nodes.length === 0) return nodes;

  // Build a map: parentId -> children. Top-level nodes live under "__root".
  const childrenByParent = new Map<string, AzureNode[]>();
  for (const n of nodes) {
    const parent = n.parentId ?? '__root';
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent)!.push(n);
  }

  // Try elk first — its left-to-right ordering is useful as a hint for the
  // packer below. If elk crashes (it has bugs with hierarchical edges in
  // certain shapes), fall back to whatever positions the input had.
  // eslint-disable-next-line no-console
  console.debug('[auto-layout] running v3 (deterministic packer)', {
    nodeCount: nodes.length,
    edgeCount: edges.length,
  });

  let elkPositions = new Map<string, { x: number; y: number }>();
  try {
    const elkEdges: ElkExtendedEdge[] = edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    }));
    const buildElkNode = (n: AzureNode): ElkNode => {
      const box = getNodeBox(n);
      const kids = childrenByParent.get(n.id) ?? [];
      return {
        id: n.id,
        width: kids.length === 0 ? box.width : undefined,
        height: kids.length === 0 ? box.height : undefined,
        layoutOptions: kids.length > 0 ? { ...LAYOUT_OPTIONS } : undefined,
        children: kids.length > 0 ? kids.map(buildElkNode) : undefined,
      };
    };
    const elkRoots = childrenByParent.get('__root') ?? [];
    const elkGraph: ElkNode = {
      id: '__root',
      layoutOptions: { ...LAYOUT_OPTIONS, 'elk.direction': 'RIGHT' },
      children: elkRoots.map(buildElkNode),
      edges: elkEdges,
    };
    const result = await elk.layout(elkGraph);
    const collect = (n: ElkNode) => {
      if (n.id !== '__root' && n.x !== undefined && n.y !== undefined) {
        elkPositions.set(n.id, { x: n.x, y: n.y });
      }
      n.children?.forEach(collect);
    };
    collect(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[auto-layout] elk failed, packer-only', err);
    elkPositions = new Map();
  }

  // Apply elk positions where available; keep input positions otherwise.
  // The packer below will overwrite these for every group's children.
  const laidOut: AzureNode[] = nodes.map((n) => {
    const p = elkPositions.get(n.id);
    if (!p) return n;
    return { ...n, position: { x: p.x, y: p.y } };
  });

  // Post-pass: enforce a clean parent/child layout regardless of what
  // ELK produced. We can't trust elk's group widths because the
  // useSubnetSync and re-parented child paths add nodes after layout,
  // and elk sometimes emits relative coordinates that fall outside the
  // parent box. So:
  //   1. Walk depth-first.
  //   2. Re-pack each group's direct children in a wrapping grid using
  //      their actual measured/declared sizes.
  //   3. Size the group to enclose them with a header band on top.
  const byId = new Map(laidOut.map((n) => [n.id, n]));
  const childrenById = new Map<string, AzureNode[]>();
  for (const n of laidOut) {
    if (!n.parentId) continue;
    if (!childrenById.has(n.parentId)) childrenById.set(n.parentId, []);
    childrenById.get(n.parentId)!.push(n);
  }

  const HEADER_PAD = 56;
  const SIDE_PAD = 24;
  const GAP = 16;
  const NODE_W_RENDERED = 100;
  const NODE_H_RENDERED = 120; // rendered Azure node is icon + label, ~120px tall

  const measure = (n: AzureNode): { w: number; h: number } => {
    if (n.type === 'azureGroup') {
      const w =
        (typeof n.style?.width === 'number' ? n.style.width : undefined) ??
        n.width ??
        n.measured?.width ??
        300;
      const h =
        (typeof n.style?.height === 'number' ? n.style.height : undefined) ??
        n.height ??
        n.measured?.height ??
        200;
      return { w, h };
    }
    return { w: NODE_W_RENDERED, h: NODE_H_RENDERED };
  };

  const fitGroup = (groupId: string): void => {
    const group = byId.get(groupId);
    if (!group || group.type !== 'azureGroup') return;
    const kids = childrenById.get(groupId) ?? [];
    if (kids.length === 0) return;

    // Recurse depth-first so nested groups (vnet -> subnets) are sized
    // first; then we can pack them as fixed-size boxes.
    for (const k of kids) {
      if (k.type === 'azureGroup') fitGroup(k.id);
    }

    // Decoration nodes (NSG, Route Table) get pinned to a corner of
    // their parent group instead of flowing with the rest. Pull them
    // out of the layout flow now and re-position at the end.
    const isDecoration = (n: AzureNode): boolean => {
      const d = n.data as { binding?: { corner?: string }; typeKey?: string } | undefined;
      if (d?.binding?.corner) return true;
      const tk = d?.typeKey;
      return tk === 'nsg' || tk === 'route-table' || tk === 'route-tables';
    };
    const decorations = kids.filter(isDecoration);
    const flowKids = kids.filter((k) => !isDecoration(k));

    const groupKids = flowKids.filter((k) => k.type === 'azureGroup');
    const nodeKids = flowKids.filter((k) => k.type !== 'azureGroup');

    // VNets pack their subnets horizontally (subnets are usually 2-3
    // wide, so a single row reads cleanly).
    const isVNet = (group.data as { typeKey?: string } | undefined)?.typeKey === 'virtual-networks';

    if (isVNet || groupKids.length === 0) {
      // Single-row pack: groups first, then plain nodes wrapping into
      // rows below. Used by VNets (which only contain subnets + DNS
      // zone fallbacks) and by leaf groups (subnets) that contain only
      // plain nodes.
      let cursorX = SIDE_PAD;
      let cursorY = HEADER_PAD;
      let rowH = 0;

      const targetWidth = (() => {
        const total =
          groupKids.reduce((s, k) => s + measure(k).w + GAP, 0) +
          nodeKids.reduce((s, k) => s + measure(k).w + GAP, 0);
        const widest = kids.reduce((m, k) => Math.max(m, measure(k).w), 0);
        return Math.max(widest + SIDE_PAD * 2, Math.min(total + SIDE_PAD * 2, 1100));
      })();

      // Groups first.
      for (const k of groupKids) {
        const { w, h } = measure(k);
        if (cursorX + w > targetWidth - SIDE_PAD && cursorX > SIDE_PAD) {
          cursorX = SIDE_PAD;
          cursorY += rowH + GAP;
          rowH = 0;
        }
        k.position = { x: cursorX, y: cursorY };
        cursorX += w + GAP;
        rowH = Math.max(rowH, h);
      }
      if (groupKids.length > 0) {
        cursorX = SIDE_PAD;
        cursorY += rowH + GAP;
        rowH = 0;
      }
      // Plain nodes.
      for (const k of nodeKids) {
        const { w, h } = measure(k);
        if (cursorX + w > targetWidth - SIDE_PAD && cursorX > SIDE_PAD) {
          cursorX = SIDE_PAD;
          cursorY += rowH + GAP;
          rowH = 0;
        }
        k.position = { x: cursorX, y: cursorY };
        cursorX += w + GAP;
        rowH = Math.max(rowH, h);
      }
    } else {
      // Two-column layout for resource groups: plain nodes on the LEFT
      // wrapping into rows, network containers (vnet etc.) on the RIGHT
      // stacked vertically. This keeps PaaS resources adjacent to the
      // network they connect to without splitting the RG into "vnet on
      // top, everything else below" ribbons.
      const nodesPerCol = 4;
      const leftColCount = Math.min(nodesPerCol, Math.ceil(nodeKids.length / 2));
      const leftWidth =
        leftColCount > 0
          ? leftColCount * NODE_W_RENDERED + (leftColCount - 1) * GAP + SIDE_PAD * 2
          : SIDE_PAD * 2;

      // Place plain nodes in a left grid.
      let lx = SIDE_PAD;
      let ly = HEADER_PAD;
      let lRowH = 0;
      let col = 0;
      for (const k of nodeKids) {
        const { w, h } = measure(k);
        if (col >= leftColCount) {
          col = 0;
          lx = SIDE_PAD;
          ly += lRowH + GAP;
          lRowH = 0;
        }
        k.position = { x: lx, y: ly };
        lx += w + GAP;
        lRowH = Math.max(lRowH, h);
        col++;
      }
      const leftBottom = ly + lRowH;

      // Place network groups on the right, stacked.
      let ry = HEADER_PAD;
      const rightColLeft = leftWidth;
      let rightMaxRight = rightColLeft;
      for (const k of groupKids) {
        const { w, h } = measure(k);
        k.position = { x: rightColLeft, y: ry };
        ry += h + GAP;
        rightMaxRight = Math.max(rightMaxRight, rightColLeft + w);
      }
      const rightBottom = ry;
      void Math.max(leftBottom, rightBottom); // bottom is computed below
    }

    // Final group dimensions: enclose every flow child + side padding.
    // (Decorations are positioned AFTER sizing so they pin to a corner.)
    let maxRight = 0;
    let maxBottom = 0;
    for (const k of flowKids) {
      const { w, h } = measure(k);
      maxRight = Math.max(maxRight, (k.position?.x ?? 0) + w);
      maxBottom = Math.max(maxBottom, (k.position?.y ?? 0) + h);
    }
    // Reserve space at the bottom for decoration badges if any exist.
    // Badge nodes render at 32x32 (see .azure-node--bound CSS).
    const DECO_W = 32;
    const DECO_H = 32;
    const DECO_GAP = 8;
    let groupW = maxRight + SIDE_PAD;
    let groupH = maxBottom + SIDE_PAD;
    if (decorations.length > 0) {
      // Make sure the group is wide enough to fit all badges in a row
      // along the bottom-left corner.
      const decoRowWidth = decorations.length * (DECO_W + DECO_GAP);
      groupW = Math.max(groupW, decoRowWidth + SIDE_PAD * 2);
      groupH += DECO_H + DECO_GAP; // extra band for the badge row
    }
    group.style = {
      ...group.style,
      width: groupW,
      height: groupH,
    };

    // Pin decorations along the bottom-left of the just-sized group.
    let dx = SIDE_PAD;
    const dy = groupH - DECO_H - DECO_GAP;
    for (const d of decorations) {
      d.position = { x: dx, y: dy };
      dx += DECO_W + DECO_GAP;
    }
  };

  // Fit roots (which will recurse). Roots are top-level groups; we then
  // tile them horizontally on the canvas so they don't overlap.
  const rootGroups = laidOut.filter((n) => !n.parentId && n.type === 'azureGroup');
  let rootCursorX = 40;
  for (const r of rootGroups) {
    fitGroup(r.id);
    const { w } = measure(r);
    r.position = { x: rootCursorX, y: 40 };
    rootCursorX += w + 40;
  }
  return laidOut;
}
