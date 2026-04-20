import type { Node, Edge } from '@xyflow/react';

// PortAlignment mirrors Blazor.Diagrams PortAlignment
export enum PortAlignment {
  Top = 0,
  TopRight = 1,
  Right = 2,
  BottomRight = 3,
  Bottom = 4,
  BottomLeft = 5,
  Left = 6,
  TopLeft = 7,
}

// Data attached to each Azure resource node in the React Flow canvas
export interface AzureNodeData extends Record<string, unknown> {
  typeKey: string;
  imagePath: string;
  name: string;
  location: string;
  useResourceGroupLocation: boolean;
  isValid: boolean;
  // Resource-specific properties stored as a generic bag
  properties: Record<string, unknown>;
}

// The diagram graph DTO for save/load (matches C# DiagramGraph)
export interface DiagramGraph {
  groups: AzureNodeDto[];
  nodes: AzureNodeDto[];
  links: LinkModelDto[];
}

export interface AzureNodeDto {
  typeKey: string;
  imagePath: string;
  id: string;
  locked: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  groupId: string;
  name: string;
  location: string;
  useResourceGroupLocation: boolean;
  // Extra properties per resource type
  [key: string]: unknown;
}

export interface LinkModelDto {
  sourcePortParentId: string;
  sourcePortAlignment: PortAlignment;
  targetPortParentId: string;
  targetPortAlignment: PortAlignment;
}

// React Flow typed aliases
export type AzureNode = Node<AzureNodeData>;
export type AzureEdge = Edge;
