/**
 * useSubnetSync — Synchronises VNet `properties.subnets` → child group nodes.
 *
 * UNIDIRECTIONAL: The VNet's `properties.subnets` array is the source of
 * truth. Subnet child group nodes are pure VIEWS of that array. They never
 * write back to the VNet. To rename or change a subnet's address prefix,
 * edits must be routed via the parent VNet (see NodeEditDrawer's special
 * handling for subnet children).
 */

import { useEffect, useRef } from 'react';
import type { AzureNode, AzureNodeData } from '../models';

/** Subnet item as stored in the VNet's properties.subnets array */
interface SubnetEntry {
  name: string;
  addressPrefix?: string;
  [key: string]: unknown;
}

const SUBNET_ICON = 'assets/azure-icons/networking/02742-icon-service-Subnet.svg';
const SUBNET_ID_SEP = '__subnet__';

/**
 * Derives a stable, deterministic child node ID from the VNet id + subnet
 * index so we can match existing nodes across renders.
 */
export function subnetNodeId(vnetId: string, index: number): string {
  return `${vnetId}${SUBNET_ID_SEP}${index}`;
}

/**
 * Parse a subnet child id back into its parent VNet id and index, or null
 * if the id does not match the subnet child pattern.
 */
export function parseSubnetNodeId(id: string): { vnetId: string; index: number } | null {
  const idx = id.indexOf(SUBNET_ID_SEP);
  if (idx < 0) return null;
  const vnetId = id.slice(0, idx);
  const index = Number(id.slice(idx + SUBNET_ID_SEP.length));
  if (!Number.isFinite(index)) return null;
  return { vnetId, index };
}

export function useSubnetSync(
  nodes: AzureNode[],
  setNodes: React.Dispatch<React.SetStateAction<AzureNode[]>>,
) {
  // Fingerprint depends only on VNet props + dims. Children are pure
  // derivations, so they don't enter the fingerprint and can't trigger
  // a feedback loop.
  const prevRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const nextFingerprints = new Map<string, string>();
    const vnetNodes = nodes.filter(
      (n) => n.type === 'azureGroup' && (n.data as AzureNodeData).typeKey === 'virtual-networks',
    );

    for (const vnet of vnetNodes) {
      const data = vnet.data as AzureNodeData;
      const subnets = (data.properties?.subnets as SubnetEntry[] | undefined) ?? [];
      const fp = JSON.stringify(
        subnets.map((s) => ({ name: s.name, addressPrefix: s.addressPrefix })),
      );
      nextFingerprints.set(vnet.id, fp);
    }

    let changed = false;
    if (nextFingerprints.size !== prevRef.current.size) {
      changed = true;
    } else {
      for (const [id, fp] of nextFingerprints) {
        if (prevRef.current.get(id) !== fp) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        for (const id of prevRef.current.keys()) {
          if (!nextFingerprints.has(id)) {
            changed = true;
            break;
          }
        }
      }
    }

    if (!changed) return;
    prevRef.current = nextFingerprints;

    setNodes((currentNodes) => {
      const existingSubnetIds = new Set(
        currentNodes.filter((n) => parseSubnetNodeId(n.id)).map((n) => n.id),
      );

      const desiredSubnets: AzureNode[] = [];
      const desiredIds = new Set<string>();

      for (const vnet of vnetNodes) {
        const data = vnet.data as AzureNodeData;
        const subnets = (data.properties?.subnets as SubnetEntry[] | undefined) ?? [];

        const vnetWidth = vnet.measured?.width ?? vnet.width ?? 250;
        const vnetHeight = vnet.measured?.height ?? vnet.height ?? 200;
        const headerHeight = 32;
        const padding = 12;
        const subnetCount = subnets.length;
        const availableWidth = vnetWidth - padding * 2;
        const availableHeight = vnetHeight - headerHeight - padding * 2;
        const subnetWidth = subnetCount > 0
          ? Math.max(120, (availableWidth - (subnetCount - 1) * 8) / subnetCount)
          : 120;
        const subnetHeight = Math.max(80, availableHeight);

        for (let i = 0; i < subnets.length; i++) {
          const subnet = subnets[i];
          const id = subnetNodeId(vnet.id, i);
          desiredIds.add(id);

          const existing = currentNodes.find((n) => n.id === id);
          const xPos = padding + i * (subnetWidth + 8);
          const yPos = headerHeight + padding;
          const name = subnet.name || `Subnet ${i + 1}`;

          if (existing) {
            // Preserve user-adjusted position and size. Only the data
            // (name + addressPrefix) mirrors the parent VNet props.
            desiredSubnets.push({
              ...existing,
              data: {
                ...existing.data,
                name,
                properties: {
                  ...(existing.data as AzureNodeData).properties,
                  addressPrefix: subnet.addressPrefix ?? '',
                },
              },
            });
          } else {
            desiredSubnets.push({
              id,
              type: 'azureGroup',
              position: { x: xPos, y: yPos },
              parentId: vnet.id,
              extent: 'parent',
              data: {
                typeKey: 'subnet',
                imagePath: SUBNET_ICON,
                name,
                location: '',
                useResourceGroupLocation: true,
                isValid: true,
                properties: {
                  addressPrefix: subnet.addressPrefix ?? '',
                },
              } satisfies AzureNodeData,
              style: { width: subnetWidth, height: subnetHeight },
            });
          }
        }
      }

      const idsToRemove = new Set<string>();
      for (const id of existingSubnetIds) {
        if (!desiredIds.has(id)) idsToRemove.add(id);
      }

      const nonSubnets = currentNodes.filter(
        (n) => !existingSubnetIds.has(n.id) && !idsToRemove.has(n.id),
      );

      const merged: AzureNode[] = [...nonSubnets, ...desiredSubnets];

      // React Flow v12 requires parents before children in the array.
      const byId = new Map(merged.map((n) => [n.id, n] as const));
      const visited = new Set<string>();
      const ordered: AzureNode[] = [];
      const visit = (n: AzureNode) => {
        if (visited.has(n.id)) return;
        if (n.parentId && byId.has(n.parentId)) visit(byId.get(n.parentId)!);
        visited.add(n.id);
        ordered.push(n);
      };
      for (const n of merged) visit(n);

      return ordered;
    });
  }, [nodes, setNodes]);
}
