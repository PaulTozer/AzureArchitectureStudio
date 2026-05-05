import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { AzureNode, AzureEdge, StencilModel, AzureNodeData, AzureServiceModel } from '../models';
import { AdsConstants } from '../models';
import type { AzureSubscription, ScopeRef } from '../services';

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

  // Azure subscription (selected by user after sign-in) — kept for
  // backwards compatibility; prefer `selectedScope`.
  azureSubscription: AzureSubscription | null;
  setAzureSubscription: (sub: AzureSubscription | null) => void;

  // Active deployment / browse scope: management group, subscription or resource group.
  selectedScope: ScopeRef | null;
  setSelectedScope: (scope: ScopeRef | null) => void;

  // Helpers
  addNode: (node: AzureNode) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, data: Partial<AzureNodeData>) => void;
  clearDiagram: () => void;
}

const SUB_STORAGE_KEY = 'aas.subscription.v1';
const SCOPE_STORAGE_KEY = 'aas.scope.v1';

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
    return { ...parsed, nodes: topoSortNodes(parsed.nodes) };
  } catch {
    return null;
  }
}

/** Sort so every parent appears before its children — required by React Flow v12.
 *  Also strips parentId references to nodes that don't exist in the array. */
function topoSortNodes(nds: AzureNode[]): AzureNode[] {
  const byId = new Map(nds.map((n) => [n.id, n] as const));

  // Strip orphaned parentId references (parent was deleted but child persisted)
  const cleaned = nds.map((n) => {
    const pid = (n as { parentId?: string }).parentId;
    if (pid && !byId.has(pid)) {
      const { parentId: _p, extent: _e, ...rest } = n as AzureNode & { parentId?: string; extent?: unknown };
      return rest as AzureNode;
    }
    return n;
  });

  const cleanedById = new Map(cleaned.map((n) => [n.id, n] as const));
  const visited = new Set<string>();
  const ordered: AzureNode[] = [];
  const visit = (n: AzureNode) => {
    if (visited.has(n.id)) return;
    const pid = (n as { parentId?: string }).parentId;
    if (pid && cleanedById.has(pid)) visit(cleanedById.get(pid)!);
    visited.add(n.id);
    ordered.push(n);
  };
  for (const n of cleaned) visit(n);
  return ordered;
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
  const [azureSubscription, setAzureSubscriptionState] = useState<AzureSubscription | null>(() => {
    try {
      const raw = localStorage.getItem(SUB_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AzureSubscription) : null;
    } catch {
      return null;
    }
  });

  const [selectedScope, setSelectedScopeState] = useState<ScopeRef | null>(() => {
    try {
      const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ScopeRef) : null;
    } catch {
      return null;
    }
  });

  const setAzureSubscription = useCallback((sub: AzureSubscription | null) => {
    setAzureSubscriptionState(sub);
    try {
      if (sub) localStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(sub));
      else localStorage.removeItem(SUB_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const setSelectedScope = useCallback((scope: ScopeRef | null) => {
    setSelectedScopeState(scope);
    try {
      if (scope) localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
      else localStorage.removeItem(SCOPE_STORAGE_KEY);
    } catch {
      // ignore
    }
    // Mirror to the legacy azureSubscription slot when a subscription scope is
    // chosen (or a resource group, which is contained in one) so existing
    // consumers keep working without changes.
    if (scope?.kind === 'subscription') {
      setAzureSubscriptionState({
        id: scope.id,
        subscriptionId: scope.subscriptionId,
        displayName: scope.displayName,
        state: 'Enabled',
        tenantId: scope.tenantId,
      });
      try { localStorage.setItem(SUB_STORAGE_KEY, JSON.stringify({ id: scope.id, subscriptionId: scope.subscriptionId, displayName: scope.displayName, state: 'Enabled', tenantId: scope.tenantId })); } catch { /* ignore */ }
    } else if (scope?.kind === 'resourceGroup') {
      setAzureSubscriptionState({
        id: `/subscriptions/${scope.subscriptionId}`,
        subscriptionId: scope.subscriptionId,
        displayName: scope.subscriptionName,
        state: 'Enabled',
        tenantId: '',
      });
    }
  }, []);

  // One-time cleanup: fix orphaned parentIds in live state (survives HMR)
  const didCleanup = useRef(false);
  useEffect(() => {
    if (didCleanup.current) return;
    didCleanup.current = true;
    setNodes((prev) => {
      const sorted = topoSortNodes(prev);
      // Only update if something actually changed
      if (sorted.length !== prev.length || sorted.some((n, i) => n !== prev[i])) {
        return sorted;
      }
      return prev;
    });
  }, []);

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
        azureSubscription,
        setAzureSubscription,
        selectedScope,
        setSelectedScope,
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
