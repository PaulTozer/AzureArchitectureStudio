/**
 * Lightweight diagnostic logger. Enabled by default for the subnet-edit
 * investigation. Disable from devtools console with:
 *   window.__AAS_DEBUG__ = false
 */
declare global {
  interface Window {
    __AAS_DEBUG__?: boolean;
  }
}

export function dbg(tag: string, ...args: unknown[]): void {
  try {
    if (typeof window !== 'undefined' && window.__AAS_DEBUG__ === false) return;
  } catch {
    // ignore
  }
  // eslint-disable-next-line no-console
  console.log(`%c[${tag}]`, 'color:#7a3; font-weight:bold', ...args);
}
