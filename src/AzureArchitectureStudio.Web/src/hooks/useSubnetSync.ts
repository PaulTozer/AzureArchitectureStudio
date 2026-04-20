/**
 * useSubnetSync — Synchronises VNet subnet properties → child group nodes.
 *
 * When a Virtual Network node's `properties.subnets` array changes, this hook
 * creates, updates, or removes corresponding child group nodes on the diagram
 * so they appear as grey-bordered containers inside the VNet.
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

/**
 * Derives a stable, deterministic child node ID from the VNet id + subnet
 * index so we can match existing nodes across renders.
 */
function subnetNodeId(vnetId: string, index: number): string {
  return `${vnetId}__subnet__${index}`;
}

export function useSubnetSync(
  nodes: AzureNode[],
  setNodes: React.Dispatch<React.SetStateAction<AzureNode[]>>,
) {
  // Track previous subnet state per VNet to avoid unnecessary updates
  const prevRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const nextFingerprints = new Map<string, string>();
    const vnetNodes = nodes.filter(
      (n) => n.type === 'azureGroup' && (n.data as AzureNodeData).typeKey === 'virtual-networks',
    );

    // Build fingerprints for current VNet subnet data
    for (const vnet of vnetNodes) {
      const data = vnet.data as AzureNodeData;
      const subnets = (data.properties?.subnets as SubnetEntry[] | undefined) ?? [];
      const fp = JSON.stringify(subnets.map((s) => ({ name: s.name, addressPrefix: s.addressPrefix })));
      nextFingerprints.set(vnet.id, fp);
    }

    // Check if anything changed
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
      // Also check for removed VNets
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
      // Collect all existing subnet child IDs
      const existingSubnetIds = new Set(
        currentNodes
          .filter((n) => (n.id as string).includes('__subnet__'))
          .map((n) => n.id),
      );

      // Desired subnet nodes
      const desiredSubnets: AzureNode[] = [];
      const desiredIds = new Set<string>();

      for (const vnet of vnetNodes) {
        const data = vnet.data as AzureNodeData;
        const subnets = (data.properties?.subnets as SubnetEntry[] | undefined) ?? [];

        // Compute layout: evenly space subnets inside VNet
        const vnetWidth = vnet.measured?.width ?? vnet.width ?? 250;
        const vnetHeight = vnet.measured?.height ?? vnet.height ?? 200;
        const headerHeight = 32; // group header area
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

          // Check if node already exists
          const existing = currentNodes.find((n) => n.id === id);
          const xPos = padding + i * (subnetWidth + 8);
          const yPos = headerHeight + padding;

          if (existing) {
            // Update data only, preserve user-adjusted position
            desiredSubnets.push({
              ...existing,
              data: {
                ...existing.data,
                name: subnet.name || `Subnet ${i + 1}`,
              },
            });
          } else {
            // Create new subnet child node
            desiredSubnets.push({
              id,
              type: 'azureGroup',
              position: { x: xPos, y: yPos },
              parentId: vnet.id,
              extent: 'parent',
              data: {
                typeKey: 'subnet',
                imagePath: SUBNET_ICON,
                name: subnet.name || `Subnet ${i + 1}`,
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

      // IDs to remove: existing subnet nodes not in desired set, and not
      // belonging to a VNet that still exists
      const idsToRemove = new Set<string>();
      for (const id of existingSubnetIds) {
        if (!desiredIds.has(id)) {
          idsToRemove.add(id);
        }
      }

      // Build final node array:
      // 1. Keep all non-subnet nodes as-is
      // 2. Replace/add desired subnet nodes
      // 3. Remove stale subnet nodes
      const nonSubnets = currentNodes.filter(
        (n) => !existingSubnetIds.has(n.id) && !idsToRemove.has(n.id),
      );

      // Ensure parent VNet nodes come before their subnet children
      const result = [...nonSubnets];
      for (const sn of desiredSubnets) {
        // Remove from result if already there (from nonSubnets)
        const idx = result.findIndex((n) => n.id === sn.id);
        if (idx >= 0) result.splice(idx, 1);
      }
      // Append subnets after their parents
      result.push(...desiredSubnets);

      return result;
    });
  }, [nodes, setNodes]);
}
