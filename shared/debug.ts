// What GET /api/debug returns: a look inside the panel for troubleshooting on match day.

export type DebugKind = 'action' | 'vmix' | 'sound' | 'sequence' | 'error';

export interface DebugEntry {
  t: number; // epoch ms
  kind: DebugKind;
  text: string;
}

export interface DebugInfo {
  now: number;
  status: { label: string; value: string }[]; // what the panel currently believes
  log: DebugEntry[]; // oldest first
}
