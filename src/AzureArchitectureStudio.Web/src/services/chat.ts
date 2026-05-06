import type { OpenAISettings } from './openai-settings';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface DiagramNodeSnapshot {
  id: string;
  typeKey: string;
  name: string;
  parentId?: string;
}

export interface DiagramEdgeSnapshot {
  source: string;
  target: string;
}

export interface AvailableService {
  key: string;
  name: string;
  category: string;
  /** Mirror of ResourceDependencyDef so the server can validate links. */
  dependencies?: ServiceDependency[];
}

export interface ServiceDependency {
  key: string;
  label: string;
  targetType: string;
  required?: boolean;
  autoFromParent?: boolean;
  hint?: string;
  /** Always sent as an array (never undefined) — server expects List<string>. */
  requiredName?: string[];
  /** One-hop intermediary types that satisfy the dep. */
  acceptVia?: string[];
}

export type DiagramAction =
  | { type: 'add_node'; id: string; typeKey: string; name: string; x?: number; y?: number; parentId?: string }
  | { type: 'connect_nodes'; sourceId: string; targetId: string }
  | { type: 'remove_node'; id: string }
  | { type: 'clear_diagram' };

export interface ChatRequest {
  settings?: OpenAISettings;
  history: ChatTurn[];
  message: string;
  nodes: DiagramNodeSnapshot[];
  edges: DiagramEdgeSnapshot[];
  availableServices: AvailableService[];
}

interface RawChatResponse {
  message: string;
  actions: Array<Record<string, unknown>>;
  success: boolean;
  error?: string;
}

export interface ChatResponse {
  message: string;
  actions: DiagramAction[];
  success: boolean;
  error?: string;
}

function normaliseAction(raw: Record<string, unknown>): DiagramAction | null {
  const type = String(raw.type ?? '');
  switch (type) {
    case 'add_node':
      return {
        type,
        id: String(raw.id ?? ''),
        typeKey: String(raw.typeKey ?? ''),
        name: String(raw.name ?? ''),
        x: typeof raw.x === 'number' ? raw.x : undefined,
        y: typeof raw.y === 'number' ? raw.y : undefined,
        parentId: typeof raw.parentId === 'string' && raw.parentId.length > 0 ? raw.parentId : undefined,
      };
    case 'connect_nodes':
      return {
        type,
        sourceId: String(raw.sourceId ?? ''),
        targetId: String(raw.targetId ?? ''),
      };
    case 'remove_node':
      return { type, id: String(raw.id ?? '') };
    case 'clear_diagram':
      return { type };
    default:
      return null;
  }
}

export const chatService = {
  async send(request: ChatRequest): Promise<ChatResponse> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      return {
        success: false,
        message: '',
        actions: [],
        error: `Server returned ${res.status}.`,
      };
    }

    const raw = (await res.json()) as RawChatResponse;
    return {
      success: raw.success,
      message: raw.message ?? '',
      error: raw.error,
      actions: (raw.actions ?? [])
        .map(normaliseAction)
        .filter((a): a is DiagramAction => a !== null),
    };
  },

  /**
   * Streaming variant — opens an SSE connection to /api/chat/stream and
   * invokes `onProgress` for every event the server emits (tool calls,
   * tool results, intermediate "thinking" markers, etc.). The promise
   * resolves with the final ChatResponse once the server emits the
   * `done` event (or the stream ends).
   *
   * If the browser/network drops the connection we synthesise an error
   * response so the caller can surface a useful message.
   */
  async sendStream(
    request: ChatRequest,
    onProgress: (evt: ChatProgressEvent) => void,
    abort?: AbortSignal,
  ): Promise<ChatResponse> {
    let res: Response;
    try {
      res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: abort,
      });
    } catch (err) {
      return {
        success: false,
        message: '',
        actions: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (!res.ok || !res.body) {
      return {
        success: false,
        message: '',
        actions: [],
        error: `Server returned ${res.status}.`,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: ChatResponse | null = null;

    // Standard SSE parsing: events are separated by a blank line; data
    // lines start with "data: ". We accumulate fragments across reads.
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          // A frame may have multiple "data:" lines that should be joined
          // with newlines per the SSE spec, but our server always emits a
          // single line so this is mostly defensive.
          const dataLines = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart());
          if (dataLines.length === 0) continue;
          const json = dataLines.join('\n');

          let evt: ChatProgressEvent;
          try {
            evt = JSON.parse(json) as ChatProgressEvent;
          } catch {
            continue;
          }

          // Convert the action shape (server casing already matches because
          // the controller sets PropertyNamingPolicy = CamelCase).
          if (evt.kind === 'action' && evt.action) {
            const normalised = normaliseAction(evt.action as unknown as Record<string, unknown>);
            if (normalised) evt.action = normalised;
          }
          if (evt.kind === 'done' && evt.final) {
            const f = evt.final;
            final = {
              success: !!f.success,
              message: f.message ?? '',
              error: f.error,
              actions: ((f.actions ?? []) as Array<Record<string, unknown>>)
                .map(normaliseAction)
                .filter((a): a is DiagramAction => a !== null),
            };
          }

          try { onProgress(evt); } catch { /* never let listener throw kill the stream */ }
        }
      }
    } catch (err) {
      if (final) return final;
      return {
        success: false,
        message: '',
        actions: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return final ?? {
      success: false,
      message: '',
      actions: [],
      error: 'Stream ended without a final response.',
    };
  },
};

/**
 * Progress event emitted during a streaming chat session. Mirrors the
 * server's <c>ChatProgressEvent</c> with camelCase property names.
 */
export interface ChatProgressEvent {
  kind:
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'docs_search'
    | 'info'
    | 'assistant'
    | 'action'
    | 'done';
  title?: string;
  detail?: string;
  action?: DiagramAction;
  final?: {
    success?: boolean;
    message?: string;
    error?: string;
    actions?: Array<Record<string, unknown>>;
  };
}
