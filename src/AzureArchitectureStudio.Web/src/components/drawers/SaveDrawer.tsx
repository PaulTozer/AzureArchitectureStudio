import { useState, useEffect, useCallback } from 'react';
import {
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Button,
  Input,
  Field,
  Spinner,
  Toast,
  Toaster,
  useToastController,
  useId,
} from '@fluentui/react-components';
import {
  DismissRegular,
  SaveRegular,
  FolderOpenRegular,
  DeleteRegular,
} from '@fluentui/react-icons';
import { useIsAuthenticated } from '@azure/msal-react';
import { useAppContext } from '../../context/AppContext';
import { designService } from '../../services';
import type { AzureNodeData, DiagramGraph, AzureNodeDto, LinkModelDto } from '../../models';

interface SaveDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function SaveDrawer({ open, onClose }: SaveDrawerProps) {
  const isAuthenticated = useIsAuthenticated();
  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    currentDesignName,
    setCurrentDesignName,
    clearDiagram,
  } = useAppContext();

  const [designName, setDesignName] = useState(currentDesignName || '');
  const [savedDesigns, setSavedDesigns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDesign, setSelectedDesign] = useState<string | null>(null);

  const toasterId = useId('save-toaster');
  const { dispatchToast } = useToastController(toasterId);

  const showToast = useCallback(
    (message: string, intent: 'success' | 'error' | 'warning') => {
      dispatchToast(<Toast>{message}</Toast>, { intent });
    },
    [dispatchToast]
  );

  // Load saved designs list
  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      setLoading(true);
      try {
        const result = await designService.getSaved();
        if (result.names) setSavedDesigns(result.names);
      } catch {
        showToast('Failed to load saved designs.', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [isAuthenticated, showToast]);

  const handleSave = useCallback(async () => {
    if (!designName.trim()) {
      showToast('Please enter a design name.', 'warning');
      return;
    }
    if (nodes.length === 0) {
      showToast('There is nothing to save.', 'warning');
      return;
    }

    // Convert React Flow nodes/edges to DiagramGraph DTO
    const diagramGraph: DiagramGraph = {
      groups: [],
      nodes: nodes.map((n) => {
        const data = n.data as AzureNodeData;
        return {
          typeKey: data.typeKey,
          imagePath: data.imagePath,
          id: n.id,
          locked: false,
          position: n.position,
          size: { width: n.measured?.width ?? 80, height: n.measured?.height ?? 80 },
          groupId: n.parentId ?? '',
          name: data.name,
          location: data.location,
          useResourceGroupLocation: data.useResourceGroupLocation,
          ...data.properties,
        } as AzureNodeDto;
      }),
      links: edges.map((e) => ({
        sourcePortParentId: e.source,
        sourcePortAlignment: 0,
        targetPortParentId: e.target,
        targetPortAlignment: 0,
      })),
    };

    setLoading(true);
    try {
      const status = await designService.save(
        designName,
        JSON.stringify(diagramGraph)
      );
      if (status >= 200 && status < 300) {
        showToast('Design saved successfully.', 'success');
        setCurrentDesignName(designName);
        if (!savedDesigns.includes(designName)) {
          setSavedDesigns((prev) => [...prev, designName]);
        }
      } else {
        showToast(`Failed to save. Error code: ${status}`, 'error');
      }
    } catch {
      showToast('Failed to save design.', 'error');
    } finally {
      setLoading(false);
    }
  }, [designName, nodes, edges, showToast, setCurrentDesignName, savedDesigns]);

  const handleLoad = useCallback(async () => {
    if (!selectedDesign) return;

    setLoading(true);
    try {
      const result = await designService.load(selectedDesign);
      if (result.status === 200 && result.data) {
        const graph: DiagramGraph = JSON.parse(result.data);
        clearDiagram();

        // Convert back to React Flow nodes
        const allDtos = [...graph.groups, ...graph.nodes];
        const rfNodes = allDtos.map((dto) => ({
          id: dto.id,
          type: graph.groups.some((g) => g.id === dto.id) ? 'azureGroup' : 'azureNode',
          position: dto.position,
          data: {
            typeKey: dto.typeKey,
            imagePath: dto.imagePath,
            name: dto.name,
            location: dto.location,
            useResourceGroupLocation: dto.useResourceGroupLocation,
            isValid: true,
            properties: {},
          } satisfies AzureNodeData,
          ...(dto.groupId ? { parentId: dto.groupId } : {}),
        }));

        const rfEdges = graph.links.map((link, i) => ({
          id: `e-${i}`,
          source: link.sourcePortParentId,
          target: link.targetPortParentId,
          style: { stroke: '#0078d4', strokeWidth: 1 },
        }));

        // React Flow v12 requires parents before children
        const nodeById = new Map(rfNodes.map((n) => [n.id, n] as const));
        const visited = new Set<string>();
        const sorted: typeof rfNodes = [];
        const visit = (n: (typeof rfNodes)[number]) => {
          if (visited.has(n.id)) return;
          const pid = (n as { parentId?: string }).parentId;
          if (pid && nodeById.has(pid)) visit(nodeById.get(pid)!);
          else if (pid && !nodeById.has(pid)) {
            // Orphaned parentId — strip it
            const { parentId: _p, extent: _e, ...rest } = n as typeof n & { parentId?: string; extent?: unknown };
            visited.add(n.id);
            sorted.push(rest as typeof n);
            return;
          }
          visited.add(n.id);
          sorted.push(n);
        };
        for (const n of rfNodes) visit(n);

        setNodes(sorted as AzureNode[]);
        setEdges(rfEdges);
        setCurrentDesignName(selectedDesign);
        showToast('Design loaded.', 'success');
        onClose();
      } else {
        showToast('Failed to load design.', 'error');
      }
    } catch {
      showToast('Failed to load design.', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedDesign, clearDiagram, setNodes, setEdges, setCurrentDesignName, showToast, onClose]);

  const handleDelete = useCallback(
    async (name: string) => {
      setLoading(true);
      try {
        await designService.delete(name);
        setSavedDesigns((prev) => prev.filter((d) => d !== name));
        showToast('Design deleted.', 'success');
      } catch {
        showToast('Failed to delete design.', 'error');
      } finally {
        setLoading(false);
      }
    },
    [showToast]
  );

  return (
    <OverlayDrawer position="end" open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <Toaster toasterId={toasterId} position="top-end" />
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              icon={<DismissRegular />}
              onClick={onClose}
            />
          }
        >
          Save / Load Design
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {!isAuthenticated ? (
          <p style={{ color: 'var(--colorNeutralForeground3)' }}>
            Please sign in to save and load designs.
          </p>
        ) : (
          <>
            {/* Save section */}
            <Field label="Design Name" required>
              <Input
                value={designName}
                onChange={(_, d) => setDesignName(d.value)}
                size="small"
              />
            </Field>
            <Button
              appearance="primary"
              icon={<SaveRegular />}
              onClick={handleSave}
              disabled={loading}
              style={{ marginTop: 8 }}
            >
              Save
            </Button>

            {/* Saved designs list */}
            <h4 style={{ marginTop: 24, marginBottom: 8 }}>Saved Designs</h4>
            {loading && <Spinner size="tiny" />}
            {savedDesigns.length === 0 && !loading && (
              <p style={{ color: 'var(--colorNeutralForeground3)', fontSize: 13 }}>
                No saved designs.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {savedDesigns.map((name) => (
                <div
                  key={name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 8px',
                    borderRadius: 4,
                    background:
                      selectedDesign === name
                        ? 'var(--colorNeutralBackground1Selected)'
                        : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedDesign(name)}
                >
                  <span style={{ flex: 1, fontSize: 13 }}>{name}</span>
                  <Button
                    appearance="subtle"
                    icon={<DeleteRegular />}
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(name);
                    }}
                  />
                </div>
              ))}
            </div>
            {selectedDesign && (
              <Button
                appearance="secondary"
                icon={<FolderOpenRegular />}
                onClick={handleLoad}
                disabled={loading}
                style={{ marginTop: 12 }}
              >
                Load "{selectedDesign}"
              </Button>
            )}
          </>
        )}
      </DrawerBody>
    </OverlayDrawer>
  );
}
