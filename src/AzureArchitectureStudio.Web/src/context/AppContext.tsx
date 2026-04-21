import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
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

const STORAGE_KEY = 'aas.diagram.v1';

interface PersistedDiagram {
  nodes: AzureNode[];
  edges: AzureEdge[];
  designName: string;
}

function loadPersisted(): PersistedDiagram | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDiagram;
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [stencils, setStencils] = useState<StencilModel[]>([]);
  const [azureServices, setAzureServices] = useState<AzureServiceModel[]>([]);
  const [draggedStencilKey, setDraggedStencilKey] = useState('');

  // Hydrate from localStorage on first render so a page refresh keeps state
  const initial = useRef<PersistedDiagram | null>(loadPersisted());
  const [nodes, setNodes] = useState<AzureNode[]>(initial.current?.nodes ?? []);
  const [edges, setEdges] = useState<AzureEdge[]>(initial.current?.edges ?? []);
  const [currentDesignName, setCurrentDesignName] = useState(initial.current?.designName ?? '');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Debounced persistence — write to localStorage when diagram changes
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        const payload: PersistedDiagram = { nodes, edges, designName: currentDesignName };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // Quota exceeded or storage disabled — ignore
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [nodes, edges, currentDesignName]);

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
      // eslint-disable-next-line no-console
      console.log('%c[AppContext:updateNodeData]', 'color:#7a3; font-weight:bold', {
        id,
        keys: Object.keys(updates),
        updates,
      });
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
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
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
