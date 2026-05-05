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

      let placementCursor = nodes.length;
      const placementOrigin = { x: 80, y: 80 };
      const placementSpacing = 180;

      setNodes((prev) => {
        let next = [...prev];
        for (const a of actions) {
          if (a.type === 'add_node') {
            const svc = azureServices.find((s) => s.key === a.typeKey);
            const iconPath = svc?.iconPath ?? '';
            const grouped = isGroupType(a.typeKey);
            const groupDims = grouped ? getGroupStyle(a.typeKey) : undefined;

            const x = a.x ?? placementOrigin.x + (placementCursor % 5) * placementSpacing;
            const y = a.y ?? placementOrigin.y + Math.floor(placementCursor / 5) * placementSpacing;
            placementCursor++;

            const node: AzureNode = {
              id: a.id,
              type: grouped ? 'azureGroup' : 'azureNode',
              position: { x, y },
              data: {
                typeKey: a.typeKey,
                imagePath: iconPath,
                name: a.name || getDisplayName(a.typeKey),
                location: '',
                useResourceGroupLocation: true,
                isValid: true,
                properties: getDefaultProperties(a.typeKey) ?? {},
              } satisfies AzureNodeData,
              ...(groupDims ? { style: { width: groupDims.width, height: groupDims.height } } : {}),
            };
            next = [...next, node];
          } else if (a.type === 'remove_node') {
            next = next.filter((n) => n.id !== a.id);
          } else if (a.type === 'clear_diagram') {
            next = [];
          }
        }
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
    [nodes.length, azureServices, setNodes, setEdges]
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
