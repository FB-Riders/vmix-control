import type { Config } from './config';
import type { VmixState } from './vmix';

interface Airing {
  input: string; // title of the input that went on air
  at: number;
  schedule: string; // run-down active at that moment ...
  round: number; // ... and how many times it had been started today
}

/** What happened during today's stream, kept across restarts. Feeds the controlling list. */
export interface MatchLog {
  day: string;
  streamFirstAt: number | null;
  streamEndAt: number | null;
  streamStarts: number;
  streamSec: number;
  logoSec: number;
  holes: number; // audio drop-outs of 2 s or more
  stalls: number; // a clip that had stopped was on air
  airings: Airing[];
}

export interface MonitorContext {
  now: number;
  logosVisible: boolean | null; // null = no logos configured
  audioPaused: boolean; // sources muted on purpose (break)
  schedule: string;
  round: number;
}

interface Sample { t: number; master: number | null; sources: Record<string, number> }

const WINDOW_MS = 30_000;
const SILENCE = 0.001; // -60 dB
const HOLE_MS = 2000;
const STALL_MS = 1500;
const CLIP_TYPES = ['Video', 'VideoList'];
const today = () => new Date().toDateString();

export const emptyLog = (): MatchLog => ({ day: today(), streamFirstAt: null, streamEndAt: null, streamStarts: 0, streamSec: 0, logoSec: 0, holes: 0, stalls: 0, airings: [] });

// Mean power of amplitude samples in dB; quiet samples are left out, as loudness meters do.
function meanDb(amplitudes: number[]): number | null {
  const loud = amplitudes.filter((a) => a > SILENCE);
  if (loud.length < 8) return null;
  return 10 * Math.log10(loud.reduce((sum, a) => sum + a * a, 0) / loud.length);
}

/** Watches the vMix state while streaming: audio level and drop-outs, logos, stalled clips, what went on air. */
export class Monitor {
  log: MatchLog;
  dirty = false;
  private samples: Sample[] = [];
  private lastT = 0;
  private wasStreaming = false;
  private lastActive = 0;
  private silentSince = 0;
  private holeOpen = false;
  private stalledSince = 0;
  private stallOpen = false;
  private hasMaster = false;

  constructor(private readonly cfg: Config, saved?: MatchLog) {
    this.log = saved?.day === today() ? saved : emptyLog();
  }

  update(vm: VmixState, ctx: MonitorContext): void {
    const { now } = ctx;
    const dt = this.lastT ? Math.min(now - this.lastT, 5000) / 1000 : 0;
    this.lastT = now;
    this.hasMaster = vm.masterMeter !== null;
    if (this.log.day !== today()) { this.log = emptyLog(); this.dirty = true; }
    const log = this.log;

    const sources: Record<string, number> = {};
    for (const s of this.cfg.audio?.sources ?? []) {
      const inp = vm.inputs.find((i) => i.title === s.input || i.key === s.input);
      if (inp && !inp.muted) sources[s.id] = inp.meter;
    }
    this.samples.push({ t: now, master: vm.masterMeter, sources });
    while (this.samples.length && this.samples[0].t < now - WINDOW_MS) this.samples.shift();

    if (vm.streaming && !this.wasStreaming) {
      log.streamFirstAt ??= now;
      log.streamStarts++;
      log.streamEndAt = null;
      this.dirty = true;
    }
    if (!vm.streaming && this.wasStreaming) { log.streamEndAt = now; this.dirty = true; }
    this.wasStreaming = vm.streaming;
    if (!vm.streaming) { this.silentSince = 0; this.stalledSince = 0; this.lastActive = vm.active; return; }

    log.streamSec += dt;
    if (ctx.logosVisible) log.logoSec += dt;

    const active = vm.inputs.find((i) => i.number === vm.active);
    if (active && vm.active !== this.lastActive) {
      log.airings = [...log.airings, { input: active.title, at: now, schedule: ctx.schedule, round: ctx.round }].slice(-500);
      this.dirty = true;
    }
    this.lastActive = vm.active;

    // Audio drop-out: master silent for 2 s although the audio is not muted on purpose.
    const silent = vm.masterMeter !== null && vm.masterMeter < SILENCE && !ctx.audioPaused;
    this.silentSince = silent ? this.silentSince || now : 0;
    const hole = silent && now - this.silentSince >= HOLE_MS;
    if (hole && !this.holeOpen) { log.holes++; this.dirty = true; }
    this.holeOpen = hole;

    // A clip on air that is not playing: frozen or black picture.
    const stalled = !!active && CLIP_TYPES.includes(active.type) && active.state !== 'Running';
    this.stalledSince = stalled ? this.stalledSince || now : 0;
    const stall = stalled && now - this.stalledSince >= STALL_MS;
    if (stall && !this.stallOpen) { log.stalls++; this.dirty = true; }
    this.stallOpen = stall;
  }

  /** Rough loudness of the last 30 s from the master meter. An estimate, not a true LUFS measurement. */
  loudness(): number | null {
    const db = meanDb(this.samples.flatMap((s) => (s.master !== null ? [s.master] : [])));
    return db === null ? null : Math.round((db + (this.cfg.audio?.loudnessOffset ?? 0)) * 10) / 10;
  }

  /** How many dB the commentary sits above the atmo, from the two source meters. */
  commentaryOverAtmo(): number | null {
    const level = (role: 'commentary' | 'atmo') => {
      const src = this.cfg.audio?.sources.find((s) => s.role === role);
      return src ? meanDb(this.samples.flatMap((s) => (s.sources[src.id] !== undefined ? [s.sources[src.id]] : []))) : null;
    };
    const c = level('commentary');
    const a = level('atmo');
    return c === null || a === null ? null : Math.round(c - a);
  }

  loudnessOk(): boolean {
    const loud = this.loudness();
    const a = this.cfg.audio;
    return loud === null || !a || Math.abs(loud - a.loudnessTarget) <= a.loudnessTolerance;
  }

  watches(hasLogos: boolean): string[] {
    const a = this.cfg.audio;
    return [
      ...(this.hasMaster ? ['Tonloch > 2 s'] : []),
      ...(this.hasMaster && a ? [`Lautheit ausserhalb ${a.loudnessTarget} ±${a.loudnessTolerance} (geschätzt)`] : []),
      ...(hasLogos ? ['Liga-Logos fehlen'] : []),
      'Einspieler steht auf Sendung',
    ];
  }

  alerts(ctx: MonitorContext): string[] {
    if (!this.wasStreaming) return [];
    const loud = this.loudness();
    const a = this.cfg.audio;
    return [
      ...(this.holeOpen ? ['TONLOCH: kein Ton auf dem Master'] : []),
      ...(!this.holeOpen && !ctx.audioPaused && loud !== null && a && !this.loudnessOk()
        ? [`Ton ${loud > a.loudnessTarget ? 'zu laut' : 'zu leise'}: ≈ ${loud} statt ${a.loudnessTarget} LUFS`] : []),
      ...(ctx.logosVisible === false ? ['Liga-Logos nicht eingeblendet'] : []),
      ...(this.stallOpen ? ['Einspieler auf Sendung steht (Standbild oder schwarz)'] : []),
    ];
  }
}
