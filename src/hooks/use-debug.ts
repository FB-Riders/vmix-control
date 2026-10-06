import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DebugInfo } from '@shared/debug';

// Whether the debug bar is open: remembered per device, and switched on by "?debug" in the address.
const KEY = 'regie-debug';
const listeners = new Set<() => void>();
let open = new URLSearchParams(window.location.search).has('debug') || window.localStorage.getItem(KEY) === '1';

export function setDebugOpen(next: boolean): void {
  open = next;
  window.localStorage.setItem(KEY, next ? '1' : '0');
  listeners.forEach((fn) => fn());
}

export function useDebugOpen(): boolean {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => open);
}

/** The panel's debug information, refreshed every second while `active`. */
export function useDebugInfo(active: boolean): DebugInfo | null {
  const [info, setInfo] = useState<DebugInfo | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const load = () => fetch('/api/debug').then((r) => r.json() as Promise<DebugInfo>).then((d) => { if (!stopped) setInfo(d); }).catch(() => {});
    load();
    const id = setInterval(load, 1000);
    return () => { stopped = true; clearInterval(id); };
  }, [active]);
  return info;
}
