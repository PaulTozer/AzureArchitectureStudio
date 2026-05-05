import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  MessageBarActions,
} from '@fluentui/react-components';
import {
  DismissRegular,
  SendRegular,
  SparkleRegular,
  SettingsRegular,
  DeleteRegular,
} from '@fluentui/react-icons';
import { useAppContext } from '../../context/AppContext';
import {
  chatService,
  loadOpenAISettings,
  isOpenAIConfigured,
  type ChatTurn,
  type DiagramAction,
} from '../../services';
import {
  getDefaultProperties,
  getDisplayName,
  isGroupType,
  getGroupStyle,
  type AzureNodeData,
  type AzureNode,
} from '../../models';
import './ChatDrawer.css';

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

interface DisplayMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  actionsSummary?: string;
}

const SUGGESTIONS = [
  'Build a 3-tier web app with App Service, SQL DB and Storage',
  'Add a Front Door in front of my App Service',
  'Search Microsoft Learn for AKS landing-zone best practices',
];

export default function ChatDrawer({ open, onClose, onOpenSettings }: ChatDrawerProps) {
  const { nodes, edges, azureServices, setNodes, setEdges } = useAppContext();

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(() => isOpenAIConfigured(loadOpenAISettings()));

  const scrollRef = useRef<HTMLDivElement>(null);

  // Re-check settings whenever the drawer opens (user may have just saved them)
  useEffect(() => {
    if (open) setConfigured(isOpenAIConfigured(loadOpenAISettings()));
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const availableServices = useMemo(
    () => azureServices.map((s) => ({ key: s.key, name: s.name, category: s.category })),
    [azureServices]
  );

  // Convert chat-server diagram actions into React Flow updates
  const applyActions = useCallback(
    (actions: DiagramAction[]) => {
      if (actions.length === 0) return;

      setNodes((prev) => {
        let next = [...prev];

        // First pass: insert / remove / clear so the node set reflects the
        // final state. Position only matters for nodes that ended up free
        // (i.e. without a parent); everything inside a group will be laid out
        // by the auto-layout pass below.
        for (const a of actions) {
          if (a.type === 'add_node') {
            const svc = azureServices.find((s) => s.key === a.typeKey);
            const iconPath = svc?.iconPath ?? '';
            const grouped = isGroupType(a.typeKey);
            const groupDims = grouped ? getGroupStyle(a.typeKey) : undefined;

            const node: AzureNode = {
              id: a.id,
              type: grouped ? 'azureGroup' : 'azureNode',
              position: { x: a.x ?? 0, y: a.y ?? 0 },
              data: {
                typeKey: a.typeKey,
                imagePath: iconPath,
                name: a.name || getDisplayName(a.typeKey),
                location: '',
                useResourceGroupLocation: true,
                isValid: true,
                properties: getDefaultProperties(a.typeKey) ?? {},
              } satisfies AzureNodeData,
              ...(a.parentId
                ? {
                    parentId: a.parentId,
                    ...(grouped ? { extent: 'parent' as const } : {}),
                  }
                : {}),
              ...(groupDims ? { style: { width: groupDims.width, height: groupDims.height } } : {}),
            };
            next = [...next, node];
          } else if (a.type === 'remove_node') {
            next = next.filter((n) => n.id !== a.id);
          } else if (a.type === 'clear_diagram') {
            next = [];
          }
        }

        // Auto-layout: any node that was added or moved by the AI gets re-laid
        // out so groups grow to fit their children and nothing overlaps.
        // Existing user-placed leaves at the top level are left where they are;
        // anything inside an AI-managed group is reflowed.
        const touched = new Set<string>();
        for (const a of actions) {
          if (a.type === 'add_node') touched.add(a.id);
        }
        next = autoLayoutDiagram(next, touched, prev);

        return next;
      });

      setEdges((prev) => {
        let next = [...prev];
        for (const a of actions) {
          if (a.type === 'connect_nodes') {
            next = [
              ...next,
              {
                id: `ai-edge-${next.length}-${Date.now()}`,
                source: a.sourceId,
                target: a.targetId,
                type: 'deletable',
                style: { stroke: '#0078d4', strokeWidth: 1 },
              },
            ];
          } else if (a.type === 'remove_node') {
            next = next.filter((e) => e.source !== a.id && e.target !== a.id);
          } else if (a.type === 'clear_diagram') {
            next = [];
          }
        }
        return next;
      });
    },
    [azureServices, setNodes, setEdges]
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      const settings = loadOpenAISettings();
      if (!isOpenAIConfigured(settings)) {
        setConfigured(false);
        return;
      }

      const history: ChatTurn[] = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
      setInput('');
      setBusy(true);

      try {
        const resp = await chatService.send({
          settings,
          history,
          message: trimmed,
          nodes: nodes.map((n) => ({
            id: n.id,
            typeKey: (n.data as AzureNodeData).typeKey,
            name: (n.data as AzureNodeData).name,
            parentId: (n as { parentId?: string }).parentId,
          })),
          edges: edges.map((e) => ({ source: e.source, target: e.target })),
          availableServices,
        });

        if (!resp.success) {
          setMessages((prev) => [
            ...prev,
            { role: 'error', content: resp.error || resp.message || 'Chat failed.' },
          ]);
        } else {
          applyActions(resp.actions);
          const summary = summariseActions(resp.actions);
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: resp.message, actionsSummary: summary },
          ]);
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { role: 'error', content: err instanceof Error ? err.message : String(err) },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, nodes, edges, availableServices, applyActions]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <OverlayDrawer
      position="end"
      open={open}
      onOpenChange={(_, d) => { if (!d.open) onClose(); }}
      size="medium"
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <>
              <Button
                appearance="subtle"
                icon={<DeleteRegular />}
                onClick={() => setMessages([])}
                title="Clear conversation"
                disabled={messages.length === 0 || busy}
              />
              <Button
                appearance="subtle"
                icon={<SettingsRegular />}
                onClick={onOpenSettings}
                title="AI settings"
              />
              <Button
                appearance="subtle"
                icon={<DismissRegular />}
                onClick={onClose}
                title="Close"
              />
            </>
          }
        >
          AI Assistant
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <div className="chat-drawer">
          {!configured && (
            <MessageBar intent="warning" className="chat-warning">
              <MessageBarBody>
                Azure OpenAI is not configured. Open settings to enter your endpoint,
                deployment, and API key.
              </MessageBarBody>
              <MessageBarActions>
                <Button size="small" onClick={onOpenSettings}>Open settings</Button>
              </MessageBarActions>
            </MessageBar>
          )}

          <div className="chat-messages" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                <SparkleRegular className="chat-empty-icon" />
                <div><strong>Ask me to design something.</strong></div>
                <div>I can place Azure resources, connect them, and pull guidance from Microsoft Learn.</div>
                <div className="chat-empty-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="chat-suggestion"
                      onClick={() => void send(s)}
                      disabled={busy || !configured}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble ${m.role}`}>
                {m.content || (m.role === 'assistant' ? '(no response)' : '')}
                {m.actionsSummary && (
                  <div className="chat-actions-summary">{m.actionsSummary}</div>
                )}
              </div>
            ))}

            {busy && (
              <div className="chat-thinking">
                <Spinner size="tiny" /> Thinking…
              </div>
            )}
          </div>

          <div className="chat-input-row">
            <textarea
              placeholder={configured ? 'Ask the AI to build or modify your diagram…' : 'Configure Azure OpenAI to start chatting…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy || !configured}
              rows={2}
            />
            <Button
              appearance="primary"
              icon={<SendRegular />}
              onClick={() => void send(input)}
              disabled={busy || !configured || input.trim().length === 0}
            >
              Send
            </Button>
          </div>
        </div>
      </DrawerBody>
    </OverlayDrawer>
  );
}

// ---------------------------------------------------------------------------
// Auto-layout
// ---------------------------------------------------------------------------

// Visual constants — tuned to roughly match what AzureNode/AzureGroup render at.
const LEAF_W = 120;
const LEAF_H = 110;
const GROUP_PAD_X = 24;
const GROUP_PAD_TOP = 56; // header row inside a group
const GROUP_PAD_BOTTOM = 24;
const CHILD_GAP = 28;
const TOP_LEVEL_GAP = 70;
const TOP_LEVEL_ORIGIN = { x: 60, y: 60 };

interface LayoutSize { width: number; height: number }

/**
 * Bottom-up auto-layout. For every group node we recompute child positions in
 * a clean grid and resize the group to fit. Top-level (parent-less) nodes
 * that the AI just touched are tiled left-to-right; untouched top-level
 * nodes keep their existing absolute position so user-arranged content is
 * not disturbed.
 */
function autoLayoutDiagram(
  nodes: AzureNode[],
  touched: Set<string>,
  previous: AzureNode[],
): AzureNode[] {
  if (nodes.length === 0) return nodes;

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const childrenOf = new Map<string | undefined, AzureNode[]>();
  for (const n of nodes) {
    const pid = (n as { parentId?: string }).parentId;
    const arr = childrenOf.get(pid) ?? [];
    arr.push(n);
    childrenOf.set(pid, arr);
  }

  const newSize = new Map<string, LayoutSize>();
  const newRelPos = new Map<string, { x: number; y: number }>();

  function measure(nodeId: string): LayoutSize {
    const node = byId.get(nodeId)!;
    const isGroup = node.type === 'azureGroup';
    if (!isGroup) return { width: LEAF_W, height: LEAF_H };

    const children = childrenOf.get(nodeId) ?? [];
    if (children.length === 0) {
      const fallback = getGroupStyle((node.data as AzureNodeData).typeKey)
        ?? { width: 240, height: 140 };
      newSize.set(nodeId, fallback);
      return fallback;
    }

    // Measure each child first
    const childSizes = children.map((c) => ({ id: c.id, size: measure(c.id) }));

    // Pick a column count that keeps the group roughly square but capped at 5.
    // Special-case Virtual Networks: lay subnets out as a single horizontal row
    // (matches Microsoft reference architecture diagrams).
    const myType = (node.data as AzureNodeData).typeKey;
    const isVnet = myType === 'virtual-network';
    const cols = isVnet
      ? Math.max(1, children.length)
      : Math.min(5, Math.max(1, Math.ceil(Math.sqrt(children.length))));
    const rows = Math.ceil(children.length / cols);
    const colWidths = new Array<number>(cols).fill(0);
    const rowHeights = new Array<number>(rows).fill(0);
    childSizes.forEach((c, i) => {
      const r = Math.floor(i / cols);
      const col = i % cols;
      colWidths[col] = Math.max(colWidths[col], c.size.width);
      rowHeights[r] = Math.max(rowHeights[r], c.size.height);
    });

    // Position children
    let yCursor = GROUP_PAD_TOP;
    for (let r = 0; r < rows; r++) {
      let xCursor = GROUP_PAD_X;
      for (let col = 0; col < cols; col++) {
        const idx = r * cols + col;
        if (idx >= childSizes.length) break;
        const c = childSizes[idx];
        const cellW = colWidths[col];
        const cellH = rowHeights[r];
        newRelPos.set(c.id, {
          x: xCursor + (cellW - c.size.width) / 2,
          y: yCursor + (cellH - c.size.height) / 2,
        });
        xCursor += cellW + CHILD_GAP;
      }
      yCursor += rowHeights[r] + CHILD_GAP;
    }

    const totalWidth = GROUP_PAD_X * 2
      + colWidths.reduce((a, b) => a + b, 0)
      + CHILD_GAP * (cols - 1);
    const totalHeight = GROUP_PAD_BOTTOM + (yCursor - CHILD_GAP);
    const size: LayoutSize = {
      width: Math.max(totalWidth, 240),
      height: Math.max(totalHeight, 120),
    };
    newSize.set(nodeId, size);
    return size;
  }

  const tops = childrenOf.get(undefined) ?? [];
  const topSizes = tops.map((n) => ({ id: n.id, size: measure(n.id), node: n }));

  // Decide which top-level subtrees to repack
  const touchedTopIds = new Set<string>();
  for (const t of topSizes) {
    if (subtreeIncludesTouched(t.id, childrenOf, touched)) touchedTopIds.add(t.id);
  }

  // Start the layout row below any untouched top-level content
  let layoutOriginY = TOP_LEVEL_ORIGIN.y;
  for (const t of topSizes) {
    if (touchedTopIds.has(t.id)) continue;
    const prevNode = previous.find((p) => p.id === t.id) ?? t.node;
    const bottom = prevNode.position.y + t.size.height;
    if (bottom + TOP_LEVEL_GAP > layoutOriginY) {
      layoutOriginY = bottom + TOP_LEVEL_GAP;
    }
  }

  // Tile touched top-level nodes left-to-right, wrapping at ~1400px wide.
  const MAX_ROW_WIDTH = 1400;
  let rowX = TOP_LEVEL_ORIGIN.x;
  let rowY = layoutOriginY;
  let rowMaxH = 0;
  const newAbsPos = new Map<string, { x: number; y: number }>();
  for (const t of topSizes) {
    if (!touchedTopIds.has(t.id)) {
      const prevNode = previous.find((p) => p.id === t.id) ?? t.node;
      newAbsPos.set(t.id, prevNode.position);
      continue;
    }
    if (rowX > TOP_LEVEL_ORIGIN.x && rowX + t.size.width > MAX_ROW_WIDTH) {
      rowX = TOP_LEVEL_ORIGIN.x;
      rowY += rowMaxH + TOP_LEVEL_GAP;
      rowMaxH = 0;
    }
    newAbsPos.set(t.id, { x: rowX, y: rowY });
    rowX += t.size.width + TOP_LEVEL_GAP;
    rowMaxH = Math.max(rowMaxH, t.size.height);
  }

  return nodes.map((n) => {
    const pid = (n as { parentId?: string }).parentId;
    let position = n.position;
    let style = n.style;

    if (pid) {
      const rel = newRelPos.get(n.id);
      if (rel) position = rel;
    } else {
      const abs = newAbsPos.get(n.id);
      if (abs) position = abs;
    }

    if (n.type === 'azureGroup') {
      const sz = newSize.get(n.id);
      if (sz) style = { ...style, width: sz.width, height: sz.height };
    }

    return { ...n, position, style };
  });
}

function subtreeIncludesTouched(
  nodeId: string,
  childrenOf: Map<string | undefined, AzureNode[]>,
  touched: Set<string>,
): boolean {
  if (touched.has(nodeId)) return true;
  for (const c of childrenOf.get(nodeId) ?? []) {
    if (subtreeIncludesTouched(c.id, childrenOf, touched)) return true;
  }
  return false;
}

function summariseActions(actions: DiagramAction[]): string | undefined {
  if (actions.length === 0) return undefined;
  const counts: Record<string, number> = {};
  for (const a of actions) counts[a.type] = (counts[a.type] || 0) + 1;
  const parts: string[] = [];
  if (counts['add_node']) parts.push(`+${counts['add_node']} node${counts['add_node'] === 1 ? '' : 's'}`);
  if (counts['connect_nodes']) parts.push(`+${counts['connect_nodes']} connection${counts['connect_nodes'] === 1 ? '' : 's'}`);
  if (counts['remove_node']) parts.push(`−${counts['remove_node']} node${counts['remove_node'] === 1 ? '' : 's'}`);
  if (counts['clear_diagram']) parts.push('cleared diagram');
  return parts.length ? `Diagram updated: ${parts.join(', ')}` : undefined;
}
