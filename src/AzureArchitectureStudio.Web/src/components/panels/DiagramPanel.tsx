import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
  type OnConnect,
  type ReactFlowInstance,
  type NodeChange,
  type EdgeChange,
  BackgroundVariant,
  ConnectionMode,
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
import {
  EditRegular,
  DeleteRegular,
  PinRegular,
  PinOffRegular,
  ArrowUpRegular,
  ArrowDownRegular,
} from '@fluentui/react-icons';
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
import DeletableEdge from '../edges/DeletableEdge';
import '../edges/DeletableEdge.css';
import NodeEditDrawer from '../drawers/NodeEditDrawer';
import { useSubnetSync } from '../../hooks/useSubnetSync';
import { useBindingSync, cornerPosition, nextCorner } from '../../hooks/useBindingSync';
import { useDependencyValidationSync } from '../../hooks/useDependencyValidationSync';
import { useEdgeRouting } from '../../hooks/useEdgeRouting';
import type { AzureNodeData as AzureNodeDataType, BindingCorner } from '../../models';
import { checkConnection } from '../../utils/connection-rules';
import './DiagramPanel.css';

const nodeTypes: NodeTypes = {
  azureNode: AzureNodeComponent,
  azureGroup: AzureGroupComponent,
};

const edgeTypes: EdgeTypes = {
  deletable: DeletableEdge,
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

  // Recompute node validity from required-dependency fulfilment
  useDependencyValidationSync(nodes, edges, setNodes);

  // Pick the shortest available handle pair for each edge so connections
  // don't loop around nodes when a closer side is available.
  useEdgeRouting(nodes, edges, setEdges);

  // Ensure every edge uses our custom deletable renderer so the × button
  // shows on saved / imported edges as well as new ones.
  const displayEdges = useMemo(
    () => edges.map((e) => (e.type === 'deletable' ? e : { ...e, type: 'deletable' })),
    [edges],
  );

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

  // Lookup the resource typeKey for a node id from the latest nodes ref.
  const getNodeTypeKey = useCallback(
    (nodeId: string | null | undefined): string | undefined => {
      if (!nodeId) return undefined;
      const list = (reactFlowInstance.current?.getNodes() as AzureNode[] | undefined) ?? nodes;
      const found = list.find((n) => n.id === nodeId);
      return (found?.data as AzureNodeData | undefined)?.typeKey;
    },
    [nodes]
  );

  const validateConnection = useCallback(
    (conn: Connection | Edge) => {
      const sourceType = getNodeTypeKey(conn.source ?? null);
      const targetType = getNodeTypeKey(conn.target ?? null);
      return checkConnection(sourceType, targetType);
    },
    [getNodeTypeKey]
  );

  // Lightweight notification: dispatches a window event that a host (e.g.
  // TopMenu's Toaster) can listen for. Falls back to console only.
  const notify = useCallback((message: string) => {
    try {
      window.dispatchEvent(
        new CustomEvent('aas:notify', { detail: { message, intent: 'warning' } }),
      );
    } catch {
      /* no-op */
    }
  }, []);

  const isValidConnectionFn = useCallback(
    (conn: Edge | Connection) => validateConnection(conn).allowed,
    [validateConnection]
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      // eslint-disable-next-line no-console
      console.log('[DiagramPanel] onConnect fired', connection);
      if (connection.source === connection.target) return;
      const check = validateConnection(connection);
      if (!check.allowed) {
        // eslint-disable-next-line no-console
        console.warn('[DiagramPanel] connection blocked:', check.reason);
        notify(check.reason ?? 'Connection not allowed.');
        return;
      }
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'deletable',
            animated: false,
            style: { stroke: '#0078d4', strokeWidth: 1 },
          },
          eds
        )
      );
    },
    [setEdges, validateConnection, notify]
  );

  // Track whether an ongoing reconnect actually dropped onto a valid target.
  // If not, we remove the edge entirely.
  const edgeReconnectSuccessful = useRef(true);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (newConnection.source === newConnection.target) return;
      const check = validateConnection(newConnection);
      if (!check.allowed) {
        // eslint-disable-next-line no-console
        console.warn('[DiagramPanel] reconnect blocked:', check.reason);
        notify(check.reason ?? 'Connection not allowed.');
        return;
      }
      edgeReconnectSuccessful.current = true;
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
    },
    [setEdges, validateConnection, notify]
  );

  const onReconnectEnd = useCallback(
    (_: unknown, edge: Edge) => {
      if (!edgeReconnectSuccessful.current) {
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      }
      edgeReconnectSuccessful.current = true;
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
        ...(parentGroup
          ? {
              parentId: parentGroup.id,
              // Group children stay constrained; leaf nodes can be dragged
              // out to be re-parented into another group.
              ...(isGroup ? { extent: 'parent' as const } : {}),
            }
          : {}),
        ...(isGroup && groupDims
          ? { style: { width: groupDims.width, height: groupDims.height } }
          : {}),
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [draggedStencilKey, stencils, azureServices, setNodes]
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: { id: string }) => {
      // Alt/Option-click — cycle selection through nodes stacked at this point
      // (useful when a leaf icon is hidden underneath another).
      if (event.altKey && reactFlowInstance.current) {
        const flowPos = reactFlowInstance.current.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        // Build absolute positions
        const absPos = new Map<string, { x: number; y: number }>();
        for (const n of nodes) {
          const px = n.parentId ? absPos.get(n.parentId) : undefined;
          absPos.set(n.id, {
            x: n.position.x + (px?.x ?? 0),
            y: n.position.y + (px?.y ?? 0),
          });
        }
        const hits = nodes.filter((n) => {
          if (n.type === 'azureGroup') return false;
          const ap = absPos.get(n.id)!;
          const w = n.measured?.width ?? (n.width as number) ?? 60;
          const h = n.measured?.height ?? (n.height as number) ?? 60;
          return (
            flowPos.x >= ap.x &&
            flowPos.x <= ap.x + w &&
            flowPos.y >= ap.y &&
            flowPos.y <= ap.y + h
          );
        });
        if (hits.length > 0) {
          const idx = hits.findIndex((n) => n.id === selectedNodeId);
          const next = hits[(idx + 1) % hits.length];
          setSelectedNodeId(next.id);
          return;
        }
      }
      setSelectedNodeId(node.id);
    },
    [nodes, selectedNodeId, setSelectedNodeId],
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
    !!selectedData &&
    !!parentData &&
    !selectedData.binding &&
    selectedNode?.type !== 'azureGroup'; // any child-of-group can be bound
  const isBound = !!selectedData?.binding;
  const showPin = isBound && !selectedData?.binding?.corner;
  const showCorner = isBound && !!selectedData?.binding?.corner;
  const showUnbind = isBound;

  /** Bind = associate with parent (compact icon), no corner placement */
  const handleBind = useCallback(() => {
    if (!selectedNodeId || !parentNode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedNodeId) return n;
        return {
          ...n,
          data: { ...n.data, binding: {} },
        };
      }),
    );
  }, [selectedNodeId, parentNode, setNodes]);

  /** Pin to corner = move to a specific corner (and switch into corner-anchored mode) */
  const handlePinToCorner = useCallback(
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
          const nodeW = 32;
          const nodeH = 32;
          const pos = cornerPosition(corner, parentW, parentH, nodeW, nodeH);
          // Drop extent:'parent' so the icon can overhang the boundary
          const { extent: _ext, ...rest } = n;
          return {
            ...rest,
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
        // Leave extent unset — leaf nodes are free to move between groups
        return {
          ...n,
          data: rest as AzureNodeDataType,
        };
      }),
    );
  }, [selectedNodeId, setNodes]);

  const handleCycleCorner = useCallback(() => {
    if (!selectedNodeId || !selectedData?.binding?.corner) return;
    handlePinToCorner(nextCorner(selectedData.binding.corner));
  }, [selectedNodeId, selectedData, handlePinToCorner]);

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

  /** Topologically sort so every parent appears before its children
   *  (React Flow v12 invariant; otherwise children snap to canvas origin). */
  const topoSortNodes = (nds: AzureNode[]): AzureNode[] => {
    const byId = new Map(nds.map((n) => [n.id, n] as const));
    const visited = new Set<string>();
    const ordered: AzureNode[] = [];
    const visit = (n: AzureNode) => {
      if (visited.has(n.id)) return;
      if (n.parentId && byId.has(n.parentId)) visit(byId.get(n.parentId)!);
      visited.add(n.id);
      ordered.push(n);
    };
    for (const n of nds) visit(n);
    return ordered;
  };

  /** Move selected node to the END of the array — renders on top of siblings. */
  const handleBringToFront = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((nds) => {
      const target = nds.find((n) => n.id === selectedNodeId);
      if (!target) return nds;
      return topoSortNodes([...nds.filter((n) => n.id !== selectedNodeId), target]);
    });
  }, [selectedNodeId, setNodes]);

  /** Move selected node to the START of the array — renders behind siblings. */
  const handleSendToBack = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((nds) => {
      const target = nds.find((n) => n.id === selectedNodeId);
      if (!target) return nds;
      return topoSortNodes([target, ...nds.filter((n) => n.id !== selectedNodeId)]);
    });
  }, [selectedNodeId, setNodes]);

  // Re-parent a node when it's dragged onto a different group
  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      setNodes((nds) => {
        const dragged = nds.find((n) => n.id === node.id) as AzureNode | undefined;
        if (!dragged) return nds;
        // Subnet group children (auto-managed) should not be re-parented
        if (dragged.id.includes('__subnet__')) return nds;

        // Compute absolute positions for hit-testing
        const absPos = new Map<string, { x: number; y: number }>();
        for (const n of nds) {
          const px = n.parentId ? absPos.get(n.parentId) : undefined;
          absPos.set(n.id, {
            x: n.position.x + (px?.x ?? 0),
            y: n.position.y + (px?.y ?? 0),
          });
        }
        const draggedAbs = absPos.get(dragged.id)!;
        const draggedW = dragged.measured?.width ?? (dragged.width as number) ?? 32;
        const draggedH = dragged.measured?.height ?? (dragged.height as number) ?? 32;
        const cx = draggedAbs.x + draggedW / 2;
        const cy = draggedAbs.y + draggedH / 2;

        // Find smallest group whose interior contains the dragged node's center.
        // The current parent stays in the candidate pool so a small drag inside
        // the same subnet doesn't get hijacked by a larger enclosing group.
        const candidates = nds.filter((n) => {
          if (n.id === dragged.id) return false;
          if (n.type !== 'azureGroup') return false;
          const w = (n.measured?.width ?? (n.width as number) ?? 0);
          const h = (n.measured?.height ?? (n.height as number) ?? 0);
          const ap = absPos.get(n.id)!;
          return cx >= ap.x && cx <= ap.x + w && cy >= ap.y && cy <= ap.y + h;
        });
        if (candidates.length === 0) return nds;
        const newParent = candidates.reduce((smallest, g) => {
          const sA = (smallest.measured?.width ?? 0) * (smallest.measured?.height ?? 0);
          const gA = (g.measured?.width ?? 0) * (g.measured?.height ?? 0);
          return gA < sA ? g : smallest;
        });

        // Don't re-parent into our own descendant
        let p: AzureNode | undefined = newParent;
        while (p) {
          if (p.id === dragged.id) return nds;
          p = p.parentId ? (nds.find((x) => x.id === p!.parentId) as AzureNode | undefined) : undefined;
        }

        // No-op if the smallest containing group is still the current parent
        if (newParent.id === dragged.parentId) return nds;

        const newParentAbs = absPos.get(newParent.id)!;
        const reparented = nds.map((n) => {
          if (n.id !== dragged.id) return n;
          return {
            ...n,
            parentId: newParent.id,
            extent: 'parent' as const,
            position: {
              x: draggedAbs.x - newParentAbs.x,
              y: draggedAbs.y - newParentAbs.y,
            },
            // Clear any stale binding because the corner anchor now refers
            // to a different parent geometry.
            data: (() => {
              const d = n.data as AzureNodeDataType;
              const { binding: _b, ...rest } = d;
              return rest as AzureNodeDataType;
            })(),
          };
        });
        // Maintain React Flow v12 invariant: parents must appear before children.
        return topoSortNodes(reparented);
      });
    },
    [setNodes],
  );

  return (
    <div className="diagram-panel" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        isValidConnection={isValidConnectionFn}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        onInit={(instance) => {
          reactFlowInstance.current = instance;
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'deletable' }}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.5}
        multiSelectionKeyCode="Control"
        connectionMode={ConnectionMode.Loose}
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
              onClick={handleBind}
              title="Bind to parent group (compact icon)"
            >
              Bind
            </Button>
          )}
          {showPin && (
            <Button
              appearance="subtle"
              icon={<PinRegular />}
              size="small"
              onClick={() => handlePinToCorner('bottom-left')}
              title="Pin to corner of parent group"
            >
              Pin to corner
            </Button>
          )}
          {showCorner && (
            <Button
              appearance="subtle"
              icon={<PinRegular />}
              size="small"
              onClick={handleCycleCorner}
              title={`Move to next corner (currently ${selectedData?.binding?.corner})`}
            >
              {selectedData?.binding?.corner}
            </Button>
          )}
          {showUnbind && (
            <Button
              appearance="subtle"
              icon={<PinOffRegular />}
              size="small"
              onClick={handleUnbind}
              title="Unbind from parent"
            >
              Unbind
            </Button>
          )}
          <Button
            appearance="subtle"
            icon={<ArrowUpRegular />}
            size="small"
            onClick={handleBringToFront}
            title="Bring to front (renders on top of overlapping nodes)"
          >
            Front
          </Button>
          <Button
            appearance="subtle"
            icon={<ArrowDownRegular />}
            size="small"
            onClick={handleSendToBack}
            title="Send to back (renders behind overlapping nodes)"
          >
            Back
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
