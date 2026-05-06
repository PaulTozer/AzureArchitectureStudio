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
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.spacing.nodeNode': '40',
  'elk.padding': '[top=56,left=24,right=24,bottom=24]',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.crossingMinimization.semiInteractive': 'true',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
} as const;

interface NodeBox {
  width: number;
  height: number;
}

function getNodeBox(n: AzureNode): NodeBox {
  if (n.type === 'azureGroup') {
    const w =
      (typeof n.style?.width === 'number' ? n.style.width : undefined) ??
      n.width ??
      n.measured?.width ??
      400;
    const h =
      (typeof n.style?.height === 'number' ? n.style.height : undefined) ??
      n.height ??
      n.measured?.height ??
      300;
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

  // Edges only get attached at the lowest common ancestor in elk; for our
  // graph we just attach them at root and let elk route across hierarchy.
  const elkEdges: ElkExtendedEdge[] = edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const buildElkNode = (n: AzureNode): ElkNode => {
    const box = getNodeBox(n);
    const kids = childrenByParent.get(n.id) ?? [];
    const node: ElkNode = {
      id: n.id,
      width: kids.length === 0 ? box.width : undefined,
      height: kids.length === 0 ? box.height : undefined,
      layoutOptions: kids.length > 0 ? { ...LAYOUT_OPTIONS } : undefined,
      children: kids.length > 0 ? kids.map(buildElkNode) : undefined,
    };
    return node;
  };

  const roots = childrenByParent.get('__root') ?? [];
  const elkGraph: ElkNode = {
    id: '__root',
    layoutOptions: { ...LAYOUT_OPTIONS, 'elk.direction': 'RIGHT' },
    children: roots.map(buildElkNode),
    edges: elkEdges,
  };

  const result = await elk.layout(elkGraph);

  // Walk the elk result building an id -> {x, y, width, height} index.
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const walk = (n: ElkNode) => {
    if (n.id !== '__root' && n.x !== undefined && n.y !== undefined) {
      positions.set(n.id, {
        x: n.x,
        y: n.y,
        width: n.width ?? 0,
        height: n.height ?? 0,
      });
    }
    n.children?.forEach(walk);
  };
  walk(result);

  // Apply the new positions back onto the original nodes.
  return nodes.map((n) => {
    const p = positions.get(n.id);
    if (!p) return n;
    const next: AzureNode = {
      ...n,
      position: { x: p.x, y: p.y },
    };
    if (n.type === 'azureGroup' && p.width > 0 && p.height > 0) {
      next.style = {
        ...n.style,
        width: p.width,
        height: p.height,
      };
    }
    return next;
  });
}
