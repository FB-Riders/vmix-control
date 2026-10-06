export const pad = (n: number) => String(n).padStart(2, '0');

/** Seconds as mm:ss, or h:mm:ss from one hour up. */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const rest = `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return s >= 3600 ? `${Math.floor(s / 3600)}:${rest}` : rest;
}

export const offsetLabel = (sec: number) => (sec < 0 ? '−' : '') + mmss(Math.abs(sec));

export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function hhmmss(ms: number): string {
  const d = new Date(ms);
  return `${hhmm(ms)}:${pad(d.getSeconds())}`;
}
