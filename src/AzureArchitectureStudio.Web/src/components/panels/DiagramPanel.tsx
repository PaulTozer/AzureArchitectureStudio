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
import { EditRegular, DeleteRegular } from '@fluentui/react-icons';
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

      const newNode = {
        id: `azure-${++nodeIdCounter}-${Date.now()}`,
        type: isGroup ? 'azureGroup' : 'azureNode',
        position,
        data: {
          typeKey: stencilKey,
          imagePath: iconPath,
          name: displayName,
          location: '',
          useResourceGroupLocation: true,
          isValid: true,
          properties: defaultProps,
        } satisfies AzureNodeData,
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
