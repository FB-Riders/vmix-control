import fs from 'node:fs';
import path from 'node:path';
import type { ActionInput, ActionName, ActionResult } from '../shared/actions';
import type { ControllingItem, PanelState, ScheduleState, Score, SimState, Tick, VideoState } from '../shared/state';
import type { Config, VmixCall } from './config';
import { emptyLog, type MatchLog, Monitor, type MonitorContext } from './monitor';
import { type VmixClient, VmixError, type VmixInput, type VmixState } from './vmix';

export class PanelError extends Error {}

interface StoredReplay {
  id: number;
  time: string;
  period: string;
  cams: string[];
  type: string;
  fav: boolean;
  copied: boolean; // already in vMix's highlight event list
}

interface ScheduleStore {
  id: string;
  anchors: Record<string, number>; // zero point per run-down, epoch ms
  rounds: Record<string, number>; // how often each run-down was started today
}

interface Persisted {
  day?: string;
  replays?: StoredReplay[];
  nextId?: number;
  schedule?: ScheduleStore;
  ticks?: Record<string, boolean>;
  log?: MatchLog;
  recordGame?: boolean;
}

type Handlers = { [K in ActionName]: (input: ActionInput<K>) => Promise<ActionResult<K>> };
type Snapshot = Omit<PanelState, 'now'>;

const AUTO_WINDOW_MS = 4000; // an automatic step that is later than this is skipped, not caught up
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toDateString();
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const errorText = (e: unknown) => (e instanceof PanelError || e instanceof VmixError ? e.message : 'vMix nicht erreichbar');

function todayAt(time: string): number {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.getTime();
}

// "-14:30" -> -870 seconds
function offsetSec(at: string): number {
  const s = at.trim().replace('−', '-');
  const p = s.replace(/^[-+]/, '').split(':').map(Number);
  const v = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] || 0);
  return s.startsWith('-') ? -v : v;
}

// vMix meters are linear amplitude; show them on a 60 dB scale like an audio mixer does.
function meterLevel(amplitude: number): number {
  if (amplitude <= 0) return 0;
  const level = (20 * Math.log10(amplitude) + 60) / 60;
  return Math.round(Math.min(1, Math.max(0, level)) * 50) / 50;
}

/** Holds everything the clients share and turns their actions into vMix API calls. */
export class Panel {
  private vm: VmixState | null = null; // null while vMix is unreachable
  private replays: StoredReplay[] = []; // newest first
  private nextId = 1;
  private playing: { id: number | null; since: number; seen: boolean } | null = null; // id null = highlight reel
  private clockHidden = false; // scoreboard overlay taken off for a replay, to be restored
  private hiddenOverlays: { channel: number; input: string }[] = []; // taken off for the highlights, to be restored
  private musicOn = false; // highlight music started by the panel, to be stopped when the reel is over
  private holdOverlays = false; // highlight video: overlays stay off for the whole recording, not only the scenes
  private onHighlightList = false; // vMix currently shows the highlight event list instead of the main one
  private sponsor = { enabled: false, nextAt: 0, activeUntil: 0, rotation: 0 };
  private schedule: ScheduleStore;
  private autoRun = true;
  private recordGame: boolean; // record the game locally when the stream is started
  private fired = new Set<string>(); // automatic steps already handled
  private sim: (SimState & { schedule: string }) | null = null;
  private ticks: Record<string, boolean> = {};
  private video = { status: 'idle' as VideoState['status'], step: 0, speed: 100 };
  private notice: { text: string; until: number } | null = null; // a background sequence failed
  private readonly monitor: Monitor;
  private listeners = new Set<(state: PanelState) => void>();
  private lastSent = '';
  private lastSaved = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly dataFile: string;

  constructor(private readonly cfg: Config, private readonly vmix: VmixClient, root: string) {
    this.dataFile = path.join(root, 'data', 'state.json');
    let saved: Persisted = {};
    try { saved = JSON.parse(fs.readFileSync(this.dataFile, 'utf8')) as Persisted; } catch { /* first start */ }
    const sameDay = saved.day === today();
    if (saved.replays?.every((r) => Array.isArray(r.cams))) {
      this.replays = saved.replays;
      this.nextId = saved.nextId ?? 1;
    }
    const s = sameDay ? saved.schedule : undefined;
    this.schedule = s?.anchors && cfg.schedules.some((x) => x.id === s.id) ? s : { id: cfg.schedules[0].id, anchors: {}, rounds: {} };
    if (sameDay) this.ticks = saved.ticks ?? {};
    this.recordGame = saved.recordGame ?? cfg.preGame.recordGame;
    this.monitor = new Monitor(cfg, saved.log);
    this.video.speed = cfg.postGame.highlightVideo?.speeds.at(-1) ?? 100;
  }

  get vmixState(): VmixState | null { return this.vm; }

  start(pollMs: number): void {
    setInterval(() => void this.poll(), pollMs);
    setInterval(() => this.broadcast(true), 15000); // keeps client clocks in sync and connections alive
  }

  subscribe(fn: (state: PanelState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state());
    return () => { this.listeners.delete(fn); };
  }

  /** vMix work runs one piece after another: several pieces are multi-step sequences on vMix's selected replay event. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Long sequences (clips, waits) run beside the queue so the operator can keep cutting; failures show up as an alert. */
  private background(label: string, fn: () => Promise<void>): void {
    fn().catch((e) => { this.notice = { text: `${label}: ${errorText(e)}`, until: Date.now() + 60_000 }; this.broadcast(); });
  }

  async dispatch<K extends ActionName>(name: K, input: ActionInput<K>): Promise<ActionResult<K>> {
    const result = await this.exclusive(() => this.handlers[name](input));
    await this.poll();
    return result;
  }

  // ---------- vMix state ----------

  async poll(): Promise<void> {
    try {
      this.vm = await this.vmix.state();
    } catch {
      this.vm = null;
    }
    const now = Date.now();

    if (this.vm) {
      if (this.playing) {
        const onAir = this.activeInput()?.type === 'Replay';
        if (onAir) this.playing.seen = true;
        else if (this.playing.seen || now - this.playing.since > 8000) {
          this.playing = null;
          this.exclusive(() => this.afterPlayback()).catch(() => {});
        }
      }
      const highlightsOnAir = this.playing?.id === null; // no sponsor overlay over the highlights
      if (this.sponsor.enabled && now >= this.sponsor.nextAt && !highlightsOnAir) this.showSponsor().catch(() => {});
      this.monitor.update(this.vm, this.monitorContext(now));
      this.runDueSteps(now);
    }
    if (this.notice && now > this.notice.until) this.notice = null;
    if (this.monitor.dirty || now - this.lastSaved > 20_000) this.persist();
    this.broadcast();
  }

  private runDueSteps(now: number): void {
    if (this.sim?.running) return; // the test run triggers the steps itself
    const sc = this.scheduleCfg();
    const anchor = this.anchor();
    sc.steps.forEach((step, i) => {
      const due = anchor + offsetSec(step.at) * 1000;
      const key = `${sc.id}:${anchor}:${i}`;
      if (!step.action?.auto || now < due || this.fired.has(key)) return;
      this.fired.add(key);
      const { action } = step;
      if (this.autoRun && this.vm?.streaming && now - due < AUTO_WINDOW_MS) this.background(step.label, () => this.run(action.calls));
    });
  }

  private monitorContext(now: number): MonitorContext {
    const sources = this.audioSources();
    return {
      now,
      logosVisible: this.cfg.logos.length ? this.logoStates().every((l) => l.visible) : null,
      audioPaused: sources.length > 0 && sources.every((s) => !s.on),
      schedule: this.schedule.id,
      round: this.schedule.rounds[this.schedule.id] ?? 0,
    };
  }

  private findInput(ref: string | number | undefined): VmixInput | null {
    if (!this.vm || ref === undefined || ref === '') return null;
    const inputs = this.vm.inputs;
    // vMix renames a disconnected device to "Offline - <name>"; it is still the same input.
    return inputs.find((i) => i.title === ref) ?? inputs.find((i) => i.title === `Offline - ${ref}`) ?? inputs.find((i) => i.key === ref)
      ?? (/^\d+$/.test(String(ref)) ? inputs.find((i) => i.number === Number(ref)) : undefined) ?? null;
  }

  // Prefer the GUID so a renamed or moved input still resolves within a session.
  private ref(input: string | number): string | number { return this.findInput(input)?.key ?? input; }
  private activeInput() { return this.vm?.inputs.find((i) => i.number === this.vm?.active); }
  private replayInput() { return this.vm?.inputs.find((i) => i.type === 'Replay'); }
  private replayRecording() { return this.replayInput()?.replay?.recording === 'True'; }

  private scheduleCfg(id = this.schedule.id) { return this.cfg.schedules.find((s) => s.id === id) ?? this.cfg.schedules[0]; }

  private anchor(id = this.schedule.id): number {
    return this.schedule.anchors[id] ?? todayAt(this.scheduleCfg(id).anchorTime ?? this.cfg.schedules[0].anchorTime ?? '20:00');
  }

  private kickoff(): number { return this.anchor(this.cfg.schedules[0].id); }

  private score(): Score | null {
    const sb = this.cfg.scoreboard;
    const inp = sb && this.findInput(sb.input);
    if (!sb || !inp) return null;
    const f = (name: string) => (name ? inp.fields[name]?.trim() ?? '' : '');
    const names = [f(sb.homeName), f(sb.awayName)];
    const period = f(sb.period);
    const clock = [sb.clock].flat().map(f).join('');
    return { home: f(sb.home), away: f(sb.away), period: period && sb.periodFormat.replace('{}', period), clock, teams: names.every(Boolean) ? names.join(' – ') : '' };
  }

  private isHighlight(r: StoredReplay): boolean {
    return r.fav || this.cfg.replay.autoHighlightTypes.includes(r.type);
  }

  private highlights(): StoredReplay[] { return this.replays.filter((r) => this.isHighlight(r)); }

  private audioSources() {
    return (this.cfg.audio?.sources ?? []).map(({ id, name, short, input }) => {
      const inp = this.findInput(input);
      const on = !!inp && inp.type !== 'Placeholder' && !inp.muted; // a placeholder is a device that is not connected
      return { id, name, short, on, level: on && inp ? meterLevel(inp.meter) : 0 };
    });
  }

  private logoStates() {
    return this.cfg.logos.map((l) => {
      const inp = this.findInput(l.input);
      return { name: l.name, visible: !!inp && this.vm?.overlays[l.overlay] === inp.number };
    });
  }

  private warnings(): string[] {
    if (!this.vm) return [];
    const { cfg } = this;
    const w: string[] = [];
    const need = (ref: string | number | undefined, what: string) => {
      if (ref !== undefined && ref !== '' && !this.findInput(ref)) w.push(`${what}: Input «${ref}» nicht in vMix gefunden`);
    };
    const needCalls = (calls: VmixCall[], what: string) => {
      const refs = calls.flatMap((c) => ('Input' in c && c.Input !== undefined ? [c.Input] : []));
      new Set(refs).forEach((i) => need(i, what));
    };
    cfg.cams.forEach((c) => need(c.input, `CAM ${c.id}`));
    need(cfg.scoreboard?.input, 'Scoreboard');
    cfg.audio?.sources.forEach((s) => need(s.input, `Ton ${s.short}`));
    cfg.sponsor?.inputs.forEach((i) => need(i, 'Sponsor'));
    cfg.logos.forEach((l) => need(l.input, l.name));
    need(cfg.replay.highlightMusic, 'Highlight-Musik');
    for (const s of cfg.schedules) {
      if (s.start) needCalls(s.start.calls, s.start.label);
      for (const step of s.steps) if (step.action) needCalls(step.action.calls, step.label);
    }
    if (cfg.postGame.finish) needCalls(cfg.postGame.finish.calls, cfg.postGame.finish.label);
    cfg.postGame.highlightVideo?.template.forEach((t) => { if ('input' in t) need(t.input, 'Highlight-Video'); });
    cfg.controlling.forEach((c) => need(c.input, 'Controlling'));
    if (!this.replayInput()) w.push('Kein Replay-Input in vMix gefunden');
    return [...new Set(w)];
  }

  // ---------- state for the clients ----------

  private tick(id: string, title: string, sub: string, auto?: boolean): Tick {
    return { id, title, sub, done: auto ?? !!this.ticks[id], auto: auto !== undefined };
  }

  private checklist(): Tick[] {
    return this.cfg.preGame.checklist.filter((c) => c.onlyIf !== 'recordGame' || this.recordGame).map((c) => {
      const auto = c.auto === 'cams' ? this.cfg.cams.every((cam) => !!this.findInput(cam.input))
        : c.auto === 'logos' ? this.cfg.logos.length > 0 && this.logoStates().every((l) => l.visible)
        : undefined;
      return this.tick(`check:${c.id}`, c.title, c.sub, auto);
    });
  }

  private controlling(): ControllingItem[] {
    const { log } = this.monitor;
    const kickoff = this.kickoff();
    return this.cfg.controlling.map((c): ControllingItem => {
      const item = (ok: boolean, info = '') => ({ label: c.label, info, ok, post: c.post });
      switch (c.check) {
        case 'streamLead':
          return item(log.streamFirstAt !== null && log.streamFirstAt <= kickoff - (c.minutes ?? 15) * 60_000, log.streamFirstAt ? hhmm(log.streamFirstAt) : '');
        case 'onAir': {
          const title = this.findInput(c.input)?.title ?? c.input;
          const hit = log.airings.find((a) => a.input === title && (!c.schedule || a.schedule === c.schedule) && (!c.round || a.round === c.round));
          return item(!!hit, hit ? hhmm(hit.at) : '');
        }
        case 'logos': {
          const pct = log.streamSec > 0 ? Math.round((log.logoSec / log.streamSec) * 100) : 0;
          return item(log.streamSec > 0 && pct >= 99, log.streamSec > 0 ? `${pct} %` : '');
        }
        case 'audio':
          return item(log.streamSec > 0 && log.holes === 0 && this.monitor.loudnessOk(), log.streamSec > 0 ? `${log.holes} ${log.holes === 1 ? 'Loch' : 'Löcher'}` : '');
        case 'stalls':
          return item(log.streamSec > 0 && log.stalls === 0, log.streamSec > 0 ? String(log.stalls) : '');
        case 'noInterruption':
          return item(log.streamStarts === 1, log.streamStarts > 1 ? `${log.streamStarts - 1} Unterbruch` : '');
        case 'videoExported':
          return item(this.video.status === 'done');
        case 'ticks':
          return item((c.ids ?? []).length > 0 && (c.ids ?? []).every((id) => this.ticks[id]));
      }
    });
  }

  private clipSeconds(item: { input: string; seconds?: number }): number {
    return item.seconds ?? (Math.round((this.findInput(item.input)?.duration ?? 0) / 1000) || 10);
  }

  private videoState(): VideoState | null {
    const hv = this.cfg.postGame.highlightVideo;
    if (!hv) return null;
    const scenes = this.highlights();
    const goals = scenes.filter((r) => this.cfg.replay.autoHighlightTypes.includes(r.type)).length;
    const sceneSec = Math.round(scenes.reduce((sum, r) => sum + this.cfg.replay.seconds * r.cams.length, 0) / (this.video.speed / 100));
    const timeline = hv.template.map((t) => ('input' in t
      ? { title: t.title, note: t.required ? 'fest, Pflicht' : 'fest', seconds: this.clipSeconds(t), required: t.required }
      : { title: `${scenes.length} Szenen aus der Playlist`, note: `${goals} Tore + ${scenes.length - goals} ★`, seconds: sceneSec, required: false }));
    const end = this.monitor.log.streamEndAt;
    return {
      status: this.video.status, step: this.video.step, speed: this.video.speed, speeds: hv.speeds,
      scenes: scenes.length, goals,
      totalSec: timeline.reduce((sum, t) => sum + t.seconds, 0),
      targetMinutes: hv.targetMinutes,
      timeline,
      uploadBy: end ? end + 4 * 3600_000 : null,
      uploaded: this.tick('video:uploaded', 'Im Hub hochgeladen', ''),
    };
  }

  private scheduleView(sc: Config['schedules'][number]): ScheduleState {
    const { cfg } = this;
    return {
      id: sc.id, title: sc.title, anchorLabel: sc.anchorLabel, anchor: this.anchor(sc.id),
      steps: sc.steps.map((s) => ({
        offset: offsetSec(s.at), label: s.label, sub: s.sub, tag: s.tag || (s.action?.auto ? 'auto' : ''), auto: !!s.action?.auto,
        hero: s.hero ?? s.label, durationSec: s.durationSec ?? 0, action: s.action?.label ?? null,
      })),
      all: cfg.schedules.map(({ id, title, anchorLabel }) => ({ id, title, anchorLabel })),
      starts: cfg.schedules.flatMap((x) => (x.start ? [{ id: x.id, label: x.start.label, sub: x.start.sub, note: x.start.note }] : [])),
      start: sc.start ? { label: sc.start.label, sub: sc.start.sub, note: sc.start.note, minutes: sc.start.minutes } : null,
      autoRun: this.autoRun,
      sim: this.sim?.schedule === sc.id ? { running: this.sim.running, step: this.sim.step, results: this.sim.results } : null,
    };
  }

  private snapshot(): Snapshot {
    const { cfg, vm } = this;
    const now = Date.now();
    const active = this.activeInput();
    const preview = vm?.inputs.find((i) => i.number === vm.preview);
    const sc = this.scheduleCfg();
    const breakCfg = cfg.schedules.find((x) => x.start);
    const sources = this.audioSources();
    const logos = this.logoStates();
    const ctx = this.monitorContext(now);
    const kickoff = this.kickoff();
    return {
      connected: !!vm,
      streaming: !!vm?.streaming,
      recording: !!vm?.recording,
      replayRecording: this.replayRecording(),
      programTitle: active?.title ?? '',
      cams: cfg.cams.map((c) => {
        const inp = this.findInput(c.input);
        return { id: c.id, role: c.role, program: !!inp && inp === active, preview: !!inp && inp === preview };
      }),
      score: this.score(),
      replay: {
        seconds: cfg.replay.seconds,
        types: cfg.replay.types,
        defaultType: cfg.replay.defaultType,
        cams: cfg.cams.map((c) => c.id),
        marks: cfg.replay.marks.map(({ id, label, sub, cams }) => ({ id, label, sub, cams })),
        list: this.replays.map((r) => ({
          id: r.id, time: r.time, period: r.period, type: r.type, cams: r.cams,
          highlight: this.isHighlight(r),
          locked: cfg.replay.autoHighlightTypes.includes(r.type),
          playing: this.playing?.id === r.id,
        })),
        highlightCount: this.highlights().length,
      },
      audio: sources.length
        ? { sources, preset: sources.every((s) => s.on) ? 'game' : sources.every((s) => !s.on) ? 'pause' : null }
        : null,
      sponsor: cfg.sponsor?.inputs.length
        ? { enabled: this.sponsor.enabled, nextAt: this.sponsor.nextAt, activeUntil: this.sponsor.activeUntil, intervalSec: cfg.sponsor.intervalSec, durationSec: cfg.sponsor.durationSec }
        : null,
      logos: logos.length ? { visible: logos.every((l) => l.visible) } : null,
      health: {
        watches: this.monitor.watches(logos.length > 0),
        // The logos being off during the highlights is intended, so it raises no alarm (it still counts in the controlling).
        alerts: [
          ...(this.notice ? [this.notice.text] : []),
          ...(vm?.streaming && !this.replayRecording() ? ['Replay-Aufnahme läuft nicht: keine Replays möglich'] : []),
          ...(vm ? this.monitor.alerts(this.hiddenOverlays.length ? { ...ctx, logosVisible: null } : ctx) : []),
        ],
        loudness: vm?.streaming || sources.some((s) => s.on) ? this.monitor.loudness() : null,
        loudnessTarget: cfg.audio?.loudnessTarget ?? -16,
        commentaryOverAtmo: this.monitor.commentaryOverAtmo(),
        commentaryTarget: cfg.audio?.commentaryOverAtmo ?? 10,
      },
      controlling: this.controlling(),
      pre: {
        kickoff,
        streamBy: kickoff - cfg.preGame.streamLeadMinutes * 60_000,
        recordGame: this.recordGame,
        reminder: cfg.preGame.reminder,
        emergency: cfg.preGame.emergency ?? null,
        checklist: this.checklist(),
      },
      post: {
        steps: cfg.postGame.steps.map((s) => this.tick(`post:${s.id}`, s.title, s.info)),
        finish: cfg.postGame.finish ? { label: cfg.postGame.finish.label, sub: cfg.postGame.finish.sub } : null,
        interviews: cfg.postGame.interviews.map((i) => this.tick(`iv:${i.id}`, i.title, i.sub)),
        video: this.videoState(),
      },
      schedule: this.scheduleView(sc),
      preRundown: this.scheduleView(cfg.schedules[0]),
      breakRundown: breakCfg ? this.scheduleView(breakCfg) : null,
      warnings: this.warnings(),
    };
  }

  state(): PanelState {
    return { now: Date.now(), ...this.snapshot() };
  }

  private broadcast(force = false): void {
    const snap = this.snapshot();
    const body = JSON.stringify(snap);
    if (!force && body === this.lastSent) return;
    this.lastSent = body;
    const state = { now: Date.now(), ...snap };
    this.listeners.forEach((fn) => fn(state));
  }

  private persist(): void {
    const data: Persisted = { day: today(), replays: this.replays, nextId: this.nextId, schedule: this.schedule, ticks: this.ticks, log: this.monitor.log, recordGame: this.recordGame };
    this.monitor.dirty = false;
    this.lastSaved = Date.now();
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    fs.writeFileSync(this.dataFile, JSON.stringify(data));
  }

  // ---------- building blocks ----------

  private cam(id: string) {
    const c = this.cfg.cams.find((x) => x.id === id);
    if (!c) throw new PanelError(`Unbekannte Kamera ${id}`);
    return c;
  }

  private entry(id: number): StoredReplay {
    const r = this.replays.find((x) => x.id === id);
    if (!r) throw new PanelError('Replay nicht gefunden');
    return r;
  }

  /** Runs a configured sequence. A failing call does not stop the rest (e.g. a missing clip must not keep the audio muted). */
  private async run(calls: VmixCall[], maxWaitMs = Infinity): Promise<void> {
    let failure: unknown;
    for (const c of calls) {
      try {
        if ('wait' in c) await sleep(Math.min(c.wait, maxWaitMs));
        else if ('panel' in c && c.panel === 'waitPlayback') await this.waitPlayback();
        else await this.exclusive(() => this.step(c));
      } catch (e) {
        failure ??= e;
      }
    }
    if (failure) throw failure;
  }

  private async step(c: Exclude<VmixCall, { wait: number }>): Promise<void> {
    if (!('panel' in c)) { await this.vmix.call(c.Input !== undefined ? { ...c, Input: this.ref(c.Input) } : c); return; }
    if (c.panel === 'playHighlights') await this.playHighlights();
    else if (c.panel === 'audioGame' || c.panel === 'audioPause') await this.setAudio(c.panel === 'audioGame');
    else if (c.panel === 'startAll') await this.setOutputs(true);
    else if (c.panel === 'stopAll') await this.setOutputs(false);
  }

  /** Stream, replay recording and (if wanted) the local recording together. Stopping always stops a running recording. */
  private async setOutputs(on: boolean): Promise<void> {
    if (!!this.vm?.streaming !== on) await this.vmix.call({ Function: on ? 'StartStreaming' : 'StopStreaming' });
    if (!!this.vm?.recording !== on && (this.recordGame || !on)) await this.vmix.call({ Function: on ? 'StartRecording' : 'StopRecording' });
    if (this.replayRecording() !== on) await this.vmix.call({ Function: on ? 'ReplayStartRecording' : 'ReplayStopRecording' });
  }

  private async setAudio(on: boolean, only?: string): Promise<void> {
    const sources = (this.cfg.audio?.sources ?? []).filter((s) => !only || s.id === only);
    if (!sources.length) throw new PanelError('Keine Tonquelle konfiguriert');
    let failure: unknown; // one source that is offline must not keep the others from switching
    for (const s of sources) {
      await this.vmix.call({ Function: on ? 'AudioOn' : 'AudioOff', Input: this.ref(s.input) }).catch((e) => { failure ??= e; });
    }
    if (failure) throw failure;
  }

  private async setLogos(on: boolean): Promise<void> {
    if (!this.cfg.logos.length) throw new PanelError('Kein Liga-Logo-Input konfiguriert');
    for (const l of this.cfg.logos) {
      await this.vmix.call(on ? { Function: `OverlayInput${l.overlay}In`, Input: this.ref(l.input) } : { Function: `OverlayInput${l.overlay}Out` });
    }
  }

  private async showSponsor(): Promise<void> {
    const sp = this.cfg.sponsor;
    if (!sp?.inputs.length) throw new PanelError('Kein Sponsor-Input konfiguriert');
    const now = Date.now();
    this.sponsor.nextAt = now + sp.intervalSec * 1000;
    const input = sp.inputs[this.sponsor.rotation++ % sp.inputs.length];
    await this.vmix.call({ Function: `OverlayInput${sp.overlay}In`, Input: this.ref(input) });
    this.sponsor.activeUntil = now + sp.durationSec * 1000;
    setTimeout(() => {
      this.sponsor.activeUntil = 0;
      this.vmix.call({ Function: `OverlayInput${sp.overlay}Out` }).catch(() => {});
    }, sp.durationSec * 1000);
  }

  private async ensureMainList(): Promise<void> {
    if (!this.onHighlightList) return;
    await this.vmix.call({ Function: `ReplaySelectEvents${this.cfg.replay.mainList}` });
    this.onHighlightList = false;
  }

  /**
   * Applies a replay function to one of our events. vMix does not report how many events its list holds, and has
   * "LastEvent" and "SelectedEvent" variants only. So an event is addressed by how many were marked after it:
   * select the last one and step back that many times. Holds as long as events are only created through the panel.
   */
  private async eventCall(r: StoredReplay, lastFn: string, selectedFn: string, value?: string | number): Promise<void> {
    await this.ensureMainList();
    const back = this.replays.filter((x) => x.id > r.id).length;
    if (back === 0) { await this.vmix.call({ Function: lastFn, Value: value }); return; }
    await this.vmix.call({ Function: 'ReplaySelectLastEvent' });
    for (let i = 0; i < back; i++) await this.vmix.call({ Function: 'ReplaySelectPreviousEvent' });
    await this.vmix.call({ Function: selectedFn, Value: value });
  }

  private async hideClock(): Promise<void> {
    const sb = this.cfg.scoreboard;
    const inp = this.findInput(sb?.input);
    if (!this.cfg.replay.hideScoreboard || !sb?.overlay || !inp || this.vm?.overlays[sb.overlay] !== inp.number) return;
    await this.vmix.call({ Function: `OverlayInput${sb.overlay}Out` });
    this.clockHidden = true;
  }

  /** Highlights run clean: every overlay channel, league logos included, goes off and comes back afterwards. */
  private async hideOverlays(): Promise<void> {
    for (const [channel, number] of Object.entries(this.vm?.overlays ?? {})) {
      const input = this.vm?.inputs.find((i) => i.number === number);
      if (!input) continue;
      await this.vmix.call({ Function: `OverlayInput${channel}Out` });
      this.hiddenOverlays.push({ channel: Number(channel), input: input.key });
    }
  }

  private async restoreOverlays(): Promise<void> {
    const hidden = this.hiddenOverlays;
    this.hiddenOverlays = [];
    for (const o of hidden) await this.vmix.call({ Function: `OverlayInput${o.channel}In`, Input: o.input });
  }

  private async afterPlayback(): Promise<void> {
    const sb = this.cfg.scoreboard;
    if (this.clockHidden && sb?.overlay) {
      this.clockHidden = false;
      await this.vmix.call({ Function: `OverlayInput${sb.overlay}In`, Input: this.ref(sb.input) });
    }
    if (this.musicOn) {
      this.musicOn = false;
      await this.vmix.call({ Function: 'Pause', Input: this.ref(this.cfg.replay.highlightMusic) });
    }
    if (!this.holdOverlays) await this.restoreOverlays();
    await this.ensureMainList();
  }

  private async waitPlayback(maxMs = 10 * 60_000): Promise<void> {
    const giveUp = Date.now() + maxMs;
    await sleep(600);
    while (this.playing && Date.now() < giveUp) await sleep(300);
  }

  /** Copies new highlights into vMix's highlight event list (oldest first) and plays that list to output. */
  private async playHighlights(): Promise<boolean> {
    const { replay } = this.cfg;
    const fresh = this.highlights().filter((r) => !r.copied).reverse();
    for (const r of fresh) {
      await this.eventCall(r, 'ReplayCopyLastEvent', 'ReplayCopySelectedEvent', replay.highlightList - 1);
      r.copied = true;
    }
    this.persist();
    if (!this.replays.some((r) => r.copied)) return false; // nothing to show yet
    await this.hideOverlays();
    await this.vmix.call({ Function: `ReplaySelectEvents${replay.highlightList}` });
    this.onHighlightList = true;
    if (replay.highlightMusic) {
      const music = this.ref(replay.highlightMusic);
      // Missing or failing music must not keep the highlights from playing.
      try {
        for (const fn of ['Restart', 'AudioOn', 'Play']) await this.vmix.call({ Function: fn, Input: music });
        this.musicOn = true;
      } catch { /* play without music */ }
    }
    await this.vmix.call({ Function: 'ReplayPlayAllEventsToOutput', Channel: replay.channel });
    this.playing = { id: null, since: Date.now(), seen: false };
    return true;
  }

  /**
   * "Export" of the highlight video: vMix cannot render a file from a playlist, so the panel plays the template
   * (fixed clips and the highlight list) through the program output in real time while vMix records it.
   */
  private async exportVideo(): Promise<void> {
    const template = this.cfg.postGame.highlightVideo?.template ?? [];
    this.video.status = 'running';
    try {
      await this.exclusive(async () => {
        await this.setAudio(false).catch(() => {}); // no open microphones in the video
        this.holdOverlays = true;
        await this.hideOverlays(); // no graphics over any part of the video, fixed clips included
        await this.vmix.call({ Function: 'StartRecording' });
      });
      await sleep(1000);
      for (const [i, item] of template.entries()) {
        this.video.step = i;
        this.broadcast();
        if ('input' in item) {
          const input = this.ref(item.input);
          await this.run([{ Function: 'Restart', Input: input }, { Function: 'CutDirect', Input: input }, { Function: 'Play', Input: input }]);
          await sleep(this.clipSeconds(item) * 1000);
        } else {
          const started = await this.exclusive(async () => {
            await this.vmix.call({ Function: 'ReplaySetSpeed', Value: this.video.speed / 100 });
            return this.playHighlights();
          });
          if (started) await this.waitPlayback();
          await this.exclusive(() => this.vmix.call({ Function: 'ReplaySetSpeed', Value: 1 }));
        }
      }
      this.video.status = 'done';
    } catch (e) {
      this.video.status = 'idle';
      throw e;
    } finally {
      this.holdOverlays = false;
      await this.exclusive(async () => {
        await this.vmix.call({ Function: 'StopRecording' });
        await this.restoreOverlays();
      }).catch(() => {});
    }
  }

  /**
   * Test run of the pre-game run-down: every step is triggered in vMix one after the other, idle time between
   * steps is cut short, clips get their full length. Only without a stream, so nothing of it goes out.
   */
  private async simulate(sim: SimState & { schedule: string }): Promise<void> {
    const sc = this.scheduleCfg(sim.schedule);
    const steps = sc.steps;
    for (let i = 0; i < steps.length && sim.running && !this.vm?.streaming; i++) {
      const step = steps[i];
      sim.step = i;
      this.broadcast();
      // What the one-tap start does (e.g. PAUSE STARTEN) belongs to the first step.
      const calls = [...(i === 0 ? sc.start?.calls ?? [] : []), ...(step.action?.calls ?? [])];
      let error = '';
      if (calls.length) await this.run(calls, 5000).catch((e) => { error = errorText(e); }); // configured holds are cut to 5 s
      if (calls.some((c) => 'panel' in c && c.panel === 'playHighlights')) await this.waitPlayback(30_000);
      sim.results[i] = { ok: !error, text: error };
      if (i === steps.length - 1) break;

      const realGap = offsetSec(steps[i + 1].at) - offsetSec(step.at);
      const clips = calls.map((c) => ('Input' in c ? (this.findInput(c.Input)?.duration ?? 0) / 1000 : 0));
      // Only a clip that was started needs its running time; a step's own holds have already passed inside run().
      const clipSec = Math.max(0, ...clips);
      const waitSec = Math.min(Math.max(realGap, 3), Math.max(4, clipSec + 1.5));
      for (const end = Date.now() + waitSec * 1000; sim.running && Date.now() < end;) await sleep(250);
    }
    if (sim.running) sim.step = steps.length;
    sim.running = false;
    this.broadcast();
  }

  // ---------- actions ----------

  private readonly handlers: Handlers = {
    program: async ({ cam }) => { await this.vmix.call({ Function: 'CutDirect', Input: this.ref(this.cam(cam).input) }); },
    preview: async ({ cam }) => { await this.vmix.call({ Function: 'PreviewInput', Input: this.ref(this.cam(cam).input) }); },

    'replay/mark': async ({ mark: id }) => {
      const { replay } = this.cfg;
      const mark = replay.marks.find((m) => m.id === id);
      if (!mark) throw new PanelError(`Unbekannte Markierung ${id}`);
      if (!this.replayRecording()) throw new PanelError('Replay-Aufnahme läuft nicht, zuerst starten');
      const [first, ...rest] = mark.cams.map((c) => this.cam(c).replayCamera);
      const score = this.score();
      const time = score?.clock || hhmm(Date.now());
      await this.ensureMainList();
      await this.vmix.call({ Function: 'ReplayMarkInOutLive', Value: replay.seconds });
      await this.vmix.call({ Function: 'ReplayLastEventSingleCameraOn', Value: first });
      for (const n of rest) await this.vmix.call({ Function: 'ReplayLastEventCameraOn', Value: n });
      await this.vmix.call({ Function: 'ReplaySetLastEventText', Value: replay.defaultType }).catch(() => {});
      const entry: StoredReplay = { id: this.nextId++, time, period: score?.period ?? '', cams: mark.cams, type: replay.defaultType, fav: false, copied: false };
      this.replays = [entry, ...this.replays].slice(0, 200);
      this.persist();
      return { id: entry.id, cams: entry.cams };
    },

    'replay/type': async ({ id, type }) => {
      const r = this.entry(id);
      if (!this.cfg.replay.types.includes(type)) throw new PanelError(`Unbekannter Typ ${type}`);
      r.type = type;
      this.persist();
      await this.eventCall(r, 'ReplaySetLastEventText', 'ReplaySetSelectedEventText', type);
    },

    'replay/cam': async ({ id, cam, on }) => {
      const r = this.entry(id);
      const number = this.cam(cam).replayCamera;
      const wanted = on ? [...r.cams, cam] : r.cams.filter((c) => c !== cam);
      if (!wanted.length) throw new PanelError('Ein Replay braucht mindestens eine Kamera');
      await this.eventCall(r, on ? 'ReplayLastEventCameraOn' : 'ReplayLastEventCameraOff', on ? 'ReplaySelectedEventCameraOn' : 'ReplaySelectedEventCameraOff', number);
      r.cams = this.cfg.cams.map((c) => c.id).filter((c) => wanted.includes(c));
      this.persist();
    },

    'replay/fav': async ({ id, fav }) => {
      this.entry(id).fav = fav;
      this.persist();
    },

    'replay/play': async ({ id }) => {
      const r = this.entry(id);
      await this.hideClock();
      await this.eventCall(r, 'ReplayPlayLastEventToOutput', 'ReplayPlaySelectedEventToOutput');
      this.playing = { id, since: Date.now(), seen: false };
    },

    // Plays the scene in vMix's preview only, to check it before it goes on air.
    'replay/preview': async ({ id }) => {
      const r = this.entry(id);
      const replay = this.replayInput();
      if (!replay) throw new PanelError('Kein Replay-Input in vMix gefunden');
      if (this.activeInput() === replay) throw new PanelError('Replay ist gerade auf Sendung');
      await this.vmix.call({ Function: 'PreviewInput', Input: replay.key });
      await this.eventCall(r, 'ReplayPlayLastEvent', 'ReplayPlaySelectedEvent');
    },

    'replay/delete': async ({ id }) => {
      const r = this.entry(id);
      await this.eventCall(r, 'ReplayDeleteLastEvent', 'ReplayDeleteSelectedEvent');
      // Dropping it here as well keeps "how many were marked after it" right for the remaining events.
      this.replays = this.replays.filter((x) => x !== r);
      if (this.playing?.id === id) this.playing = null;
      this.persist();
    },

    'audio/preset': async ({ preset }) => { await this.setAudio(preset === 'game'); },

    'audio/source': async ({ id, on }) => {
      if (!this.cfg.audio?.sources.some((s) => s.id === id)) throw new PanelError(`Unbekannte Tonquelle ${id}`);
      await this.setAudio(on, id);
    },

    'sponsor/now': async () => { await this.showSponsor(); },

    'sponsor/auto': async ({ enabled }) => {
      const sp = this.cfg.sponsor;
      if (!sp?.inputs.length) throw new PanelError('Kein Sponsor-Input konfiguriert');
      this.sponsor.enabled = enabled;
      this.sponsor.nextAt = enabled ? Date.now() + sp.intervalSec * 1000 : 0;
    },

    toggle: async ({ what, on }) => {
      if (what === 'stream') await this.vmix.call({ Function: on ? 'StartStreaming' : 'StopStreaming' });
      else if (what === 'rec') await this.vmix.call({ Function: on ? 'StartRecording' : 'StopRecording' });
      else if (what === 'replayRec') await this.vmix.call({ Function: on ? 'ReplayStartRecording' : 'ReplayStopRecording' });
      else await this.setLogos(on);
    },

    'stream/start': async () => {
      // Mics closed before anything goes out; the run-down opens them again at the trailer.
      if (this.cfg.preGame.muteOnStreamStart && this.cfg.audio) await this.setAudio(false).catch(() => {});
      await this.setOutputs(true);
    },

    'settings/record': async ({ enabled }) => {
      this.recordGame = enabled;
      this.persist();
    },

    'schedule/set': async ({ id, time, inMinutes }) => {
      const sc = this.cfg.schedules.find((s) => s.id === (id ?? this.schedule.id));
      if (!sc) throw new PanelError(`Unbekannter Ablauf ${id}`);
      this.schedule.id = sc.id;
      if (inMinutes !== undefined) this.schedule.anchors[sc.id] = Math.ceil((Date.now() + inMinutes * 60000) / 1000) * 1000;
      else if (time) this.schedule.anchors[sc.id] = todayAt(time);
      this.persist();
    },

    'schedule/shift': async ({ minutes, id }) => {
      const sc = this.scheduleCfg(id);
      this.schedule.anchors[sc.id] = this.anchor(sc.id) + minutes * 60_000;
      this.persist();
    },

    'schedule/auto': async ({ enabled }) => { this.autoRun = enabled; },

    'schedule/start': async ({ id, minutes }) => {
      const sc = this.cfg.schedules.find((s) => s.id === id);
      const start = sc?.start;
      if (!sc || !start) throw new PanelError(`Ablauf ${id} hat keinen Schnellstart`);
      this.schedule.id = sc.id;
      this.schedule.anchors[sc.id] = Math.ceil((Date.now() + (minutes ?? start.minutes) * 60000) / 1000) * 1000;
      this.schedule.rounds[sc.id] = (this.schedule.rounds[sc.id] ?? 0) + 1;
      this.persist();
      this.background(start.label, () => this.run(start.calls));
    },

    'schedule/action': async ({ step, id }) => {
      const s = this.scheduleCfg(id).steps[step];
      const action = s?.action;
      if (!action) throw new PanelError('Schritt hat keine Aktion');
      this.background(s.label, () => this.run(action.calls));
    },

    'post/finish': async () => {
      const finish = this.cfg.postGame.finish;
      if (!finish) throw new PanelError('Kein Abschluss konfiguriert');
      this.background(finish.label, () => this.run(finish.calls));
    },

    'video/speed': async ({ speed }) => { this.video.speed = speed; },

    'video/export': async () => {
      if (!this.cfg.postGame.highlightVideo) throw new PanelError('Kein Highlight-Video konfiguriert');
      if (this.video.status === 'running') throw new PanelError('Export läuft bereits');
      if (this.vm?.streaming || this.vm?.recording) throw new PanelError('Erst Stream und Aufnahme beenden (Abschluss)');
      if (!this.highlights().length) throw new PanelError('Keine Highlights markiert');
      this.background('Highlight-Video', () => this.exportVideo());
    },

    'highlights/play': async () => {
      if (!(await this.playHighlights())) throw new PanelError('Keine Highlights markiert');
    },

    'sim/start': async ({ schedule }) => {
      if (this.vm?.streaming) throw new PanelError('Probelauf nur ohne laufenden Stream');
      if (this.sim?.running) throw new PanelError('Probelauf läuft bereits');
      const sim = { running: true, step: 0, results: [], schedule: this.scheduleCfg(schedule ?? this.cfg.schedules[0].id).id };
      this.sim = sim;
      this.background('Probelauf', () => this.simulate(sim));
    },

    // Stops a running test run; pressed again, clears its result.
    'sim/stop': async () => {
      if (this.sim?.running) this.sim.running = false;
      else this.sim = null;
    },

    tick: async ({ id, done }) => {
      this.ticks[id] = done;
      this.persist();
    },

    // New game on the same day (or after a test run): forget ticks, the match log and the panel's replay list.
    'match/reset': async () => {
      if (this.vm?.streaming) throw new PanelError('Nicht möglich, solange der Stream läuft');
      this.ticks = {};
      this.monitor.log = emptyLog();
      this.replays = [];
      this.schedule = { id: this.cfg.schedules[0].id, anchors: { [this.cfg.schedules[0].id]: this.kickoff() }, rounds: {} };
      this.video.status = 'idle';
      this.fired.clear();
      this.persist();
    },
  };
}
