/**
 * ARM resource → diagram node converter.
 *
 * Given a flat list of ARM resources from the management API, build the
 * React Flow nodes (and resource-group container nodes) needed to render
 * them on the canvas.
 */

import type { AzureNode, AzureNodeData, AzureEdge } from '../models';
import {
  getAllResourceTypes,
  getDefaultProperties,
  getArmTypeMap,
  isGroupType,
  getGroupStyle,
} from '../models';
import { resolveKey } from './resource-registry';
import type { AzureArmResource } from '../services/azure-mgmt';
import type { AzureServiceModel } from './stencil';

/** Stencil model duplicated minimally to avoid a wider import. */
export interface IconCatalogEntry {
  key: string;
  iconPath: string;
}

/**
 * Build a reverse lookup: lower-cased ARM type → curated resource-type key.
 *
 * Pulls from two sources:
 * 1. The curated `resource-types.json` registry (each entry's `armType`).
 * 2. The legacy `arm-type-map.json` mapping (service-key → ARM type),
 *    resolved through the alias map so it lands on a curated key when one
 *    exists.
 */
function buildArmTypeIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const def of getAllResourceTypes()) {
    if (!def.armType) continue;
    map.set(def.armType.toLowerCase(), def.key);
  }
  const legacy = getArmTypeMap();
  for (const [serviceKey, armType] of Object.entries(legacy)) {
    if (!armType) continue;
    const k = armType.toLowerCase();
    if (!map.has(k)) {
      map.set(k, resolveKey(serviceKey));
    }
  }
  return map;
}

/**
 * Build a reverse lookup: lower-cased ARM type → icon path.
 *
 * The catalog (azure-services.json) uses its own keying scheme that
 * doesn't always line up with the curated registry keys, so we go
 * through the legacy `arm-type-map.json` (catalog key → ARM type) to
 * produce a stable ARM-type-keyed index.
 */
function buildIconIndex(catalog: AzureServiceModel[] | IconCatalogEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  const armTypeMap = getArmTypeMap();
  // Pre-normalize: catalog-key (with --suffix stripped) → ARM type.
  const catalogKeyToArm = new Map<string, string>();
  for (const [serviceKey, armType] of Object.entries(armTypeMap)) {
    if (armType) catalogKeyToArm.set(serviceKey.toLowerCase(), armType.toLowerCase());
  }
  for (const item of catalog) {
    const stripped = item.key.replace(/--.*$/, '').toLowerCase();
    const armType = catalogKeyToArm.get(stripped);
    if (armType && !map.has(armType)) {
      map.set(armType, item.iconPath);
    }
  }
  // Also fold in icons supplied directly by the curated registry by
  // matching on shared catalog-key, so that resource types whose ARM type
  // isn’t in the legacy map can still pick up an icon by service key.
  for (const def of getAllResourceTypes()) {
    if (!def.armType) continue;
    const t = def.armType.toLowerCase();
    if (map.has(t)) continue;
    // Try a few catalog-name guesses derived from the registry key.
    const guesses = [def.key, `${def.key}s`, def.key.replace(/-/g, '')];
    for (const g of guesses) {
      const hit = catalog.find((c) => c.key.replace(/--.*$/, '').toLowerCase() === g.toLowerCase());
      if (hit) {
        map.set(t, hit.iconPath);
        break;
      }
    }
  }
  return map;
}

/** Resource-group icon lookup (kept handy because RGs aren’t ARM-typed in the input). */
function lookupResourceGroupIcon(catalog: AzureServiceModel[] | IconCatalogEntry[]): string {
  return (
    catalog.find((c) => c.key === 'resource-groups')?.iconPath ??
    catalog.find((c) => c.key === 'resource-group')?.iconPath ??
    ''
  );
}

/** Parse the parent resource-group name out of an ARM resource id. */
export function getResourceGroupName(armId: string): string | undefined {
  const m = /\/resourceGroups\/([^/]+)/i.exec(armId);
  return m?.[1];
}

/** Parse the subscription guid out of an ARM resource id. */
export function getSubscriptionId(armId: string): string | undefined {
  const m = /\/subscriptions\/([^/]+)/i.exec(armId);
  return m?.[1];
}

export interface ArmImportResult {
  nodes: AzureNode[];
  /** Edges inferred from ARM resource cross-references. */
  edges: AzureEdge[];
  /** ARM types we couldn't map to a known resource type. */
  unknown: Array<{ type: string; count: number }>;
  /** Total resources processed (including unknown). */
  total: number;
  /** Number of resources successfully imported as nodes. */
  imported: number;
}

interface BuildOptions {
  /** Catalog used to look up icon paths for nodes. */
  iconCatalog: AzureServiceModel[] | IconCatalogEntry[];
  /** Optional layout origin on the canvas. Defaults to (40, 40). */
  origin?: { x: number; y: number };
}

const RG_WIDTH = 480;
const RG_HEIGHT = 360;
const RG_GAP_X = 40;
const RG_GAP_Y = 40;
const RG_HEADER_PAD = 56;
const NODE_W = 80;
const NODE_H = 90;
const NODE_GAP = 16;

/**
 * Convert a flat array of ARM resources into diagram nodes, automatically
 * creating resource-group group nodes that contain the discovered resources.
 *
 * Resources whose ARM type isn't in the curated registry are skipped.
 */
export function buildNodesFromArmResources(
  resources: AzureArmResource[],
  opts: BuildOptions,
): ArmImportResult {
  const armIndex = buildArmTypeIndex();
  const iconIndex = buildIconIndex(opts.iconCatalog);
  const origin = opts.origin ?? { x: 40, y: 40 };
  // eslint-disable-next-line no-console
  console.debug(
    `[arm-import] armIndex=${armIndex.size} iconIndex=${iconIndex.size} resources=${resources.length}`,
  );

  // Track unknowns for reporting.
  const unknownCounts = new Map<string, number>();

  // Group input by resource group. ARM treats RG names case-insensitively
  // (the same RG can be returned with different casing across resource ids),
  // so group by the lowercase key but display the first casing we see.
  const groups = new Map<string, { displayName: string; items: AzureArmResource[] }>();
  for (const r of resources) {
    const raw = getResourceGroupName(r.id) ?? '(no resource group)';
    const key = raw.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(r);
    } else {
      groups.set(key, { displayName: raw, items: [r] });
    }
  }

  const out: AzureNode[] = [];
  // armId (lowercased) -> nodeId, used to resolve cross-references after
  // every node has been created.
  const armIdToNodeId = new Map<string, string>();
  let rgIdSeq = 0;
  let nodeIdSeq = 0;
  let col = 0;
  const cols = 2;
  const importStamp = Date.now();

  for (const [, group] of groups) {
    const rgName = group.displayName;
    const items = group.items;
    const rgIndex = rgIdSeq++;
    const rgX = origin.x + (col % cols) * (RG_WIDTH + RG_GAP_X);
    const rgY = origin.y + Math.floor(col / cols) * (RG_HEIGHT + RG_GAP_Y);
    col++;

    const rgId = `imp-rg-${importStamp}-${rgIndex}`;
    const rgIcon = lookupResourceGroupIcon(opts.iconCatalog);
    const rgNode: AzureNode = {
      id: rgId,
      type: 'azureGroup',
      position: { x: rgX, y: rgY },
      data: {
        typeKey: 'resource-group',
        imagePath: rgIcon,
        name: rgName,
        location: '',
        useResourceGroupLocation: true,
        isValid: true,
        properties: { ...getDefaultProperties('resource-group') },
      } satisfies AzureNodeData,
      style: { width: RG_WIDTH, height: RG_HEIGHT },
    } as AzureNode;
    out.push(rgNode);

    // Lay children inside the RG in a wrapping grid.
    const childCols = Math.max(1, Math.floor((RG_WIDTH - 24) / (NODE_W + NODE_GAP)));
    let childIdx = 0;
    let imported = 0;
    for (const r of items) {
      const armType = r.type.toLowerCase();
      const typeKey = armIndex.get(armType);
      if (!typeKey) {
        unknownCounts.set(r.type, (unknownCounts.get(r.type) ?? 0) + 1);
        continue;
      }
      const cx = childIdx % childCols;
      const cy = Math.floor(childIdx / childCols);
      const px = 12 + cx * (NODE_W + NODE_GAP);
      const py = RG_HEADER_PAD + cy * (NODE_H + NODE_GAP);

      const icon = iconIndex.get(armType) ?? '';
      const nodeId = `imp-node-${importStamp}-${rgIndex}-${nodeIdSeq++}`;
      armIdToNodeId.set(r.id.toLowerCase(), nodeId);
      const isGroup = isGroupType(typeKey);
      const groupDims = isGroup ? getGroupStyle(typeKey) : undefined;

      // Carry over interesting ARM properties so downstream syncs (e.g.
      // VNet → subnet child generation) can populate the diagram fully.
      const importedProps: Record<string, unknown> = {
        ...getDefaultProperties(typeKey),
      };
      if (isGroup && typeKey === 'virtual-networks' && r.properties) {
        const subs = (r.properties as { subnets?: Array<Record<string, unknown>> }).subnets;
        if (Array.isArray(subs)) {
          importedProps.subnets = subs.map((s) => ({
            name: (s.name as string) ?? '',
            addressPrefix:
              ((s.properties as Record<string, unknown> | undefined)?.addressPrefix as string) ??
              (s.addressPrefix as string) ??
              '',
          }));
        }
        const space = (r.properties as { addressSpace?: { addressPrefixes?: string[] } })
          .addressSpace?.addressPrefixes;
        if (Array.isArray(space) && space.length > 0) {
          importedProps.addressSpace = space.join(', ');
        }
      }

      out.push({
        id: nodeId,
        type: isGroup ? 'azureGroup' : 'azureNode',
        position: { x: px, y: py },
        parentId: rgId,
        data: {
          typeKey,
          imagePath: icon,
          name: r.name,
          location: r.location ?? '',
          useResourceGroupLocation: true,
          isValid: true,
          properties: importedProps,
        } satisfies AzureNodeData,
        ...(isGroup && groupDims
          ? { style: { width: groupDims.width, height: groupDims.height } }
          : {}),
      } as AzureNode);
      imported++;
      childIdx++;
    }

    // Auto-grow RG height if more children than fit in the default size.
    const neededRows = Math.ceil(Math.max(1, imported) / childCols);
    const neededHeight = RG_HEADER_PAD + neededRows * (NODE_H + NODE_GAP) + 12;
    if (neededHeight > RG_HEIGHT) {
      rgNode.style = { ...rgNode.style, height: neededHeight };
    }
  }

  // Infer edges from ARM cross-references in resource properties.
  const edges = inferEdges(resources, armIdToNodeId, importStamp);

  const unknown = Array.from(unknownCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return {
    nodes: out,
    edges,
    unknown,
    total: resources.length,
    // Count every imported resource (groups + nodes), excluding the
    // synthesised resource-group containers we created up-front.
    imported: out.filter((n) => !n.id.startsWith(`imp-rg-${importStamp}`)).length,
  };
}

/**
 * Walk every string-valued property in the source resources looking for
 * fully-qualified ARM resource IDs (`/subscriptions/.../providers/...`).
 * If both the owning resource and the referenced resource were imported,
 * emit an edge between their nodes.
 */
function inferEdges(
  resources: AzureArmResource[],
  armIdToNodeId: Map<string, string>,
  importStamp: number,
): AzureEdge[] {
  const edges: AzureEdge[] = [];
  const seen = new Set<string>();
  let edgeSeq = 0;

  // Build a lookup from Log Analytics workspace customerId GUID -> nodeId.
  // Some Azure resources (notably Container Apps environments and
  // diagnostic settings) reference workspaces by their `customerId` GUID
  // rather than their full ARM ID, so a plain ARM-ID scan misses them.
  const customerIdToNodeId = new Map<string, string>();
  for (const r of resources) {
    if (r.type.toLowerCase() !== 'microsoft.operationalinsights/workspaces') continue;
    const cid = (r.properties as { customerId?: string } | undefined)?.customerId;
    if (!cid) continue;
    const nodeId = armIdToNodeId.get(r.id.toLowerCase());
    if (nodeId) customerIdToNodeId.set(cid.toLowerCase(), nodeId);
  }

  const pushEdge = (source: string, target: string) => {
    if (source === target) return;
    const key = `${source}->${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      id: `imp-edge-${importStamp}-${edgeSeq++}`,
      source,
      target,
      type: 'deletable',
    });
  };

  for (const r of resources) {
    const sourceId = armIdToNodeId.get(r.id.toLowerCase());
    if (!sourceId) continue;

    // 0. Child-resource → parent-resource link. A vnet-link belongs to a
    //    private DNS zone, a NIC ipConfig.privateLinkConnectionProperties
    //    belongs to its endpoint, etc. Whenever the resource id itself
    //    contains another imported resource further up the chain, draw
    //    an edge to that parent.
    for (const parent of parentArmIds(r.id.toLowerCase())) {
      const hit = armIdToNodeId.get(parent);
      if (hit) pushEdge(sourceId, hit);
    }

    if (!r.properties) continue;

    // 1. Direct ARM-ID references anywhere in properties.
    const refs = collectArmIdReferences(r.properties);
    for (const ref of refs) {
      const refLower = ref.toLowerCase();
      if (refLower === r.id.toLowerCase()) continue;
      let targetId = armIdToNodeId.get(refLower);
      // If the literal reference isn't an imported resource, try walking up
      // the parent chain — child resources (subnets, vnet links, etc.) are
      // returned in the listing as part of their root resource.
      if (!targetId) {
        for (const parent of parentArmIds(refLower)) {
          if (parent === r.id.toLowerCase()) continue;
          const hit = armIdToNodeId.get(parent);
          if (hit) {
            targetId = hit;
            break;
          }
        }
      }
      if (targetId) pushEdge(sourceId, targetId);
    }

    // 2. Workspace customerId references (Log Analytics).
    const customerIds = collectCustomerIdReferences(r.properties);
    for (const cid of customerIds) {
      const targetId = customerIdToNodeId.get(cid.toLowerCase());
      if (targetId) pushEdge(sourceId, targetId);
    }
  }
  return edges;
}

/**
 * Yield the chain of root ARM IDs above a child ARM resource ID.
 * For `/subscriptions/x/resourceGroups/y/providers/Microsoft.Network/virtualNetworks/foo/subnets/bar`
 * yields `/subscriptions/x/resourceGroups/y/providers/Microsoft.Network/virtualNetworks/foo`.
 *
 * We trim two segments at a time (childType/childName), stopping once we
 * hit the root resource (one type/name pair after `providers/{ns}`).
 */
function* parentArmIds(armId: string): Generator<string> {
  const ix = armId.indexOf('/providers/');
  if (ix < 0) return;
  const head = armId.slice(0, ix + '/providers/'.length); // includes trailing slash
  const tail = armId.slice(ix + '/providers/'.length);
  const parts = tail.split('/');
  // Need at least: namespace, type, name (3 segments) for a root resource.
  // Each child adds another type/name pair.
  if (parts.length < 5) return;
  // Drop child type/name pairs from the right while we still have a root.
  let cur = parts.slice();
  while (cur.length >= 5) {
    cur = cur.slice(0, cur.length - 2);
    yield head + cur.join('/');
  }
}

/** ARM resource IDs always start with `/subscriptions/{guid}/`. */
const ARM_ID_RE = /\/subscriptions\/[0-9a-f-]{36}\/[^"'\s]+/gi;

/** A bare GUID (lowercase or upper). */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recursively gather every ARM resource ID found in a JSON-shaped value. */
function collectArmIdReferences(value: unknown, out: string[] = []): string[] {
  if (value == null) return out;
  if (typeof value === 'string') {
    const matches = value.match(ARM_ID_RE);
    if (matches) {
      for (const m of matches) {
        out.push(m.replace(/[),;]+$/, ''));
      }
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectArmIdReferences(v, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectArmIdReferences(v, out);
    }
  }
  return out;
}

/**
 * Look for properties named `customerId` (anywhere in the tree) whose
 * value is a bare GUID. These point at Log Analytics workspaces.
 */
function collectCustomerIdReferences(value: unknown, out: string[] = []): string[] {
  if (value == null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const v of value) collectCustomerIdReferences(v, out);
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'customerId' && typeof v === 'string' && GUID_RE.test(v)) {
      out.push(v);
    } else if (v && typeof v === 'object') {
      collectCustomerIdReferences(v, out);
    }
  }
  return out;
}
