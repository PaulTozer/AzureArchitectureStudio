// Azure OpenAI client settings stored in browser localStorage so secrets never live in source.
// The user enters them via the Settings dialog (gear icon in the top menu).

export interface OpenAISettings {
  endpoint: string;
  deployment: string;
  apiKey: string;
}

const STORAGE_KEY = 'aas.openai.settings.v1';

export const emptyOpenAISettings: OpenAISettings = {
  endpoint: '',
  deployment: '',
  apiKey: '',
};

export function loadOpenAISettings(): OpenAISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...emptyOpenAISettings };
    const parsed = JSON.parse(raw) as Partial<OpenAISettings>;
    return {
      endpoint: parsed.endpoint ?? '',
      deployment: parsed.deployment ?? '',
      apiKey: parsed.apiKey ?? '',
    };
  } catch {
    return { ...emptyOpenAISettings };
  }
}

export function saveOpenAISettings(settings: OpenAISettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota exceeded or storage disabled — silently ignore
  }
}

export function clearOpenAISettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isOpenAIConfigured(s: OpenAISettings): boolean {
  return !!(s.endpoint && s.deployment && s.apiKey);
}
