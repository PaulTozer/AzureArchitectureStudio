/**
 * Diagram-related visual settings stored in browser localStorage.
 */

import { useSyncExternalStore } from 'react';

export type EdgeStyle = 'bezier' | 'smoothstep' | 'step' | 'straight';

export interface DiagramSettings {
  edgeStyle: EdgeStyle;
  colorMode: 'light' | 'dark' | 'system';
}

const KEY = 'aas.diagram.settings.v1';

export const defaultDiagramSettings: DiagramSettings = {
  edgeStyle: 'smoothstep',
  colorMode: 'light',
};

export function loadDiagramSettings(): DiagramSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultDiagramSettings;
    const parsed = JSON.parse(raw) as Partial<DiagramSettings>;
    return {
      edgeStyle: parsed.edgeStyle ?? defaultDiagramSettings.edgeStyle,
      colorMode: parsed.colorMode === 'dark' || parsed.colorMode === 'system' ? parsed.colorMode : 'light',
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

function subscribeToSettings(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener('aas:diagram-settings-changed', listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('aas:diagram-settings-changed', listener);
    window.removeEventListener('storage', onStorage);
  };
}

function subscribeToSystemTheme(listener: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

export function useColorMode(): 'light' | 'dark' {
  const preference = useSyncExternalStore<DiagramSettings['colorMode']>(subscribeToSettings, () => loadDiagramSettings().colorMode, () => 'light');
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, () => window.matchMedia('(prefers-color-scheme: dark)').matches, () => false);
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}
