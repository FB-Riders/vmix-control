import fs from 'node:fs';
import path from 'node:path';
import type { ActionInput, ActionName, ActionResult, GfxRequest } from '../shared/actions';
import type { DebugEntry, DebugInfo, DebugKind } from '../shared/debug';
import type { ControllingItem, GfxState, OverlayState, PanelState, ScheduleState, Score, SimState, SponsorState, Tick, VideoState } from '../shared/state';
import type { Config, VmixCall } from './config';
import { PanelError } from './errors';
import { Graphics, parseIni } from './graphics';
import { emptyLog, type MatchLog, Monitor, type MonitorContext } from './monitor';
import { ReplayBook, type ReplayBookData, type Scene } from './replays';
import { BodetLink } from './bodet/link';
import { ClockTitle, ManualScoreboard, type ManualScoreboardData } from './scoreboard';
import { Shootout, type ShootoutFacts } from './shootout';
import { parseSponsors, type SponsorSet, Sponsors } from './sponsors';
import { type VmixClient, VmixError, type VmixInput, type VmixState } from './vmix';

export { PanelError };

interface ScheduleStore {
  id: string;
  anchors: Record<string, number>; // zero point per run-down, epoch ms
  rounds: Record<string, number>; // how often each run-down was started today
  running?: Record<string, boolean>; // started with its one-tap start and not ended yet
}

interface Persisted {
  day?: string;
  book?: ReplayBookData;
  periodManual?: number | null;
  gameConfig?: string; // the TCunihockey game config as it was imported
  sponsors?: SponsorSet; // from an imported TCunihockey system config
  scoreboard?: ManualScoreboardData; // the match clock driven by hand
  periodScores?: { home: number; away: number }[];
  schedule?: ScheduleStore;
  ticks?: Record<string, boolean>;
  log?: MatchLog;
  recordGame?: boolean;
  breakMusic?: boolean;
}

type Handlers = { [K in ActionName]: (input: ActionInput<K>) => Promise<ActionResult<K>> };
type Snapshot = Omit<PanelState, 'now'>;

const AUTO_WINDOW_MS = 4000; // an automatic step that is later than this is skipped, not caught up
// Test run: holds configured in a step are cut to this (long enough for the 10 s sponsor clip) ...
// A reel is over when the replay has been off program this long (longer than a transition between two events).
// A change of what is on program must last this long before the music follows it (not for the start of a reel).
const SOUND_SETTLE_MS = 1000;
const REEL_GAP_MS = 2500;
const SIM_MAX_HOLD_MS = 10_500;
// ... clips up to this length play in full, longer ones only this long.
const SIM_FULL_CLIP_SEC = 45;
const SIM_LONG_CLIP_SEC = 10;
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
  private readonly book: ReplayBook; // the scenes and which vMix event tab holds them
  private periodManual: number | null = null; // period chosen by the operator; null = follow the scoreboard
  private readonly gfx: Graphics | null; // on-screen graphics from the game config
  private gameConfig = ''; // as imported, to load it again after a restart
  private periodScores: { home: number; away: number }[] = []; // running score at the end of each period
  private lastScorePeriod: number | null = null;
  private breakPeriod: number | null = null; // period the break clip shows; null = the current one
  // Replay playback in progress. id null = a whole tab. minUntil: it cannot be over before that; offSince: since
  // when the replay has not been on program.
  private playing: { id: number | null; since: number; seen: boolean; minUntil: number; offSince: number } | null = null;
  private clockHidden: string | null = null; // scoreboard overlay taken off for a replay, to be restored
  private hiddenOverlays: { channel: number; input: string }[] = []; // taken off for the highlights, to be restored
  // Sound direction: while a clip sequence or a break runs, the music follows what is on program (see directSound).
  private sequences = 0; // clip sequences in progress (break clip, end clip, highlight video)
  private reelMusic: string | undefined; // music input that belongs under the reel being played
  private reelMusicStarted = false; // the highlight track was already started from the top for this reel
  private soundSeen = { key: '', since: 0 }; // what is on program, and since when
  private soundApplied = ''; // the sound state last sent to vMix
  private readonly debugLog: DebugEntry[] = []; // actions, vMix calls, sound direction and sequences, oldest first
  private pollMs = 0; // how long the last state request to vMix took
  private trailerHidden: { channel: number; input: string }[] = []; // league logos taken off while the league trailer runs
  private holdOverlays = false; // overlays stay off beyond the highlight scenes: whole highlight video, whole break
  private readonly sponsors: Sponsors | null;
  private readonly board: ManualScoreboard | null; // match clock by hand, in place of the scoreboard link
  private readonly clockTitle: ClockTitle | null; // the clock title, whoever fills it
  private readonly bodet: BodetLink | null; // link to the hall's Bodet Scorepad
  private timeoutShown = false; // the time-out graphic is on because the console runs a time-out
  private readonly shootout: Shootout | null; // penalty shoot-out display in place of the match clock
  private sponsorSet: SponsorSet | null = null; // as imported, to have it again after a restart
  private schedule: ScheduleStore;
  private autoRun = true;
  private recordGame: boolean; // record the game locally when the stream is started
  private breakMusic: boolean; // break video muted, background music over it
  private fired = new Set<string>(); // automatic steps already handled
  private triggered = new Set<string>(); // steps whose action has run, by hand or automatically
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
    const { replay } = cfg;
    this.book = new ReplayBook((params) => vmix.call(params), replay.periods.map((p) => p.tab), replay.highlightTab, replay.seconds, sameDay ? saved.book : undefined);
    this.periodManual = sameDay ? saved.periodManual ?? null : null;
    this.gfx = cfg.graphics ? new Graphics(cfg.graphics, (params) => vmix.call(params), (input) => this.ref(input)) : null;
    const sb = cfg.scoreboard;
    this.clockTitle = sb ? new ClockTitle(sb.input, sb.manual.penaltyColor, (params) => vmix.call(params), (input) => this.ref(input)) : null;
    this.board = sb && this.clockTitle ? new ManualScoreboard(sb.manual, this.clockTitle, () => this.persist(), sameDay ? saved.scoreboard : undefined) : null;
    const bd = sb?.bodet;
    const bodetPort = Number(process.env.BODET_PORT) || bd?.port || 4001;
    this.bodet = bd?.enabled && (bd.mode === 'listen' || bd.host)
      ? new BodetLink({ ...bd, host: bd.host || '0.0.0.0', port: bodetPort }, (message) => this.log('action', `Bodet: ${message}`), () => this.broadcast())
      : null;
    const so = cfg.graphics?.shootout;
    this.shootout = so ? new Shootout({ ...so, overlay: cfg.scoreboard?.overlay ?? 1 }, (params) => vmix.call(params), (input) => this.ref(input)) : null;
    this.sponsorSet = saved.sponsors ?? null;
    this.sponsors = cfg.sponsor ? new Sponsors(cfg.sponsor, (params) => vmix.call(params), (input) => this.ref(input), this.sponsorSet) : null;
    if (saved.gameConfig && this.gfx) {
      try { this.gfx.load(saved.gameConfig); this.gameConfig = saved.gameConfig; } catch { /* an unreadable old config is simply not loaded */ }
    }
    if (sameDay) this.periodScores = saved.periodScores ?? []; // like the book, only valid for the day it was set
    const s = sameDay ? saved.schedule : undefined;
    this.schedule = s?.anchors && cfg.schedules.some((x) => x.id === s.id) ? s : { id: cfg.schedules[0].id, anchors: {}, rounds: {} };
    if (sameDay) this.ticks = saved.ticks ?? {};
    this.recordGame = saved.recordGame ?? cfg.preGame.recordGame;
    // A choice made on the Pause screen holds for the day; a new day starts with the configured sound.
    this.breakMusic = (sameDay ? saved.breakMusic : undefined) ?? cfg.audio?.breakSound === 'music';
    this.monitor = new Monitor(cfg, saved.log);
    this.video.speed = cfg.postGame.highlightVideo?.speeds.at(-1) ?? 100;
    vmix.onCall = (params, ms, error) => {
      const { Function: fn, Input, ...rest } = params;
      const input = Input !== undefined ? ` «${this.findInput(Input)?.title ?? Input}»` : '';
      const args = Object.entries(rest).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => ` ${k}=${v}`).join('');
      this.log(error ? 'error' : 'vmix', `${fn}${input}${args} · ${error ? errorText(error) : `${ms} ms`}`);
    };
  }

  get vmixState(): VmixState | null { return this.vm; }

  start(pollMs: number): void {
    setInterval(() => void this.poll(), pollMs);
    setInterval(() => this.broadcast(true), 15000); // keeps client clocks in sync and connections alive
    // The clock by hand needs a finer beat than the poll, or its seconds would stumble.
    setInterval(() => { if (this.vm) this.pushScoreboard(); }, 100);
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
    this.log('sequence', `${label}: gestartet`);
    fn().then(() => this.log('sequence', `${label}: fertig`), (e) => {
      this.log('error', `${label}: ${errorText(e)}`);
      this.notice = { text: `${label}: ${errorText(e)}`, until: Date.now() + 60_000 };
      this.broadcast();
    });
  }

  private log(kind: DebugKind, text: string): void {
    this.debugLog.push({ t: Date.now(), kind, text });
    if (this.debugLog.length > 300) this.debugLog.shift();
  }

  /** A look inside for the debug bar: what the panel believes right now, and what it did lately. */
  debug(): DebugInfo {
    const { vm } = this;
    const title = (n: number | undefined) => { const i = vm?.inputs.find((x) => x.number === n); return i ? `${i.number} · ${i.title} [${i.type}, ${i.state}]` : '–'; };
    const overlays = Object.entries(vm?.overlays ?? {}).filter(([, n]) => n).map(([ch, n]) => `${ch}: ${vm?.inputs.find((x) => x.number === n)?.title ?? n}`);
    const running = Object.entries(this.schedule.running ?? {}).filter(([, on]) => on).map(([id]) => id);
    const p = this.cfg.replay.periods[this.period()];
    const yes = (b: boolean) => (b ? 'ja' : 'nein');
    return {
      now: Date.now(),
      status: [
        { label: 'vMix', value: vm ? `verbunden · ${vm.version} · Abfrage ${this.pollMs} ms` : 'NICHT erreichbar' },
        { label: 'Programm', value: title(vm?.active) },
        { label: 'Preview', value: title(vm?.preview) },
        { label: 'Overlays', value: overlays.join(' · ') || 'keine' },
        { label: 'Stream / Rec / Replay-Rec', value: `${yes(!!vm?.streaming)} / ${yes(!!vm?.recording)} / ${yes(this.replayRecording())}` },
        { label: 'Replay auf Sendung', value: yes(this.replayOnAir()) },
        { label: 'Wiedergabe', value: this.playing ? `${this.playing.id === null ? 'ganzer Tab' : `Szene ${this.playing.id}`} · gesehen ${yes(this.playing.seen)}` : 'keine' },
        { label: 'Abschnitt', value: `${p.label} → vMix-Tab ${p.tab} (${this.periodManual === null ? 'auto' : 'von Hand'})` },
        { label: 'Szenen je Tab', value: [...this.cfg.replay.periods.map((x) => `${x.tab}: ${this.book.count(x.tab)}`), `${this.cfg.replay.highlightTab}: ${this.book.count(this.cfg.replay.highlightTab)}`].join(' · ') },
        { label: 'Sequenzen', value: `${this.sequences} laufend · Pause ${running.length ? 'läuft' : 'läuft nicht'} · AUTO ${this.autoRun ? 'an' : 'aus'}` },
        { label: 'Ton-Regie', value: `${this.soundApplied || 'inaktiv'} · sieht ${this.soundSeen.key || 'nichts'}` },
        { label: 'Einblender', value: `gehalten ${yes(this.holdOverlays)} · ausgeblendet ${this.hiddenOverlays.map((o) => o.channel).join(', ') || 'keine'}` },
      ],
      log: this.debugLog,
    };
  }

  async dispatch<K extends ActionName>(name: K, input: ActionInput<K>): Promise<ActionResult<K>> {
    const args = Object.keys(input as object).length ? ` ${JSON.stringify(input)}` : '';
    this.log('action', `${name}${args}`);
    try {
      const result = await this.exclusive(() => this.handlers[name](input));
      await this.poll();
      return result;
    } catch (e) {
      if (e instanceof PanelError) this.log('error', `${name}: ${e.message}`); // vMix failures are logged with the call itself
      throw e;
    }
  }

  // ---------- vMix state ----------

  async poll(): Promise<void> {
    const asked = Date.now();
    const wasConnected = !!this.vm;
    try {
      this.vm = await this.vmix.state();
      this.pollMs = Date.now() - asked;
      if (!wasConnected) this.log('vmix', `verbunden · vMix ${this.vm.version}`);
    } catch {
      this.vm = null;
      if (wasConnected) this.log('error', 'vMix nicht mehr erreichbar');
    }
    const now = Date.now();

    if (this.vm) {
      if (this.playing) {
        const p = this.playing;
        const onAir = this.replayOnAir();
        if (onAir) { p.seen = true; p.offSince = 0; } else p.offSince ||= now;
        // Between the events of a reel vMix can leave the replay for a moment (transition). So playback only counts
        // as over once the scenes had time to run and the replay has stayed off program for a while.
        const offLongEnough = !onAir && now - p.offSince >= (p.id === null ? REEL_GAP_MS : 1000);
        if (offLongEnough && now >= p.minUntil && (p.seen || now - p.since > 8000)) {
          this.playing = null;
          this.exclusive(() => this.afterPlayback()).catch(() => {});
        }
      }
      const sp = this.cfg.sponsor;
      if (this.sponsors && sp) {
        const onChannel = this.vm.overlays[sp.overlay];
        // No sponsor over a replay, the highlights or the break.
        this.sponsors.tick(now, !!this.playing || this.holdOverlays, sp.inputs.some((i) => this.findInput(i)?.number === onChannel));
      }
      this.trailerLogos().catch(() => {});
      if (this.shootout) {
        this.shootout.sync(now, this.findInput(this.shootout.input)?.number === this.vm.overlays[this.cfg.scoreboard?.overlay ?? 1]);
        if (this.shootout.live) this.shootout.facts(this.shootoutFacts()).catch(() => {}); // the score follows the scoreboard
      }
      this.monitor.update(this.vm, this.monitorContext(now));
      this.runDueSteps(now);
      this.directSound(now);
      this.trackPeriods();
      this.followTimeout();
      if (this.gfx && this.cfg.graphics) this.gfx.sync(this.vm.inputs.find((i) => i.number === this.vm?.overlays[this.cfg.graphics?.overlay ?? 0])?.title);
      this.gfx?.tick(now);
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
      if (!(this.autoRun && this.vm?.streaming && now - due < AUTO_WINDOW_MS)) {
        this.log('sequence', `${step.label}: automatischer Schritt ausgelassen (${!this.autoRun ? 'AUTO aus' : !this.vm?.streaming ? 'kein Stream' : 'zu spät'})`);
      } else {
        this.triggered.add(this.stepKey(sc.id, i));
        this.background(step.label, () => this.run(action.calls));
      }
    });
  }

  private monitorContext(now: number): MonitorContext {
    const sources = this.audioSources();
    return {
      now,
      // Off for the league trailer is as the league wants it, so it counts as on.
      logosVisible: this.cfg.logos.length ? this.trailerHidden.length > 0 || this.logoStates().every((l) => l.visible) : null,
      audioPaused: sources.length > 0 && sources.every((s) => !s.on),
      schedule: this.schedule.id,
      round: this.schedule.rounds[this.schedule.id] ?? 0,
    };
  }

  private findInput(ref: string | number | undefined): VmixInput | null {
    if (!this.vm || ref === undefined || ref === '') return null;
    const inputs = this.vm.inputs;
    // "Name*" matches by prefix: a list input carries its current item in the title ("General Music - 4. Song.wav").
    if (typeof ref === 'string' && ref.endsWith('*')) return inputs.find((i) => i.title.startsWith(ref.slice(0, -1))) ?? null;
    // vMix renames a disconnected device to "Offline - <name>"; it is still the same input.
    return inputs.find((i) => i.title === ref) ?? inputs.find((i) => i.title === `Offline - ${ref}`) ?? inputs.find((i) => i.key === ref)
      ?? (/^\d+$/.test(String(ref)) ? inputs.find((i) => i.number === Number(ref)) : undefined) ?? null;
  }

  // Prefer the GUID so a renamed or moved input still resolves within a session.
  private ref(input: string | number): string | number { return this.findInput(input)?.key ?? input; }
  private activeInput() { return this.vm?.inputs.find((i) => i.number === this.vm?.active); }
  private replayInput() { return this.vm?.inputs.find((i) => i.type === 'Replay'); }

  /** vMix Replay has two inputs, channel A ("Replay") and channel B ("ReplayPreview"); events can go out on either. */
  private replayOnAir(): boolean { return !!this.activeInput()?.type.startsWith('Replay'); }
  private replayRecording() { return this.replayInput()?.replay?.recording === 'True'; }

  private scheduleCfg(id = this.schedule.id) { return this.cfg.schedules.find((s) => s.id === id) ?? this.cfg.schedules[0]; }

  private anchor(id = this.schedule.id): number {
    return this.schedule.anchors[id] ?? todayAt(this.scheduleCfg(id).anchorTime ?? this.cfg.schedules[0].anchorTime ?? '20:00');
  }

  private kickoff(): number { return this.anchor(this.cfg.schedules[0].id); }

  private score(): Score | null {
    const sb = this.cfg.scoreboard;
    const inp = sb && this.findInput(sb.input);
    // By hand the panel knows score and period itself; reading them back from the title would only add a way to fail.
    // The same goes for what the Scorepad says.
    const b = this.clockSource();
    if (!sb || (!inp && !b)) return null;
    const f = (name: string) => (name ? inp?.fields[name]?.trim() ?? '' : '');
    const names = [f(sb.homeName), f(sb.awayName)];
    const period = b?.period || f(sb.period);
    const clock = [sb.clock].flat().map(f).join('');
    return { home: b ? String(b.score.home) : f(sb.home), away: b ? String(b.score.away) : f(sb.away), period: period && sb.periodFormat.replace('{}', period), clock, teams: names.every(Boolean) ? names.join(' – ') : '' };
  }

  /** Names and score for the shoot-out display: as on the match clock, else from the game config. */
  private shootoutFacts(): ShootoutFacts {
    const sb = this.cfg.scoreboard;
    const fields = (sb && this.findInput(sb.input)?.fields) || {};
    const f = (name: string | undefined) => (name ? fields[name]?.trim() ?? '' : '');
    const teams = this.gfx?.teams();
    return {
      homeName: f(sb?.homeName) || teams?.home.short || '', awayName: f(sb?.awayName) || teams?.away.short || '',
      homeScore: f(sb?.home), awayScore: f(sb?.away),
      homeLogo: teams?.home.logo ?? '', awayLogo: teams?.away.logo ?? '',
    };
  }

  /**
   * Who the panel knows score and period from without reading the title. The score is always the panel's own count:
   * a goal graphic counts it, so the clock shows it at once. The period is the operator's by hand, else the Scorepad's.
   */
  private clockSource(): { period: string; score: { home: number; away: number } } | null {
    const b = this.board;
    if (!b || !this.countsGoals()) return null;
    return { score: b.score, period: b.manual ? b.period : this.bodet?.hasData ? this.bodet.period : '' };
  }

  /** The panel counts the goals itself, unless another program fills the clock title. */
  private countsGoals(): boolean { return !!this.board && (this.board.manual || !!this.bodet); }

  private pushScoreboard(): void {
    const b = this.board;
    if (!b || !this.clockTitle) return;
    const teams = this.gfx?.teams();
    const names = { home: teams?.home.short ?? '', away: teams?.away.short ?? '' };
    const logos = { home: teams?.home.logo ?? '', away: teams?.away.logo ?? '' };
    if (b.manual) {
      b.names = names;
      b.logos = logos;
      b.push().catch(() => {});
    } else if (this.bodet?.hasData) {
      // Nothing is written before the Scorepad has delivered data, so the title keeps what it shows.
      this.clockTitle.write(this.bodet.face(b.score, names, logos)).catch(() => {});
    }
  }

  /** A time-out on the console puts the team's time-out graphic on, and takes it off again when it is over. */
  private followTimeout(): void {
    if (!this.bodet || !this.gfx?.loaded || !this.cfg.scoreboard?.bodet?.timeoutGraphic) return;
    const team = !this.board?.manual && this.bodet.live && !this.playing && !this.holdOverlays ? this.bodet.timeout : null;
    if (team && !this.timeoutShown) {
      this.timeoutShown = true;
      this.showGraphic({ kind: 'timeout', team }).catch(() => {});
    } else if (!team && this.timeoutShown) {
      this.timeoutShown = false;
      if (this.gfx.liveKind === 'timeout') this.gfx.hide().catch(() => {}); // not if the operator has put something else on meanwhile
    }
  }

  private needBoard(): ManualScoreboard {
    if (!this.board) throw new PanelError('In config.json ist keine Matchuhr hinterlegt (scoreboard)');
    return this.board;
  }

  private clockOnAir(): boolean {
    const sb = this.cfg.scoreboard;
    const inp = this.findInput(sb?.input);
    return !!inp && !!sb && this.vm?.overlays[sb.overlay ?? 1] === inp.number;
  }

  private needShootout(): Shootout {
    if (!this.shootout) throw new PanelError('In config.json ist kein Titel für das Penalty-Schiessen hinterlegt (graphics.shootout)');
    return this.shootout;
  }

  private scoreText(): { home: string; away: string } | null {
    const s = this.score();
    return s && (s.home || s.away) ? { home: s.home, away: s.away } : null;
  }

  private scoreNumbers(): { home: number; away: number } | null {
    const s = this.score();
    return s && /^\d+$/.test(s.home) && /^\d+$/.test(s.away) ? { home: Number(s.home), away: Number(s.away) } : null;
  }

  /** Remembers the score whenever the scoreboard moves on to the next period, for the period results under a result. */
  private trackPeriods(): void {
    const period = this.scoreboardPeriod();
    const score = this.scoreNumbers();
    if (period === null || !score) return;
    if (this.lastScorePeriod !== null && period > this.lastScorePeriod) {
      for (let p = this.lastScorePeriod; p < period; p++) this.periodScores[p] = score;
      this.persist();
    }
    if (period === 0 && this.lastScorePeriod !== 0) this.periodScores = []; // a new game has started on the scoreboard
    this.lastScorePeriod = period;
  }

  /** "(1:0, 2:1)": goals per finished period, plus the running one. */
  private periodResults(): string {
    const score = this.scoreNumbers();
    if (!score) return '';
    const ends = [...this.periodScores.filter(Boolean), score];
    const parts = ends.map((e, i) => `${e.home - (ends[i - 1]?.home ?? 0)}:${e.away - (ends[i - 1]?.away ?? 0)}`);
    return `(${parts.join(', ')})`;
  }

  /** Period shown on the scoreboard as an index into the configured periods; anything that is not 1, 2, 3 ... counts as the last (overtime). */
  private scoreboardPeriod(): number | null {
    const sb = this.cfg.scoreboard;
    const raw = this.clockSource()?.period || (sb?.period ? this.findInput(sb.input)?.fields[sb.period]?.trim() : '');
    if (!raw) return null;
    const last = this.cfg.replay.periods.length - 1;
    return /^\d+$/.test(raw) ? Math.min(Math.max(Number(raw) - 1, 0), last) : last;
  }

  /** Period new scenes are filed under. */
  private period(): number {
    return Math.min(this.periodManual ?? this.scoreboardPeriod() ?? 0, this.cfg.replay.periods.length - 1);
  }

  /** Period whose scenes the break clip shows, and its vMix tab. */
  private breakClipPeriod(): number {
    return Math.min(this.breakPeriod ?? this.period(), this.cfg.replay.periods.length - 1);
  }

  private scheduleRunning(): boolean { return Object.values(this.schedule.running ?? {}).some(Boolean); }

  private breakTab(): number { return this.book.tabOf(this.breakClipPeriod()); }

  /** Starred scenes and types that always count (goals) belong in the highlight tab; this makes vMix match. */
  private async syncHighlight(scene: Scene): Promise<void> {
    await this.book.setHighlight(scene, scene.fav || this.cfg.replay.autoHighlightTypes.includes(scene.type));
  }

  private audioSources() {
    return (this.cfg.audio?.sources ?? []).map(({ id, name, short, input }) => {
      const inp = this.findInput(input);
      const on = !!inp && inp.type !== 'Placeholder' && !inp.muted; // a placeholder is a device that is not connected
      return { id, name, short, on, level: on && inp ? meterLevel(inp.meter) : 0 };
    });
  }

  private musicState() {
    const m = this.cfg.audio?.music;
    if (!m) return null;
    const inp = this.findInput(m.input);
    // A list input is titled "<list> - <current item>"; show the item.
    const track = inp ? inp.title.replace(/^.*? - /, '').replace(/\.\w+$/, '') : '';
    return { name: m.name, track, playing: !!inp && inp.state === 'Running' && !inp.muted };
  }

  private logoStates() {
    return this.cfg.logos.map((l) => {
      const inp = this.findInput(l.input);
      return { name: l.name, visible: !!inp && this.vm?.overlays[l.overlay] === inp.number };
    });
  }

  /** What is on each overlay channel, as vMix reports it; named the way the operator knows it. */
  private overlayStates(gfx: GfxState | null, sponsor: SponsorState | null): OverlayState[] {
    const { cfg, vm } = this;
    const clock = cfg.scoreboard ? cfg.scoreboard.overlay ?? 1 : 0;
    const roles = new Map<number, string>();
    for (const l of cfg.logos) roles.set(l.overlay, 'Logos');
    if (cfg.sponsor?.inputs.length) roles.set(cfg.sponsor.overlay, 'Sponsor');
    if (cfg.graphics) roles.set(cfg.graphics.overlay, 'Einblender');
    if (clock) roles.set(clock, 'Matchuhr');
    const plain = (title: string) => title.replace(/\.\w+$/, '');
    const name = (channel: number, key: string | number): string => {
      const inp = vm?.inputs.find((i) => i.key === key || i.number === key);
      if (!inp) return '';
      if (channel === clock && inp === this.findInput(cfg.scoreboard?.input)) return 'Matchuhr';
      if (channel === clock && this.shootout && inp === this.findInput(this.shootout.input)) return 'Penalty-Schiessen';
      if (channel === cfg.graphics?.overlay && gfx?.live) return gfx.live.summary;
      if (channel === cfg.sponsor?.overlay && cfg.sponsor.inputs.some((i) => this.findInput(i) === inp)) return sponsor?.list.find((x) => x.nr === sponsor.live)?.label ?? 'Sponsor';
      return cfg.logos.find((l) => l.overlay === channel && this.findInput(l.input) === inp)?.name ?? plain(inp.title);
    };
    const channels = new Set([...roles.keys(), ...Object.entries(vm?.overlays ?? {}).filter(([, n]) => n).map(([ch]) => Number(ch))]);
    return [...channels].sort((a, b) => a - b).map((channel) => {
      const number = vm?.overlays[channel] ?? 0;
      const hidden = [...this.hiddenOverlays, ...this.trailerHidden].find((o) => o.channel === channel)?.input ?? (channel === clock ? this.clockHidden : null);
      return {
        channel, role: roles.get(channel) ?? '', on: !!number,
        text: number ? name(channel, number) : hidden ? name(channel, hidden) : '',
        paused: !number && !!hidden,
      };
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
      const refs = calls.flatMap((c) => ('clip' in c ? [c.clip] : 'Input' in c && c.Input !== undefined ? [c.Input] : []));
      new Set(refs).forEach((i) => need(i, what));
    };
    cfg.cams.forEach((c) => need(c.input, `CAM ${c.id}`));
    need(cfg.scoreboard?.input, 'Scoreboard');
    cfg.audio?.sources.forEach((s) => need(s.input, `Ton ${s.short}`));
    need(cfg.audio?.music?.input, 'Musik');
    need(cfg.audio?.breakVideo, 'Pausenvideo');
    cfg.sponsor?.inputs.forEach((i) => need(i, 'Sponsor'));
    cfg.logos.forEach((l) => need(l.input, l.name));
    Object.values(cfg.graphics?.titles ?? {}).forEach((t) => need(t, 'Einblender'));
    need(cfg.graphics?.shootout?.input, 'Penalty-Schiessen');
    [...cfg.replay.highlightClip.intro, ...cfg.replay.highlightClip.outro].forEach((i) => need(i, 'Highlight-Clip'));
    need(cfg.replay.highlightMusic, 'Highlight-Musik');
    const needGame = (calls: VmixCall[], what: string) => {
      if (this.gfx && !this.gfx.loaded && calls.some((c) => 'gfx' in c && c.gfx !== 'hide')) w.push(`${what}: Spiel-Konfiguration fehlt (im Tab Einblender laden)`);
    };
    for (const s of cfg.schedules) {
      for (const step of s.steps) if (step.action) needGame(step.action.calls, step.label);
      if (s.start) needCalls(s.start.calls, s.start.label);
      if (s.end) needCalls(s.end.calls, s.end.label);
      for (const step of s.steps) if (step.action) needCalls(step.action.calls, step.label);
    }
    needCalls(cfg.preGame.onStreamStart, 'Stream-Start');
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
    const scenes = this.book.highlights();
    const goals = scenes.filter((r) => this.cfg.replay.autoHighlightTypes.includes(r.type)).length;
    const sceneSec = Math.round(scenes.reduce((sum, r) => sum + this.book.length(r) * r.cams.length, 0) / (this.video.speed / 100));
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

  /** Run-down texts may name the break clip's period and its number of scenes: {period}, {scenes}. */
  private fill(text: string): string {
    const p = this.cfg.replay.periods[this.breakClipPeriod()];
    return text.replace('{period}', p.label).replace('{scenes}', String(this.book.count(p.tab)));
  }

  private stepKey(id: string, i: number): string { return `${id}:${this.anchor(id)}:${i}`; }

  private scheduleView(sc: Config['schedules'][number]): ScheduleState {
    const { cfg } = this;
    return {
      id: sc.id, title: sc.title, anchorLabel: sc.anchorLabel, anchor: this.anchor(sc.id),
      steps: sc.steps.map((s, i) => ({
        offset: offsetSec(s.at), label: this.fill(s.label), sub: this.fill(s.sub), tag: s.tag || (s.action?.auto ? 'auto' : s.action?.required ? 'Knopf' : ''), auto: !!s.action?.auto,
        pending: !!s.action?.required && !this.triggered.has(this.stepKey(sc.id, i)),
        hero: s.hero ?? s.label, durationSec: s.durationSec ?? 0, action: s.action?.label ?? null,
      })),
      all: cfg.schedules.map(({ id, title, anchorLabel }) => ({ id, title, anchorLabel })),
      starts: cfg.schedules.flatMap((x) => (x.start ? [{ id: x.id, label: x.start.label, sub: x.start.sub, note: x.start.note }] : [])),
      start: sc.start ? { label: sc.start.label, sub: sc.start.sub, note: sc.start.note, minutes: sc.start.minutes } : null,
      end: sc.end ? { label: sc.end.label, sub: sc.end.sub } : null,
      running: !!this.schedule.running?.[sc.id],
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
    const gfx = this.gfx ? this.gfx.view(this.scoreText(), this.periodResults()) : null;
    const sponsor = this.sponsors && cfg.sponsor?.inputs.length ? this.sponsors.view() : null;
    return {
      connected: !!vm,
      streaming: !!vm?.streaming,
      recording: !!vm?.recording,
      replayRecording: this.replayRecording(),
      programTitle: active?.title ?? '',
      overlays: this.overlayStates(gfx, sponsor),
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
        list: this.book.all().map((r) => ({
          id: r.id, time: r.time, period: r.period, type: r.type, cams: r.cams,
          highlight: this.book.isHighlight(r.id),
          seconds: this.book.length(r), inShift: r.inShift, outShift: r.outShift,
          locked: cfg.replay.autoHighlightTypes.includes(r.type),
          playing: this.playing?.id === r.id,
        })),
        highlightCount: this.book.highlights().length,
        periods: cfg.replay.periods.map((p) => ({ ...p, count: this.book.count(p.tab) })),
        period: this.period(),
        periodAuto: this.periodManual === null,
        periodFromScoreboard: this.scoreboardPeriod(),
        breakPeriod: this.breakClipPeriod(),
        highlightTab: cfg.replay.highlightTab,
      },
      audio: sources.length
        ? { sources, preset: sources.every((s) => s.on) ? 'game' : sources.every((s) => !s.on) ? 'pause' : null }
        : null,
      music: this.musicState(),
      gfx,
      scoreboard: this.board ? { ...this.board.view(), onAir: this.clockOnAir(), bodet: this.bodet?.view() ?? null, counts: this.countsGoals() } : null,
      shootout: this.shootout?.view() ?? null,
      breakSound: cfg.audio?.music && cfg.audio.breakVideo ? { music: this.breakMusic } : null,
      sponsor,
      logos: logos.length ? { visible: logos.every((l) => l.visible) } : null,
      health: {
        watches: this.monitor.watches(logos.length > 0),
        // The logos being off during the highlights or a break that switches them off is intended, so it raises no alarm
        // (it still counts in the controlling).
        alerts: [
          ...(this.notice ? [this.notice.text] : []),
          ...(vm?.streaming && !this.replayRecording() ? ['Replay-Aufnahme läuft nicht: keine Replays möglich'] : []),
          ...(vm ? this.monitor.alerts(this.video.status === 'running' ? { ...ctx, logosVisible: null } : ctx) : []),
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
    const data: Persisted = { day: today(), book: this.book.toJSON(), periodManual: this.periodManual, gameConfig: this.gameConfig, sponsors: this.sponsorSet ?? undefined, scoreboard: this.board?.toJSON(), periodScores: this.periodScores, schedule: this.schedule, ticks: this.ticks, log: this.monitor.log, recordGame: this.recordGame, breakMusic: this.breakMusic };
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

  private entry(id: number): Scene {
    const r = this.book.find(id);
    if (!r) throw new PanelError('Replay nicht gefunden');
    return r;
  }

  /** Runs a configured sequence. A failing call does not stop the rest (e.g. a missing clip must not keep the audio muted). */
  private async run(calls: VmixCall[], maxWaitMs = Infinity): Promise<void> {
    let failure: unknown;
    for (const [i, c] of calls.entries()) {
      try {
        if ('wait' in c && !('clip' in c)) await sleep(Math.min(c.wait, maxWaitMs));
        else if ('clip' in c) await this.playClip(c.clip, { wait: c.wait, seconds: c.seconds, next: this.nextPicture(calls.slice(i + 1)) });
        else if ('panel' in c && c.panel === 'waitPlayback') await this.waitPlayback();
        else if ('panel' in c && c.panel === 'highlightClip') await this.clip(this.cfg.replay.highlightTab, this.cfg.replay.highlightMusic || undefined);
        else if ('panel' in c && c.panel === 'periodClip') await this.clip(this.breakTab(), this.cfg.audio?.music?.input); // the break's scenes run under the general music
        else await this.exclusive(() => this.step(c));
      } catch (e) {
        failure ??= e;
      }
    }
    if (failure) throw failure;
  }

  /** The input the rest of a sequence puts on program next (a clip or a cut), to line it up in preview meanwhile. */
  private nextPicture(rest: VmixCall[]): string | number | undefined {
    for (const c of rest) {
      if ('clip' in c) return c.clip;
      if ('Function' in c && (c.Function === 'CutDirect' || c.Function === 'Cut') && c.Input !== undefined) return c.Input;
      if ('panel' in c && (c.panel === 'highlightClip' || c.panel === 'periodClip' || c.panel === 'playHighlights')) return undefined; // a reel follows
    }
    return undefined;
  }

  private async step(c: Exclude<VmixCall, { wait: number } | { clip: string }>): Promise<void> {
    if ('gfx' in c) { await this.showGraphic(c.gfx); return; }
    if (!('panel' in c)) { await this.vmix.call(c.Input !== undefined ? { ...c, Input: this.ref(c.Input) } : c); return; }
    if (c.panel === 'playHighlights') await this.playReel(this.cfg.replay.highlightTab, this.cfg.replay.highlightMusic || undefined);
    else if (c.panel === 'audioGame' || c.panel === 'audioPause') await this.setAudio(c.panel === 'audioGame');
    else if (c.panel === 'breakSound') this.soundApplied = ''; // sound follows the program by itself; this just makes it re-apply
    else if (c.panel === 'overlaysOff') { this.holdOverlays = true; await this.hideOverlays(); }
    else if (c.panel === 'overlaysOn') { this.holdOverlays = false; await this.restoreOverlays(); }
    else if (c.panel === 'logosOn' || c.panel === 'logosOff') await this.setLogos(c.panel === 'logosOn');
    else if (c.panel === 'startAll') await this.setOutputs(true);
    else if (c.panel === 'stopAll') await this.setOutputs(false);
  }

  private async showGraphic(req: GfxRequest | 'hide'): Promise<void> {
    if (!this.gfx) throw new PanelError('In config.json sind keine Einblender (graphics) hinterlegt');
    if (req === 'hide') { await this.gfx.hide(); return; }
    // One press does it all: a goal counts, and by hand a penalty starts on the clock (with the scoreboard link the console runs the penalties).
    const b = this.board && this.countsGoals() ? this.board : null;
    if (b && req.team && req.kind === 'goal') b.goal(req.team, 1);
    if (b?.manual && req.team && req.kind === 'penalty' && req.value) b.addPenalty(req.team, req.value);
    if (b) this.pushScoreboard();
    const s = b ? { home: String(b.score.home), away: String(b.score.away) } : this.scoreText();
    await this.gfx.show(req, s ? `${s.home}:${s.away}` : '', this.periodResults());
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

  /**
   * Keeps the music in step with the picture. While a clip sequence or a break runs, every poll looks at what is on
   * program and sets the sound to match, instead of trusting the timing of the sequence:
   *   replay reel      -> the reel's music on
   *   a video clip     -> all music off (intros, outros, sponsor clips bring their own sound or none)
   *   the break video  -> its own sound, or muted under the music list, as chosen
   * A change must be seen for a second before it is applied, so a transition between two replay events does not
   * stop the music. The start of a reel is applied at once.
   */
  private directSound(now: number): void {
    if (!this.sequences && !this.scheduleRunning()) { this.soundApplied = ''; this.soundSeen = { key: '', since: now }; return; }
    const active = this.activeInput();
    const breakVideo = this.findInput(this.cfg.audio?.breakVideo);
    // The break video is on also when it runs inside another input, e.g. the league's frame around it.
    const want = !active ? ''
      : this.replayOnAir() && this.playing?.id === null ? 'reel'
      : breakVideo && (active === breakVideo || active.layers.includes(breakVideo.key)) ? (this.breakMusic ? 'break:music' : 'break:video')
      : active.type === 'Video' || active.type === 'VideoList' ? 'clip'
      : ''; // cameras and everything else: hands off
    if (want !== this.soundSeen.key) {
      this.soundSeen = { key: want, since: now };
      this.logSound(`sieht «${active?.title ?? '-'}» [${active?.type ?? '-'}] -> ${want || 'nichts tun'} (Reel läuft: ${this.playing?.id === null})`);
    }
    if (!want || want === this.soundApplied) return;
    if (want !== 'reel' && now - this.soundSeen.since < SOUND_SETTLE_MS) return;
    this.soundApplied = want;
    this.logSound(`schaltet auf ${want}${want === 'reel' ? ` mit ${this.reelMusic ?? 'ohne Musik'}` : ''}`);
    this.exclusive(() => this.applySound(want)).catch(() => {});
  }

  private logSound(text: string): void { this.log('sound', text); }

  private async applySound(state: string): Promise<void> {
    const { audio, replay } = this.cfg;
    const general = audio?.music ? this.ref(audio.music.input) : null;
    const track = replay.highlightMusic ? this.ref(replay.highlightMusic) : null;
    const video = audio?.breakVideo ? this.ref(audio.breakVideo) : null;
    // One failing input (e.g. a music list that is missing) must not keep the others from switching.
    const send = (fn: string, input: string | number | null) => (input === null ? Promise.resolve()
      : this.vmix.call({ Function: fn, Input: input }).catch(() => {})); // the failure is in the log with the call
    const play = async (input: string | number | null) => { await send('AudioOn', input); await send('Play', input); };

    if (state === 'reel') {
      const wanted = this.reelMusic ? this.ref(this.reelMusic) : null;
      for (const other of [general, track]) if (other !== wanted) await send('Pause', other);
      if (wanted !== null && wanted === track && !this.reelMusicStarted) await send('Restart', wanted); // the highlight track starts from the top, once
      this.reelMusicStarted = true;
      await play(wanted);
    } else if (state === 'clip') {
      await send('Pause', general);
      await send('Pause', track);
    } else if (state === 'break:music') {
      await send('AudioOff', video);
      await send('Pause', track);
      await play(general);
    } else if (state === 'break:video') {
      await send('Pause', general);
      await send('Pause', track);
      await send('AudioOn', video);
    }
  }

  private async setLogos(on: boolean): Promise<void> {
    if (!this.cfg.logos.length) throw new PanelError('Kein Liga-Logo-Input konfiguriert');
    for (const l of this.cfg.logos) {
      await this.vmix.call(on ? { Function: `OverlayInput${l.overlay}In`, Input: this.ref(l.input) } : { Function: `OverlayInput${l.overlay}Out` });
    }
  }

  /** The one exception to "logos always on": while a `logosOffFor` input (the league trailer) is on program they go off, and come back after it. */
  private async trailerLogos(): Promise<void> {
    const active = this.activeInput();
    const trailer = !!active && this.cfg.logosOffFor.some((i) => this.findInput(i) === active);
    if (trailer && !this.trailerHidden.length) {
      const on = this.cfg.logos.flatMap((l) => {
        const inp = this.findInput(l.input);
        return inp && this.vm?.overlays[l.overlay] === inp.number ? [{ channel: l.overlay, input: inp.key }] : [];
      });
      this.trailerHidden = on;
      for (const o of on) await this.vmix.call({ Function: `OverlayInput${o.channel}Out` });
    } else if (!trailer && this.trailerHidden.length) {
      const back = this.trailerHidden;
      this.trailerHidden = [];
      for (const o of back) await this.vmix.call({ Function: `OverlayInput${o.channel}In`, Input: o.input });
    }
  }

  private needSponsors(): Sponsors {
    if (!this.sponsors) throw new PanelError('Kein Sponsor-Input konfiguriert');
    return this.sponsors;
  }

  private async hideClock(): Promise<void> {
    const sb = this.cfg.scoreboard;
    if (!this.cfg.replay.hideScoreboard || !sb?.overlay) return;
    // The clock, or the shoot-out display that has taken its place.
    const inp = [sb.input, this.shootout?.input].map((i) => this.findInput(i)).find((i) => i && this.vm?.overlays[sb.overlay as number] === i.number);
    if (!inp) return;
    await this.vmix.call({ Function: `OverlayInput${sb.overlay}Out` });
    this.clockHidden = inp.key;
  }

  /**
   * Highlights and the break run without clock, graphics and sponsors; they come back afterwards. The league logos
   * stay: they have to be on for the whole broadcast. `all` takes them off too (the highlight video is not broadcast).
   */
  private async hideOverlays(all = false): Promise<void> {
    for (const [channel, number] of Object.entries(this.vm?.overlays ?? {})) {
      const input = this.vm?.inputs.find((i) => i.number === number);
      if (!input || (!all && this.cfg.logos.some((l) => l.overlay === Number(channel)))) continue;
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
      const input = this.clockHidden;
      this.clockHidden = null;
      await this.vmix.call({ Function: `OverlayInput${sb.overlay}In`, Input: input });
    }
    if (!this.holdOverlays) await this.restoreOverlays();
  }

  /**
   * Lines an input up in vMix's preview: a video clip rewound to its first frame, so the operator sees what comes
   * next and the clip is loaded before it is taken. Never touches the input that is on program.
   */
  private async cue(input: string | number): Promise<void> {
    const inp = this.findInput(input);
    if (!inp || this.activeInput() === inp) return;
    const calls = inp.duration > 0 ? ['Restart', 'Pause', 'PreviewInput'] : ['PreviewInput'];
    await this.exclusive(async () => {
      for (const fn of calls) await this.vmix.call({ Function: fn, Input: inp.key });
    }).catch(() => {});
  }

  /**
   * Plays a video clip on program: cued in preview, taken, played from its start. Then the next picture of the
   * sequence is cued, and (unless wait is false) this returns when the clip has finished.
   * alreadyOn: vMix may have gone to this clip by itself (it returns to preview after a reel); if it is already
   * playing on program it is left to finish instead of being started a second time.
   */
  private async playClip(input: string, opts: { wait?: boolean; seconds?: number; next?: string | number; alreadyOn?: boolean } = {}): Promise<void> {
    const inp = this.findInput(input);
    const running = opts.alreadyOn && inp && this.activeInput() === inp && inp.state === 'Running';
    if (!running) {
      await this.cue(input);
      const ref = this.ref(input);
      await this.exclusive(async () => {
        for (const fn of ['CutDirect', 'Play']) await this.vmix.call({ Function: fn, Input: ref });
      });
    }
    const started = Date.now() - (running && inp ? inp.position : 0);
    if (opts.next !== undefined) {
      await sleep(700); // let vMix report the clip on program first, cue() leaves the program input alone
      await this.cue(opts.next);
    }
    if (opts.wait !== false) await this.clipFinished(input, started, opts.seconds);
  }

  /** Waits until a clip that started at `started` is over: by its length, sooner if vMix reports it has stopped or is no longer on program. */
  private async clipFinished(input: string, started: number, seconds?: number): Promise<void> {
    const length = seconds !== undefined ? seconds * 1000 : this.findInput(input)?.duration ?? 0;
    for (;;) {
      const elapsed = Date.now() - started;
      const inp = this.findInput(input);
      let remaining = length - elapsed;
      // vMix's own position corrects the clock once the clip is seen running (a slow start, a seek by hand).
      if (inp && seconds === undefined && inp.state === 'Running' && inp.position > 0) remaining = Math.min(remaining, inp.duration - inp.position);
      if (remaining <= 0) return;
      if (elapsed > 1500 && inp && (this.activeInput() !== inp || inp.state !== 'Running')) return; // cut away, or ended early
      await sleep(Math.min(remaining, 200));
    }
  }

  /**
   * A reel as shown on the stream: intro clips, all scenes of one event tab, outro clips.
   * If the tab is empty only the intro runs once; the outro (the same clips) would look like a repeat.
   */
  private async clip(tab: number, music: string | undefined): Promise<void> {
    const { intro, outro } = this.cfg.replay.highlightClip;
    // The music is not switched here: directSound() follows the program (clips without music, scenes with it).
    this.sequences++;
    try {
      for (const [i, c] of intro.entries()) await this.playClip(c, { next: intro[i + 1] });
      if (!(await this.exclusive(() => this.playReel(tab, music)))) return;
      if (outro.length) await this.cueAfterReel(outro[0]);
      await this.waitPlayback();
      for (const [i, c] of outro.entries()) await this.playClip(c, { next: outro[i + 1], alreadyOn: i === 0 });
    } finally {
      this.sequences--;
    }
  }

  /**
   * When a reel ends, vMix transitions back by itself to the input in preview. Without this that is the clip shown
   * before the reel, which would then appear again. So once the replay is on air, the clip that follows is rewound
   * and put into preview.
   */
  private async cueAfterReel(input: string): Promise<void> {
    for (const end = Date.now() + 3000; !this.playing?.seen && Date.now() < end;) await sleep(200);
    await this.cue(input); // does nothing while that clip is still on program
  }

  private async waitPlayback(maxMs = 10 * 60_000): Promise<void> {
    const giveUp = Date.now() + maxMs;
    await sleep(600);
    while (this.playing && Date.now() < giveUp) await sleep(300);
  }

  /** Plays all scenes of one event tab to output, clean (no overlays), with the given music input under them. */
  private async playReel(tab: number, music: string | undefined, speed = 1): Promise<boolean> {
    const { replay } = this.cfg;
    if (!this.book.count(tab)) return false; // nothing to show
    await this.hideOverlays();
    // Which music belongs under these scenes; directSound() starts it the moment the replay is on program.
    this.reelMusic = music;
    this.reelMusicStarted = false;
    await this.book.playTab(tab, replay.channel);
    // The scenes need at least their own length: seconds per camera angle, slower at reduced speed.
    // The floor is half that estimate: enough to rule out an early end, without holding on if vMix plays faster.
    const minMs = this.book.inTab(tab).reduce((sum, r) => sum + this.book.length(r) * r.cams.length, 0) * 500 / speed;
    this.playing = { id: null, since: Date.now(), seen: false, minUntil: Date.now() + minMs, offSince: 0 };
    return true;
  }

  /**
   * "Export" of the highlight video: vMix cannot render a file from a playlist, so the panel plays the template
   * (fixed clips and the highlight list) through the program output in real time while vMix records it.
   */
  private async exportVideo(): Promise<void> {
    const template = this.cfg.postGame.highlightVideo?.template ?? [];
    this.video.status = 'running';
    this.sequences++;
    try {
      await this.exclusive(async () => {
        await this.setAudio(false).catch(() => {}); // no open microphones in the video
        this.holdOverlays = true;
        await this.hideOverlays(true); // no graphics over any part of the video, fixed clips included
        await this.vmix.call({ Function: 'StartRecording' });
      });
      await sleep(1000);
      for (const [i, item] of template.entries()) {
        this.video.step = i;
        this.broadcast();
        if ('input' in item) {
          const after = template[i + 1];
          await this.playClip(item.input, { seconds: item.seconds, next: after && 'input' in after ? after.input : undefined });
        } else {
          const started = await this.exclusive(async () => {
            await this.vmix.call({ Function: 'ReplaySetSpeed', Value: this.video.speed / 100 });
            return this.playReel(this.cfg.replay.highlightTab, this.cfg.replay.highlightMusic || undefined, this.video.speed / 100);
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
      this.sequences--;
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
      const last = i === steps.length - 1;
      // ... and what the one-tap end does (e.g. back to the game) to the last one.
      const calls = [...(i === 0 ? sc.start?.calls ?? [] : []), ...(step.action?.calls ?? []), ...(last ? sc.end?.calls ?? [] : [])];
      let error = '';
      if (calls.length) await this.run(calls, SIM_MAX_HOLD_MS).catch((e) => { error = errorText(e); });
      sim.results[i] = { ok: !error, text: error };
      if (i === steps.length - 1) break;

      const realGap = offsetSec(steps[i + 1].at) - offsetSec(step.at);
      // Only a clip that was cut to program needs its running time (not background music); a step's own holds have
      // already passed inside run(). Long clips such as the break video are only sampled.
      const started = (c: VmixCall) => ('clip' in c ? (c.wait ? undefined : c.clip) : 'Function' in c && c.Function === 'CutDirect' ? c.Input : undefined);
      const clips = calls.map((c) => (this.findInput(started(c))?.duration ?? 0) / 1000);
      const longest = Math.max(0, ...clips);
      const clipSec = longest > SIM_FULL_CLIP_SEC ? SIM_LONG_CLIP_SEC : longest;
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
      const cameras = mark.cams.map((c) => this.cam(c).replayCamera);
      const time = this.score()?.clock || hhmm(Date.now());
      try {
        const scene = await this.book.mark(this.period(), replay.seconds, cameras, { time, cams: mark.cams, type: replay.defaultType, fav: false });
        return { id: scene.id, cams: scene.cams };
      } finally {
        this.persist(); // also when a call after the mark failed: the event exists and is in the book
      }
    },

    'replay/type': async ({ id, type }) => {
      const r = this.entry(id);
      if (!this.cfg.replay.types.includes(type)) throw new PanelError(`Unbekannter Typ ${type}`);
      await this.book.setType(r, type);
      await this.syncHighlight(r); // e.g. a goal is a highlight without a star
      this.persist();
    },

    'replay/cam': async ({ id, cam, on }) => {
      const r = this.entry(id);
      const wanted = on ? [...r.cams, cam] : r.cams.filter((c) => c !== cam);
      if (!wanted.length) throw new PanelError('Ein Replay braucht mindestens eine Kamera');
      await this.book.setCamera(r, this.cam(cam).replayCamera, on, this.cfg.cams.map((c) => c.id).filter((c) => wanted.includes(c)));
      this.persist();
    },

    'replay/trim': async ({ id, in: inSeconds, out: outSeconds }) => {
      const r = this.entry(id);
      if (this.book.length(r) + outSeconds - inSeconds < 1) throw new PanelError('Ein Replay muss mindestens 1 Sekunde lang sein');
      try {
        await this.book.trim(r, inSeconds, outSeconds, this.cfg.replay.fps);
      } finally {
        this.persist();
      }
    },

    'replay/fav': async ({ id, fav }) => {
      const r = this.entry(id);
      r.fav = fav;
      await this.syncHighlight(r);
      this.persist();
    },

    'replay/play': async ({ id }) => {
      const r = this.entry(id);
      await this.hideClock();
      await this.book.play(r, true);
      this.playing = { id, since: Date.now(), seen: false, minUntil: 0, offSince: 0 };
    },

    // Plays the scene in vMix's preview only, to check it before it goes on air.
    'replay/preview': async ({ id }) => {
      const r = this.entry(id);
      const replay = this.replayInput();
      if (!replay) throw new PanelError('Kein Replay-Input in vMix gefunden');
      if (this.replayOnAir()) throw new PanelError('Replay ist gerade auf Sendung');
      await this.vmix.call({ Function: 'PreviewInput', Input: replay.key });
      await this.book.play(r, false);
    },

    'replay/delete': async ({ id }) => {
      await this.book.remove(this.entry(id));
      if (this.playing?.id === id) this.playing = null;
      this.persist();
    },

    'replay/period': async ({ period }) => {
      if (period !== null && period >= this.cfg.replay.periods.length) throw new PanelError('Unbekannter Spielabschnitt');
      this.periodManual = period;
      this.persist();
    },

    'break/period': async ({ period }) => {
      if (period >= this.cfg.replay.periods.length) throw new PanelError('Unbekannter Spielabschnitt');
      this.breakPeriod = period;
    },

    'audio/preset': async ({ preset }) => { await this.setAudio(preset === 'game'); },

    'audio/source': async ({ id, on }) => {
      if (!this.cfg.audio?.sources.some((s) => s.id === id)) throw new PanelError(`Unbekannte Tonquelle ${id}`);
      await this.setAudio(on, id);
    },

    music: async ({ play }) => {
      const m = this.cfg.audio?.music;
      if (!m) throw new PanelError('Keine Musik konfiguriert');
      const input = this.ref(m.input);
      if (play) await this.vmix.call({ Function: 'AudioOn', Input: input });
      await this.vmix.call({ Function: play ? 'Play' : 'Pause', Input: input });
    },

    'break/sound': async ({ music }) => {
      this.breakMusic = music;
      this.persist();
      // directSound() applies it within a second while the break video is the picture; otherwise it is the choice for the next break.
    },

    'sponsor/now': async () => { await this.needSponsors().show(); },
    'sponsor/show': async ({ nr }) => { await this.needSponsors().show(nr); },
    'sponsor/hide': async () => { await this.needSponsors().hide(); },
    'sponsor/auto': async ({ enabled }) => { this.needSponsors().setAuto(enabled); },

    toggle: async ({ what, on }) => {
      if (what === 'stream') await this.vmix.call({ Function: on ? 'StartStreaming' : 'StopStreaming' });
      else if (what === 'rec') await this.vmix.call({ Function: on ? 'StartRecording' : 'StopRecording' });
      else if (what === 'replayRec') await this.vmix.call({ Function: on ? 'ReplayStartRecording' : 'ReplayStopRecording' });
      else await this.setLogos(on);
    },

    'stream/start': async () => {
      // E.g. mics closed and music on before anything goes out. A failing call must not keep the stream from starting.
      for (const c of this.cfg.preGame.onStreamStart) {
        if (!('wait' in c) && !('panel' in c && c.panel === 'waitPlayback')) await this.step(c).catch(() => {});
      }
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
      if (this.schedule.running?.[sc.id]) throw new PanelError(`${sc.title} läuft bereits`);
      this.schedule.id = sc.id;
      this.schedule.anchors[sc.id] = Math.ceil((Date.now() + (minutes ?? start.minutes) * 60000) / 1000) * 1000;
      this.schedule.rounds[sc.id] = (this.schedule.rounds[sc.id] ?? 0) + 1;
      this.schedule.running = { ...this.schedule.running, [sc.id]: true };
      this.persist();
      this.background(start.label, () => this.run(start.calls));
    },

    'schedule/end': async ({ id }) => {
      const sc = this.cfg.schedules.find((s) => s.id === id);
      const end = sc?.end;
      if (!sc || !end) throw new PanelError(`Ablauf ${id} hat keinen Abschluss-Knopf`);
      if (!this.schedule.running?.[sc.id]) throw new PanelError(`${sc.title} läuft nicht`); // e.g. a second tap
      this.schedule.running = { ...this.schedule.running, [sc.id]: false };
      // The break is over: its clip choice is used up, and a hand-set period moves on to the next one.
      this.breakPeriod = null;
      if (this.periodManual !== null) this.periodManual = Math.min(this.periodManual + 1, this.cfg.replay.periods.length - 1);
      this.schedule.anchors[sc.id] = Date.now();
      this.persist();
      this.background(end.label, () => this.run(end.calls));
    },

    'schedule/action': async ({ step, id }) => {
      const s = this.scheduleCfg(id).steps[step];
      const action = s?.action;
      if (!action) throw new PanelError('Schritt hat keine Aktion');
      this.triggered.add(this.stepKey(this.scheduleCfg(id).id, step));
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
      if (!this.book.highlights().length) throw new PanelError('Keine Highlights markiert');
      this.background('Highlight-Video', () => this.exportVideo());
    },

    // The break's scenes once more, without intro and outro.
    'break/clip': async () => {
      if (!(await this.playReel(this.breakTab(), this.cfg.audio?.music?.input))) throw new PanelError('In diesem Abschnitt sind keine Szenen markiert');
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

    'gfx/import': async ({ text }) => {
      // A game config ([Home], [Away]) or TCunihockey's system config with the sponsors ([Sponsor01] ...), or both in one.
      const sections = parseIni(text);
      const sponsors = parseSponsors(sections);
      const game = !!sections.home && !!sections.away;
      if (!game && !sponsors) throw new PanelError('Weder Spiel-Konfiguration ([Home], [Away]) noch Sponsoren ([Sponsor01]) gefunden');
      if (game) {
        if (!this.gfx) throw new PanelError('In config.json sind keine Einblender (graphics) hinterlegt');
        this.gfx.load(text);
        this.gameConfig = text;
      }
      if (sponsors) {
        this.needSponsors().import(sponsors);
        this.sponsorSet = sponsors;
      }
      this.persist();
      return { game, sponsors: sponsors?.list.length ?? 0 };
    },

    'gfx/show': async (req) => {
      await this.showGraphic(req);
    },

    'gfx/next': async () => { await this.gfx?.next(); },
    'gfx/hide': async () => { await this.showGraphic('hide'); },

    'scoreboard/mode': async ({ manual }) => {
      // Taking over mid-game: start from what the scoreboard link last wrote into the title.
      const sb = this.cfg.scoreboard;
      const fields = (sb && this.findInput(sb.input)?.fields) || {};
      const time = [sb?.clock ?? []].flat().map((f) => fields[f] ?? '').join('').match(/^(\d{1,2}):(\d{2})$/);
      const score = this.scoreNumbers();
      const bd = this.bodet?.hasData ? this.bodet : null; // the Scorepad's last word is more exact than the title, and has the penalties
      this.needBoard().setMode(manual, {
        seconds: bd ? bd.seconds : time ? Number(time[1]) * 60 + Number(time[2]) : undefined,
        period: bd ? bd.period : sb?.period ? fields[sb.period]?.trim() : undefined,
        home: this.bodet ? undefined : score?.home, away: this.bodet ? undefined : score?.away, // with the link the count is already the panel's
        penalties: bd ? { home: bd.penalties('home'), away: bd.penalties('away') } : undefined,
      });
    },
    'scoreboard/show': async ({ on }) => {
      const sb = this.cfg.scoreboard;
      if (!sb) throw new PanelError('In config.json ist keine Matchuhr hinterlegt (scoreboard)');
      await this.vmix.call(on ? { Function: `OverlayInput${sb.overlay ?? 1}In`, Input: this.ref(sb.input) } : { Function: `OverlayInput${sb.overlay ?? 1}Out` });
    },
    'scoreboard/run': async ({ on }) => { this.needBoard().run(on); },
    'scoreboard/adjust': async ({ seconds }) => { this.needBoard().adjust(seconds); },
    'scoreboard/time': async ({ seconds }) => { this.needBoard().setTime(seconds); },
    'scoreboard/period': async ({ period }) => { this.needBoard().setPeriod(period); },
    'scoreboard/goal': async ({ team, delta }) => { this.needBoard().goal(team, delta); },
    'scoreboard/penalty': async ({ team, slot, seconds }) => { this.needBoard().penalty(team, slot, seconds); },
    'scoreboard/addPenalty': async ({ team, label }) => { this.needBoard().startPenalty(team, label); },
    'scoreboard/reset': async ({ what }) => { this.needBoard().reset(what); },

    'shootout/show': async ({ on }) => {
      const so = this.needShootout();
      if (on) { await so.show(this.shootoutFacts()); return; }
      const clock = this.findInput(this.cfg.scoreboard?.input);
      await so.hide(clock?.key); // the match clock comes back in its place
    },
    'shootout/shot': async ({ team, result }) => { await this.needShootout().shot(team, result); },
    'shootout/undo': async ({ team }) => { await this.needShootout().undo(team); },
    'shootout/reset': async ({ all }) => { await this.needShootout().reset(all); },

    tick: async ({ id, done }) => {
      this.ticks[id] = done;
      this.persist();
    },

    // New game on the same day (or after a test run): forget ticks, the match log and the panel's replay list.
    'match/reset': async () => {
      if (this.vm?.streaming) throw new PanelError('Nicht möglich, solange der Stream läuft');
      this.ticks = {};
      this.monitor.log = emptyLog();
      this.book.reset();
      this.shootout?.reset(true).catch(() => {});
      this.periodScores = [];
      this.periodManual = null;
      this.breakPeriod = null;
      this.schedule = { id: this.cfg.schedules[0].id, anchors: { [this.cfg.schedules[0].id]: this.kickoff() }, rounds: {} };
      this.video.status = 'idle';
      this.fired.clear();
      this.persist();
    },
  };
}
