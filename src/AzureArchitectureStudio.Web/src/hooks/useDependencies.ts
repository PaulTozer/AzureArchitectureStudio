/**
 * Dependency resolution for AzureNode resources.
 *
 * A dependency is "fulfilled" when:
 *   - autoFromParent is true and the node has a parent of the matching targetType, OR
 *   - the node has an edge connected to a node of the matching targetType, OR
 *   - the node's properties[dep.key] holds a non-empty value.
 */

import type { AzureEdge, AzureNode, AzureNodeData, ResourceDependencyDef, ResourceTypeDefinition } from '../models';
import { getResourceType } from '../models';

export interface DependencyStatus {
  dep: ResourceDependencyDef;
  fulfilled: boolean;
  source?: 'parent' | 'edge' | 'property';
  resolvedNodeId?: string;
}

/** Return the registered typeKey of a node (resolved through alias map). */
function nodeTypeKey(n: AzureNode): string {
  return (n.data as AzureNodeData).typeKey;
}

/** Test whether a node matches the target type (uses registry resolution). */
function matchesType(node: AzureNode, targetType: string): boolean {
  const tk = nodeTypeKey(node);
  if (tk === targetType) return true;
  // Resolve through registry: target may be a curated key while node uses a stencil key
  const def = getResourceType(tk);
  return def?.key === targetType;
}

export function evaluateDependencies(
  node: AzureNode,
  allNodes: AzureNode[],
  edges: AzureEdge[],
): DependencyStatus[] {
  const def = getResourceType((node.data as AzureNodeData).typeKey);
  const deps = def?.dependencies ?? [];
  if (deps.length === 0) return [];

  const data = node.data as AzureNodeData;
  const results: DependencyStatus[] = [];

  for (const dep of deps) {
    let fulfilled = false;
    let source: DependencyStatus['source'] | undefined;
    let resolvedNodeId: string | undefined;

    // 1. autoFromParent
    if (dep.autoFromParent && node.parentId) {
      const parent = allNodes.find((n) => n.id === node.parentId);
      if (parent && matchesType(parent, dep.targetType)) {
        fulfilled = true;
        source = 'parent';
        resolvedNodeId = parent.id;
      }
    }

    // 2. Edge-connected resource
    if (!fulfilled) {
      const connectedIds = new Set<string>();
      for (const e of edges) {
        if (e.source === node.id) connectedIds.add(e.target);
        if (e.target === node.id) connectedIds.add(e.source);
      }
      const match = allNodes.find((n) => connectedIds.has(n.id) && matchesType(n, dep.targetType));
      if (match) {
        fulfilled = true;
        source = 'edge';
        resolvedNodeId = match.id;
      }
    }

    // 3. Explicit property reference
    if (!fulfilled) {
      const v = data.properties?.[dep.key];
      if (typeof v === 'string' && v.trim() !== '') {
        fulfilled = true;
        source = 'property';
      }
    }

    results.push({ dep, fulfilled, source, resolvedNodeId });
  }

  return results;
}

/** True if any required dependency is unfulfilled. */
export function hasUnfulfilledRequired(statuses: DependencyStatus[]): boolean {
  return statuses.some((s) => s.dep.required && !s.fulfilled);
}

export type { ResourceTypeDefinition };
