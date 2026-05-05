/**
 * Diagram-related visual settings stored in browser localStorage.
 */

export type EdgeStyle = 'bezier' | 'smoothstep' | 'step' | 'straight';

export interface DiagramSettings {
  edgeStyle: EdgeStyle;
}

const KEY = 'aas.diagram.settings.v1';

export const defaultDiagramSettings: DiagramSettings = {
  edgeStyle: 'smoothstep',
};

export function loadDiagramSettings(): DiagramSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultDiagramSettings;
    const parsed = JSON.parse(raw) as Partial<DiagramSettings>;
    return {
      edgeStyle: parsed.edgeStyle ?? defaultDiagramSettings.edgeStyle,
    };
  } catch {
    return defaultDiagramSettings;
  }
}

export function saveDiagramSettings(s: DiagramSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
  // Notify listeners (DeletableEdge, etc.) so they re-render immediately.
  window.dispatchEvent(new CustomEvent('aas:diagram-settings-changed'));
}
