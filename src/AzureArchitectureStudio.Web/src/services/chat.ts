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
};
