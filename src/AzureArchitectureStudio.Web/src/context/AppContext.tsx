import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { AzureNode, AzureEdge, StencilModel, AzureNodeData, AzureServiceModel } from '../models';
import { AdsConstants } from '../models';

interface DiagramState {
  nodes: AzureNode[];
  edges: AzureEdge[];
}

interface AppContextType {
  // Stencils (legacy)
  stencils: StencilModel[];
  setStencils: (stencils: StencilModel[]) => void;
  // Azure services catalog (new, API-driven)
  azureServices: AzureServiceModel[];
  setAzureServices: (services: AzureServiceModel[]) => void;
  draggedStencilKey: string;
  setDraggedStencilKey: (key: string) => void;

  // Diagram
  nodes: AzureNode[];
  edges: AzureEdge[];
  setNodes: React.Dispatch<React.SetStateAction<AzureNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<AzureEdge[]>>;

  // Current design name
  currentDesignName: string;
  setCurrentDesignName: (name: string) => void;

  // Node selection
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  // Helpers
  addNode: (node: AzureNode) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Partial<AzureNodeData>) => void;
  clearDiagram: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [stencils, setStencils] = useState<StencilModel[]>([]);
  const [azureServices, setAzureServices] = useState<AzureServiceModel[]>([]);
  const [draggedStencilKey, setDraggedStencilKey] = useState('');
  const [nodes, setNodes] = useState<AzureNode[]>([]);
  const [edges, setEdges] = useState<AzureEdge[]>([]);
  const [currentDesignName, setCurrentDesignName] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const addNode = useCallback((node: AzureNode) => {
    setNodes((prev) => [...prev, node]);
  }, []);

  const removeNode = useCallback(
    (id: string) => {
      setNodes((prev) => prev.filter((n) => n.id !== id));
      setEdges((prev) =>
        prev.filter((e) => e.source !== id && e.target !== id)
      );
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [selectedNodeId]
  );

  const updateNodeData = useCallback(
    (id: string, updates: Partial<AzureNodeData>) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...updates } } : n
        )
      );
    },
    []
  );

  const clearDiagram = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setCurrentDesignName('');
  }, []);

  return (
    <AppContext.Provider
      value={{
        stencils,
        setStencils,
        azureServices,
        setAzureServices,
        draggedStencilKey,
        setDraggedStencilKey,
        nodes,
        edges,
        setNodes,
        setEdges,
        currentDesignName,
        setCurrentDesignName,
        selectedNodeId,
        setSelectedNodeId,
        addNode,
        removeNode,
        updateNodeData,
        clearDiagram,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside AppProvider');
  return ctx;
}
