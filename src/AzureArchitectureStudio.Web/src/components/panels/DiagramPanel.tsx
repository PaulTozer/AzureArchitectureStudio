import { useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type NodeTypes,
  type OnConnect,
  type ReactFlowInstance,
  type NodeChange,
  type EdgeChange,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Button,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
} from '@fluentui/react-components';
import { EditRegular, DeleteRegular, PinRegular, PinOffRegular } from '@fluentui/react-icons';
import { useAppContext } from '../../context/AppContext';
import {
  type AzureNodeData,
  type AzureNode,
  type AzureEdge,
  isGroupType,
  getGroupStyle,
  getDefaultProperties,
  getDisplayName,
} from '../../models';
import AzureNodeComponent from '../nodes/AzureNode';
import AzureGroupComponent from '../nodes/AzureGroup';
import NodeEditDrawer from '../drawers/NodeEditDrawer';
import { useSubnetSync } from '../../hooks/useSubnetSync';
import { useBindingSync, canBind, cornerPosition, nextCorner } from '../../hooks/useBindingSync';
import type { AzureNodeData as AzureNodeDataType, BindingCorner } from '../../models';
import './DiagramPanel.css';

const nodeTypes: NodeTypes = {
  azureNode: AzureNodeComponent,
  azureGroup: AzureGroupComponent,
};

let nodeIdCounter = 0;

export default function DiagramPanel() {
  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    stencils,
    azureServices,
    draggedStencilKey,
    selectedNodeId,
    setSelectedNodeId,
  } = useAppContext();

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useRef<ReactFlowInstance<AzureNode, AzureEdge> | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sync VNet subnet properties → child group nodes on the diagram
  useSubnetSync(nodes, setNodes);

  // Keep bound nodes anchored to their corner on parent resize
  useBindingSync(nodes, setNodes);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds) as AzureNode[]);
    },
    [setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges]
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: false,
            style: { stroke: '#0078d4', strokeWidth: 1 },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const stencilKey =
        event.dataTransfer.getData('application/azure-stencil') ||
        draggedStencilKey;
      if (!stencilKey) return;

      // Look up the dropped item from either legacy stencils or new service catalog
      const legacyStencil = stencils.find((s) => s.key === stencilKey);
      const service = azureServices.find((s) => s.key === stencilKey);
      const iconPath = legacyStencil?.iconPath
        ?? event.dataTransfer.getData('application/azure-stencil-icon')
        ?? service?.iconPath
        ?? '';
      const displayName = legacyStencil?.name
        ?? event.dataTransfer.getData('application/azure-stencil-name')
        ?? service?.name
        ?? getDisplayName(stencilKey);

      if (!iconPath && !legacyStencil && !service) return;

      const position = reactFlowInstance.current?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      if (!position) return;

      const isGroup = isGroupType(stencilKey);
      const groupDims = getGroupStyle(stencilKey);
      const defaultProps = getDefaultProperties(stencilKey);

      // Default: absolute position; will be made relative if inside a group
      let nodePosition = { ...position };

      // Find the smallest group node that contains the drop position
      // (smallest = most deeply nested, i.e. drop into subnet before vnet)
      // screenToFlowPosition returns absolute coordinates, so we need absolute
      // node positions for the hit test.
      let parentGroup: AzureNode | undefined;
      const currentNodes = reactFlowInstance.current?.getNodes() as AzureNode[] | undefined;
      if (currentNodes) {
        // Build a lookup for absolute positions
        const absPos = new Map<string, { x: number; y: number }>();
        for (const n of currentNodes) {
          const px = n.parentId ? absPos.get(n.parentId) : undefined;
          absPos.set(n.id, {
            x: n.position.x + (px?.x ?? 0),
            y: n.position.y + (px?.y ?? 0),
          });
        }

        const candidateGroups = currentNodes.filter((n) => {
          if (n.type !== 'azureGroup') return false;
          const w = (n.measured?.width ?? n.width ?? 0);
          const h = (n.measured?.height ?? n.height ?? 0);
          const ap = absPos.get(n.id)!;
          return (
            position.x >= ap.x &&
            position.x <= ap.x + w &&
            position.y >= ap.y &&
            position.y <= ap.y + h
          );
        });
        // Pick the smallest group (most specific container)
        if (candidateGroups.length > 0) {
          parentGroup = candidateGroups.reduce((smallest, g) => {
            const sArea = (smallest.measured?.width ?? smallest.width ?? 0) * (smallest.measured?.height ?? smallest.height ?? 0);
            const gArea = (g.measured?.width ?? g.width ?? 0) * (g.measured?.height ?? g.height ?? 0);
            return gArea < sArea ? g : smallest;
          });
        }

        // Compute position relative to parent if nested
        if (parentGroup) {
          const parentAbs = absPos.get(parentGroup.id)!;
          nodePosition = {
            x: position.x - parentAbs.x,
            y: position.y - parentAbs.y,
          };
        }
      }

      const newNode: AzureNode = {
        id: `azure-${++nodeIdCounter}-${Date.now()}`,
        type: isGroup ? 'azureGroup' : 'azureNode',
        position: nodePosition,
        data: {
          typeKey: stencilKey,
          imagePath: iconPath,
          name: displayName,
          location: '',
          useResourceGroupLocation: true,
          isValid: true,
          properties: defaultProps,
        } satisfies AzureNodeData,
        ...(parentGroup ? { parentId: parentGroup.id, extent: 'parent' as const } : {}),
        ...(isGroup && groupDims
          ? { style: { width: groupDims.width, height: groupDims.height } }
          : {}),
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [draggedStencilKey, stencils, azureServices, setNodes]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  // Determine if the selected node can be bound / is already bound
  const selectedData = selectedNode?.data as AzureNodeDataType | undefined;
  const parentNode = selectedNode?.parentId
    ? nodes.find((n) => n.id === selectedNode.parentId)
    : undefined;
  const parentData = parentNode?.data as AzureNodeDataType | undefined;
  const showBind =
    selectedData &&
    parentData &&
    !selectedData.binding &&
    canBind(selectedData.typeKey, parentData.typeKey);
  const showUnbind = !!selectedData?.binding;

  const handleBind = useCallback(
    (corner: BindingCorner = 'bottom-left') => {
      if (!selectedNodeId || !parentNode) return;
      const parentW =
        parentNode.measured?.width ??
        parentNode.width ??
        (parentNode.style?.width as number | undefined) ??
        250;
      const parentH =
        parentNode.measured?.height ??
        parentNode.height ??
        (parentNode.style?.height as number | undefined) ??
        200;
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== selectedNodeId) return n;
          const nodeW = n.measured?.width ?? n.width ?? 80;
          const nodeH = n.measured?.height ?? n.height ?? 80;
          const pos = cornerPosition(corner, parentW, parentH, nodeW, nodeH);
          return {
            ...n,
            position: pos,
            data: { ...n.data, binding: { corner } },
          };
        }),
      );
    },
    [selectedNodeId, parentNode, setNodes],
  );

  const handleUnbind = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedNodeId) return n;
        const { binding: _, ...rest } = n.data as AzureNodeDataType;
        return { ...n, data: rest as AzureNodeDataType };
      }),
    );
  }, [selectedNodeId, setNodes]);

  const handleCycleCorner = useCallback(() => {
    if (!selectedNodeId || !selectedData?.binding) return;
    handleBind(nextCorner(selectedData.binding.corner));
  }, [selectedNodeId, selectedData, handleBind]);

  const handleDelete = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) =>
      eds.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
      )
    );
    setSelectedNodeId(null);
    setDeleteConfirmOpen(false);
  }, [selectedNodeId, setNodes, setEdges, setSelectedNodeId]);

  return (
    <div className="diagram-panel" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onInit={(instance) => {
          reactFlowInstance.current = instance;
        }}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode={null} // Disable default delete — use our confirm dialog
        minZoom={0.5}
        multiSelectionKeyCode="Control"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap
          nodeStrokeColor="#0078d4"
          nodeColor="#e1dfdd"
          maskColor="rgba(0,0,0,0.1)"
        />
      </ReactFlow>

      {/* Context toolbar */}
      {selectedNodeId && (
        <div className="diagram-context-toolbar">
          <Button
            appearance="subtle"
            icon={<EditRegular />}
            size="small"
            onClick={() => setDrawerOpen(true)}
          >
            Edit
          </Button>
          {showBind && (
            <Button
              appearance="subtle"
              icon={<PinRegular />}
              size="small"
              onClick={() => handleBind('bottom-left')}
              title="Bind to corner of parent group"
            >
              Bind
            </Button>
          )}
          {showUnbind && (
            <>
              <Button
                appearance="subtle"
                icon={<PinRegular />}
                size="small"
                onClick={handleCycleCorner}
                title={`Move to next corner (currently ${selectedData?.binding?.corner})`}
              >
                {selectedData?.binding?.corner}
              </Button>
              <Button
                appearance="subtle"
                icon={<PinOffRegular />}
                size="small"
                onClick={handleUnbind}
                title="Unbind from corner"
              >
                Unbind
              </Button>
            </>
          )}
          <Dialog
            open={deleteConfirmOpen}
            onOpenChange={(_, d) => setDeleteConfirmOpen(d.open)}
          >
            <DialogTrigger disableButtonEnhancement>
              <Button
                appearance="subtle"
                icon={<DeleteRegular />}
                size="small"
              >
                Delete
              </Button>
            </DialogTrigger>
            <DialogSurface>
              <DialogBody>
                <DialogTitle>Delete the selected node?</DialogTitle>
                <DialogContent>
                  The node will be deleted and there is no way to revert back.
                </DialogContent>
                <DialogActions>
                  <DialogTrigger disableButtonEnhancement>
                    <Button appearance="secondary">Cancel</Button>
                  </DialogTrigger>
                  <Button appearance="primary" onClick={handleDelete}>
                    Delete
                  </Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </div>
      )}

      {/* Edit drawer */}
      {drawerOpen && selectedNode && (
        <NodeEditDrawer
          node={selectedNode}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
