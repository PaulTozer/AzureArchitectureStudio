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
  type ChatProgressEvent,
} from '../../services';
import {
  getDefaultProperties,
  getDisplayName,
  isGroupType,
  getGroupStyle,
  getResourceType,
  type AzureNodeData,
  type AzureNode,
} from '../../models';
import { subnetNodeId } from '../../hooks/useSubnetSync';
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

/**
 * One row in the live activity log shown while the assistant is busy.
 * `tone` controls the visual treatment so tool calls stand out from
 * plain "thinking" markers and tool results.
 */
interface ActivityEntry {
  id: number;
  tone: 'thinking' | 'tool' | 'result' | 'docs' | 'action' | 'info';
  title: string;
  detail?: string;
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
  // Live activity log shown inside the "Thinking…" indicator. Cleared
  // on every new send.
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [configured, setConfigured] = useState(() => isOpenAIConfigured(loadOpenAISettings()));

  const scrollRef = useRef<HTMLDivElement>(null);

  // Re-check settings whenever the drawer opens (user may have just saved them)
  useEffect(() => {
    if (open) setConfigured(isOpenAIConfigured(loadOpenAISettings()));
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, activity.length]);

  const availableServices = useMemo(
    () => azureServices.map((s) => {
      // Pull dependency definitions from the resource registry so the
      // server can validate freshly-added nodes and tell the AI which
      // required references are still missing.
      const def = getResourceType(s.key);
      const deps = (def?.dependencies ?? []).map((d) => ({
        key: d.key,
        label: d.label,
        targetType: d.targetType,
        required: !!d.required,
        autoFromParent: !!d.autoFromParent,
        hint: d.hint,
        requiredName: d.requiredName
          ? Array.isArray(d.requiredName) ? d.requiredName : [d.requiredName]
          : [],
        acceptVia: d.acceptVia ?? [],
      }));
      return { key: s.key, name: s.name, category: s.category, dependencies: deps };
    }),
    [azureServices]
  );

  // Convert chat-server diagram actions into React Flow updates
  const applyActions = useCallback(
    (actions: DiagramAction[]) => {
      if (actions.length === 0) return;

      // Mapping for ids the server made up but that we translate locally.
      // The most common case: when the server creates a `subnet` node
      // parented to a VNet, we don't insert a real node — we append it to
      // the VNet's `properties.subnets` array (the existing useSubnetSync
      // hook materialises the visible group). The original server id then
      // maps to the synthetic subnet id (`<vnetId>__subnet__<index>`) so
      // any subsequent child PE node can resolve its parent.
      const idTranslation = new Map<string, string>();
      const translate = (id: string | undefined): string | undefined =>
        id && idTranslation.has(id) ? idTranslation.get(id) : id;

      // Track per-VNet subnet index so we can name subnets while inserting.
      // Initialised lazily during the setNodes pass.

      setNodes((prev) => {
        let next = [...prev];

        // Helper to find a node in `next` by id (post-translation aware).
        const findNode = (id: string | undefined) =>
          id ? next.find((n) => n.id === id) : undefined;

        // Per-subnet child counter so successive PEs don't overlap. The
        // synthetic subnet view-node doesn't exist in `next` yet (created
        // later by useSubnetSync) so we can't measure it — just tile.
        const childIndexByParent = new Map<string, number>();
        // Existing children of materialised parents count too.
        for (const n of prev) {
          const pid = (n as { parentId?: string }).parentId;
          if (!pid) continue;
          childIndexByParent.set(pid, (childIndexByParent.get(pid) ?? 0) + 1);
        }

        for (const a of actions) {
          if (a.type === 'add_node') {
            const parentIdResolved = translate(a.parentId);

            // Special-case: subnet under a VNet → push into VNet.properties.subnets.
            const parentNode = findNode(parentIdResolved);
            const parentTypeKey = parentNode
              ? (parentNode.data as AzureNodeData).typeKey
              : undefined;
            const parentIsVnet = parentTypeKey === 'virtual-networks'
              || parentTypeKey === 'virtual-network';

            if (a.typeKey === 'subnet' && parentNode && parentIsVnet) {
              // Append to VNet's subnets array. useSubnetSync will create the visible node.
              next = next.map((n) => {
                if (n.id !== parentNode.id) return n;
                const data = n.data as AzureNodeData;
                const existing = (data.properties?.subnets as Array<{ name?: string }> | undefined)
                  ?? [];
                const newIndex = existing.length;
                idTranslation.set(a.id, subnetNodeId(parentNode.id, newIndex));
                // Grow the VNet wide enough that useSubnetSync can lay all
                // subnets out side-by-side at the minimum subnet width
                // (120) without overlap. useSubnetSync's formula:
                // subnetWidth = max(120, (vnetW - 24 - 8*(n-1))/n).
                // To guarantee >= 120 we need vnetW >= 120*n + 8*(n-1) + 24.
                const subnetCount = existing.length + 1;
                const minVnetWidth = 120 * subnetCount + 8 * Math.max(0, subnetCount - 1) + 24;
                const minVnetHeight = 220;
                const curW = (n.style?.width as number | undefined) ?? 360;
                const curH = (n.style?.height as number | undefined) ?? 220;
                const newW = Math.max(curW, minVnetWidth);
                const newH = Math.max(curH, minVnetHeight);
                return {
                  ...n,
                  width: newW,
                  height: newH,
                  data: {
                    ...data,
                    properties: {
                      ...(data.properties ?? {}),
                      subnets: [
                        ...existing,
                        { name: a.name, addressPrefix: '' },
                      ],
                    },
                  },
                  style: { ...(n.style ?? {}), width: newW, height: newH },
                } satisfies AzureNode;
              });
              continue;
            }

            const svc = azureServices.find((s) => s.key === a.typeKey);
            const iconPath = svc?.iconPath ?? '';
            const grouped = isGroupType(a.typeKey);
            const groupDims = grouped ? getGroupStyle(a.typeKey) : undefined;

            // Start with schema defaults but strip the auto-added "default"
            // subnet for AI-created VNets — the AI will explicitly create
            // any subnets it needs (and we manage them via properties.subnets).
            const baseProps = getDefaultProperties(a.typeKey) ?? {};
            const props = (a.typeKey === 'virtual-networks' || a.typeKey === 'virtual-network')
              ? { ...baseProps, subnets: [] as Array<{ name: string; addressPrefix?: string }> }
              : baseProps;

            // Compute an initial position. For children whose parent is a
            // synthetic subnet (or any parent that won't be re-laid-out by
            // autoLayoutDiagram below), we tile horizontally so successive
            // siblings don't stack on top of each other at (0,0).
            const isSyntheticSubnetParent = parentIdResolved
              && parentIdResolved.includes('__subnet__');
            const siblingIndex = parentIdResolved
              ? (childIndexByParent.get(parentIdResolved) ?? 0)
              : 0;
            if (parentIdResolved) {
              childIndexByParent.set(parentIdResolved, siblingIndex + 1);
            }
            const startX = isSyntheticSubnetParent ? 12 : (a.x ?? 0);
            const startY = isSyntheticSubnetParent ? 32 : (a.y ?? 0);
            const tileX = isSyntheticSubnetParent
              ? startX + siblingIndex * (LEAF_W + 12)
              : startX;

            const node: AzureNode = {
              id: a.id,
              type: grouped ? 'azureGroup' : 'azureNode',
              position: { x: tileX, y: startY },
              data: {
                typeKey: a.typeKey,
                imagePath: iconPath,
                name: a.name || getDisplayName(a.typeKey),
                location: '',
                useResourceGroupLocation: true,
                isValid: true,
                properties: props,
              } satisfies AzureNodeData,
              ...(parentIdResolved
                ? {
                    parentId: parentIdResolved,
                    ...(grouped ? { extent: 'parent' as const } : {}),
                  }
                : {}),
              ...(groupDims ? { style: { width: groupDims.width, height: groupDims.height } } : {}),
            };
            next = [...next, node];

            // If this child is being inserted into a synthetic subnet,
            // grow the owning VNet so useSubnetSync sizes the subnet wide
            // enough to fit all the tiled children.
            if (isSyntheticSubnetParent && parentIdResolved) {
              const vnetIdMatch = parentIdResolved.split('__subnet__')[0];
              next = next.map((n) => {
                if (n.id !== vnetIdMatch) return n;
                // useSubnetSync divides VNet width equally across ALL
                // subnets in the VNet. So to fit `childCount` leaves in
                // ONE subnet we must scale the whole VNet by the total
                // subnet count, not just by this subnet's child count.
                const data = n.data as AzureNodeData;
                const subnetsArr =
                  (data.properties?.subnets as Array<{ name?: string }> | undefined) ?? [];
                const subnetCount = Math.max(1, subnetsArr.length);
                const childCount = (childIndexByParent.get(parentIdResolved) ?? 1);
                // Per-subnet inner: 12 left pad + childCount*(LEAF_W+12) + 12 right pad.
                // Required per-subnet width = 24 + childCount*(LEAF_W+12).
                const requiredSubnetW = 24 + childCount * (LEAF_W + 12);
                // useSubnetSync: subnetW = (vnetW - 24 - 8*(N-1)) / N
                // → vnetW = subnetW * N + 8*(N-1) + 24
                const minWidth =
                  requiredSubnetW * subnetCount + 8 * (subnetCount - 1) + 24;
                const minHeight = 220;
                const curW = (n.style?.width as number | undefined) ?? 250;
                const curH = (n.style?.height as number | undefined) ?? 200;
                if (curW >= minWidth && curH >= minHeight) return n;
                const w = Math.max(curW, minWidth);
                const h = Math.max(curH, minHeight);
                return {
                  ...n,
                  width: w,
                  height: h,
                  style: { ...(n.style ?? {}), width: w, height: h },
                };
              });
            }
          } else if (a.type === 'remove_node') {
            const id = translate(a.id) ?? a.id;
            next = next.filter((n) => n.id !== id);
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
          if (a.type === 'add_node') {
            touched.add(translate(a.id) ?? a.id);
          }
        }

        // NSGs and route tables are decorations: re-parent them onto the
        // subnet (or VNet) they protect and pin them to the bottom-left
        // corner so they look the same as ARM Import. We discover the
        // attachment by looking at the chat's connect_nodes actions —
        // wherever the AI wired the NSG to a subnet/vnet, that becomes
        // the new parent.
        const nsgAttachments = new Map<string, string>();
        for (const a of actions) {
          if (a.type !== 'connect_nodes') continue;
          const sId = translate(a.sourceId) ?? a.sourceId;
          const tId = translate(a.targetId) ?? a.targetId;
          const sNode = next.find((n) => n.id === sId);
          const tNode = next.find((n) => n.id === tId);
          if (!sNode || !tNode) continue;
          const sType = (sNode.data as AzureNodeData).typeKey;
          const tType = (tNode.data as AzureNodeData).typeKey;
          const isDec = (k: string) =>
            k === 'nsg' || k === 'network-security-groups' || k === 'network-security-group'
            || k === 'route-table' || k === 'route-tables';
          const isHost = (k: string) =>
            k === 'subnet' || k === 'subnets'
            || k === 'virtual-network' || k === 'virtual-networks';
          if (isDec(sType) && isHost(tType)) nsgAttachments.set(sNode.id, tNode.id);
          else if (isDec(tType) && isHost(sType)) nsgAttachments.set(tNode.id, sNode.id);
        }

        next = next.map((n) => {
          const data = n.data as AzureNodeData;
          const tk = data.typeKey;
          const isDec = tk === 'nsg' || tk === 'network-security-groups' || tk === 'network-security-group'
            || tk === 'route-table' || tk === 'route-tables';
          if (!isDec) return n;
          const newParent = nsgAttachments.get(n.id) ?? (n as { parentId?: string }).parentId;
          const alreadyPinned = !!data.binding?.corner;
          if (!newParent) return n;

          // Decide whether the chosen parent is a valid binding host.
          // - A real node in `next` that is a subnet or VNet, OR
          // - A synthetic subnet id (e.g. `<vnetId>__subnet__N`) which the
          //   useSubnetSync hook will materialise on the next render. We
          //   detect that pattern by id rather than by node lookup, since
          //   the node doesn't exist in `next` yet.
          const isSyntheticSubnet = newParent.includes('__subnet__');
          const parentNode = next.find((p) => p.id === newParent);
          const parentType = parentNode ? (parentNode.data as AzureNodeData).typeKey : undefined;
          const realIsHost = parentType === 'subnet' || parentType === 'subnets'
            || parentType === 'virtual-network' || parentType === 'virtual-networks';
          if (!isSyntheticSubnet && !realIsHost) return n;

          const updated: AzureNode = {
            ...n,
            parentId: newParent,
            extent: 'parent' as const,
            data: alreadyPinned
              ? data
              : { ...data, binding: { corner: 'bottom-left' } },
          };
          return updated;
        });

        next = autoLayoutDiagram(next, touched, prev);

        return next;
      });

      setEdges((prev) => {
        let next = [...prev];
        for (const a of actions) {
          if (a.type === 'connect_nodes') {
            const source = translate(a.sourceId) ?? a.sourceId;
            const target = translate(a.targetId) ?? a.targetId;
            next = [
              ...next,
              {
                id: `ai-edge-${next.length}-${Date.now()}`,
                source,
                target,
                type: 'deletable',
                style: { stroke: '#0078d4', strokeWidth: 1 },
              },
            ];
          } else if (a.type === 'remove_node') {
            const id = translate(a.id) ?? a.id;
            next = next.filter((e) => e.source !== id && e.target !== id);
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
      setActivity([]);

      // Auto-incrementing id so React can key the activity rows
      // independently from their content.
      let nextId = 0;
      const pushActivity = (entry: Omit<ActivityEntry, 'id'>) =>
        setActivity((prev) => [...prev, { ...entry, id: nextId++ }]);

      try {
        const resp = await chatService.sendStream(
          {
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
          },
          (evt: ChatProgressEvent) => {
            switch (evt.kind) {
              case 'thinking':
                pushActivity({ tone: 'thinking', title: evt.title || 'Thinking…' });
                break;
              case 'tool_call':
                pushActivity({
                  tone: evt.title?.toLowerCase().includes('microsoft learn') ? 'docs' : 'tool',
                  title: evt.title || 'Calling tool…',
                });
                break;
              case 'tool_result':
                // Truncate noisy tool results so the log stays readable.
                pushActivity({
                  tone: 'result',
                  title: 'Result',
                  detail: truncate(evt.detail, 200),
                });
                break;
              case 'action':
                if (evt.action) {
                  pushActivity({
                    tone: 'action',
                    title: describeAction(evt.action),
                  });
                }
                break;
              case 'assistant':
                // Final text — no need to echo here, it'll appear in the
                // chat transcript when the response lands.
                break;
              case 'info':
                pushActivity({ tone: 'info', title: evt.title || evt.detail || 'Info' });
                break;
              case 'done':
                // Handled by the resolved promise below.
                break;
            }
          },
        );

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
          // After the diagram has settled (groups grown, subnets synced)
          // ask the canvas to fit the new content into view so the user
          // can actually see what the AI built. Defer past two RAFs so
          // useSubnetSync + the layout pass have flushed.
          if (resp.actions.length > 0) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent('aas:fit-view'));
              });
            });
          }
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          { role: 'error', content: err instanceof Error ? err.message : String(err) },
        ]);
      } finally {
        setBusy(false);
        setActivity([]);
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
                <div className="chat-thinking-header">
                  <Spinner size="tiny" />
                  <span>{activity.length === 0 ? 'Thinking…' : 'Working…'}</span>
                </div>
                {activity.length > 0 && (
                  <ul className="chat-live-log">
                    {activity.map((a) => (
                      <li key={a.id} className={`chat-live-log-row chat-live-log-${a.tone}`}>
                        <span className="chat-live-log-title">{a.title}</span>
                        {a.detail && <span className="chat-live-log-detail">{a.detail}</span>}
                      </li>
                    ))}
                  </ul>
                )}
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
    // Special-case Virtual Networks: they are managed by useSubnetSync which
    // tiles their subnets horizontally and sizes them based on the VNet's
    // own dimensions — leave their children alone here.
    const myType = (node.data as AzureNodeData).typeKey;
    const isVnet = myType === 'virtual-network' || myType === 'virtual-networks';
    if (isVnet) {
      // Don't reposition VNet children AND don't shrink the VNet itself.
      // Use the largest of (current style, current measured, getGroupStyle
      // fallback) so the parent group sizing accounts for the real on-screen
      // VNet — otherwise the autoLayout pass would overwrite a previously
      // grown VNet width with a small default and PE leaves inside the
      // synthetic subnet would end up clipped outside.
      const fallback = getGroupStyle(myType) ?? { width: 360, height: 220 };
      const styleW = typeof node.style?.width === 'number' ? (node.style.width as number) : 0;
      const styleH = typeof node.style?.height === 'number' ? (node.style.height as number) : 0;
      const measuredW = node.measured?.width ?? 0;
      const measuredH = node.measured?.height ?? 0;
      const size: LayoutSize = {
        width: Math.max(fallback.width, styleW, measuredW),
        height: Math.max(fallback.height, styleH, measuredH),
      };
      // Intentionally DO NOT call newSize.set(...) — that would cause the
      // mapping pass at the bottom of this function to write `size` back
      // to the VNet's style, possibly shrinking it. Returning the size is
      // enough for the parent group's measurement.
      return size;
    }
    const cols = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(children.length))));
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

/** One-line description of a single diagram action for the activity log. */
function describeAction(a: DiagramAction): string {
  switch (a.type) {
    case 'add_node': {
      const name = a.name || a.id || 'node';
      const t = (a.typeKey || '').replace(/-/g, ' ').replace(/s$/, '');
      return t ? `Added ${t} '${name}'` : `Added '${name}'`;
    }
    case 'connect_nodes':
      return `Connected ${a.sourceId} → ${a.targetId}`;
    case 'remove_node':
      return `Removed ${a.id}`;
    case 'clear_diagram':
      return 'Cleared the canvas';
    default:
      return 'Updated diagram';
  }
}

function truncate(s: string | undefined, n: number): string | undefined {
  if (!s) return s;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
