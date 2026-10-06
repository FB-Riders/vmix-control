// Thin client for the vMix HTTP Web API (https://www.vmix.com/help29/DeveloperAPI.html).
// GET /api/ returns the state XML; GET /api/?Function=...&Input=...&Value=... runs a shortcut function.

export interface VmixInput {
  key: string;
  number: number;
  type: string;
  title: string;
  state: string; // Running, Paused, Completed
  duration: number; // ms, 0 for live sources
  position: number; // ms into the clip
  fields: Record<string, string>; // title text fields by name, e.g. "Score.Text"
  replay: Record<string, string> | null; // attributes of <replay>, only on the Replay input
  muted: boolean;
  meter: number; // linear amplitude 0..1, louder of both channels
}

export interface VmixState {
  version: string;
  inputs: VmixInput[];
  overlays: Record<number, number>; // overlay channel -> input number (0 = empty)
  active: number;
  preview: number;
  streaming: boolean;
  recording: boolean;
  masterMeter: number | null; // linear amplitude 0..1 of the master bus, null if vMix does not report it
}

export type VmixParams = Record<string, string | number | undefined>;

export class VmixError extends Error {}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

function attrs(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = decode(m[2]);
  return o;
}

export function parseVmix(xml: string): VmixState {
  const flag = (tag: string) => new RegExp(`<${tag}\\b[^>]*>\\s*True`, 'i').test(xml);
  const num = (tag: string) => Number(xml.match(new RegExp(`<${tag}>(\\d+)<`))?.[1] ?? 0);

  const inputs: VmixInput[] = [];
  for (const m of xml.matchAll(/<input\b([^>]*?)(?:\/>|>([\s\S]*?)<\/input>)/g)) {
    const a = attrs(m[1]);
    const body = m[2] ?? '';
    const fields: Record<string, string> = {};
    for (const t of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) fields[attrs(t[1]).name] = decode(t[2]);
    const rp = body.match(/<replay\b([^>]*?)\/?>/);
    inputs.push({ key: a.key, number: Number(a.number), type: a.type, title: a.title, state: a.state ?? '', duration: Number(a.duration) || 0, position: Number(a.position) || 0, fields, replay: rp ? attrs(rp[1]) : null,
      muted: a.muted === 'True',
      meter: Math.max(Number(a.meterF1) || 0, Number(a.meterF2) || 0),
    });
  }

  const overlays: Record<number, number> = {};
  for (const m of xml.matchAll(/<overlay number="(\d+)"[^>]*?(?:\/>|>(\d*)<\/overlay>)/g)) overlays[Number(m[1])] = Number(m[2] || 0);

  const master = xml.match(/<master\b([^>]*?)\/?>/);
  const m = master ? attrs(master[1]) : null;

  return {
    masterMeter: m ? (m.muted === 'True' ? 0 : Math.max(Number(m.meterF1) || 0, Number(m.meterF2) || 0)) : null,
    version: xml.match(/<version>([^<]*)</)?.[1] ?? '',
    inputs, overlays,
    active: num('active'), preview: num('preview'),
    streaming: flag('streaming'), recording: flag('recording'),
  };
}

export class VmixClient {
  constructor(private readonly baseUrl: string) {}

  private async get(params?: VmixParams): Promise<string> {
    const qs = params
      ? '?' + Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
      : '';
    const res = await fetch(this.baseUrl + qs, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new VmixError(`vMix lehnt ${params?.Function ?? 'Abfrage'} ab (${res.status})`);
    return res.text();
  }

  async state(): Promise<VmixState> {
    return parseVmix(await this.get());
  }

  async call(params: VmixParams): Promise<void> {
    await this.get(params);
  }
}
