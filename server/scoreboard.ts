import type { GfxSide } from '../shared/actions';
import type { ManualScoreboardState } from '../shared/state';
import { PanelError } from './errors';
import type { VmixParams } from './vmix';

export interface ManualScoreboardConfig {
  periodMinutes: number; // the clock stops by itself here
  stopOnGoal: boolean; // +1 also stops the clock
  penaltyClock: Record<string, number>; // penalty graphic (e.g. "2'") -> seconds it puts on the clock; others stay off it
  periods: string[]; // what the period field shows, in order
}

/** What survives a restart. The clock is always saved stopped. */
export interface ManualScoreboardData {
  manual: boolean;
  elapsedMs: number;
  period: string;
  score: Record<GfxSide, number>;
  penalties: Record<GfxSide, number[]>; // remaining ms per slot, 0 = free
}

const SLOTS = 2; // penalty slots per team in the title
const SIDES: GfxSide[] = ['home', 'away'];
const HIDDEN = '#00000000';
const RESYNC_MS = 30_000;
const cap = (s: GfxSide) => (s === 'home' ? 'Home' : 'Away');

/** What the clock title shows: the same for the clock by hand and the one from the hall's scoreboard. */
export interface ClockFace {
  seconds: number; // game time
  period: string;
  score: Record<GfxSide, number>;
  penalties: Record<GfxSide, number[]>; // seconds left per slot of the title, 0 = free
  names: Record<GfxSide, string>; // short team names; empty = leave the title's names
  logos: Record<GfxSide, string>; // logo files on the vMix computer; empty = leave the title's logos
}

/** What is known without a running clock: teams and score. Time, period and penalties stay as the title has them. */
export type ClockTeams = Pick<ClockFace, 'score' | 'names' | 'logos'>;

/** The fields of the league's clock title for a clock face, one digit per field as the title wants it. */
export function clockFields(face: ClockFace | ClockTeams, penaltyColor: string): Record<string, string> {
  const digits = (prefix: string, total: number) => {
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return { [`${prefix}M10.Text`]: m[0], [`${prefix}M01.Text`]: m[1], [`${prefix}T.Text`]: ':', [`${prefix}S10.Text`]: s[0], [`${prefix}S01.Text`]: s[1] };
  };
  const clock = 'seconds' in face ? face : null;
  const f: Record<string, string> = {
    ...(clock ? { ...digits('TxtClockTime', clock.seconds), 'TxtClockPeriod.Text': clock.period } : {}),
    'TxtHomeScore.Text': String(face.score.home),
    'TxtAwayScore.Text': String(face.score.away),
  };
  for (const side of SIDES) {
    if (face.names[side]) f[`Txt${cap(side)}Name.Text`] = face.names[side];
    if (face.logos[side]) f[`Img${cap(side)}Team.Source`] = face.logos[side];
    for (let i = 0; clock && i < SLOTS; i++) {
      const left = clock.penalties[side][i] ?? 0;
      const prefix = `Txt${cap(side)}Pen${i + 1}`;
      // A free slot has no text and no box.
      for (const [field, value] of Object.entries(digits(prefix, left))) f[field] = left > 0 ? value : '';
      f[`Rect${cap(side)}Pen${i + 1}.Fill.Color`] = left > 0 ? penaltyColor : HIDDEN;
    }
  }
  return f;
}

/** Writes a clock face into the title: only the fields that differ from what the title holds. */
export class ClockTitle {
  private sent: Record<string, string> = {};
  private sentSince = 0;
  private writing = false;

  constructor(
    private readonly input: string,
    private readonly penaltyColor: string,
    private readonly call: (params: VmixParams) => Promise<void>,
    private readonly ref: (input: string) => string | number,
  ) {}

  /** The title may hold anything by now: the next write sends every field again. */
  forget(): void { this.sent = {}; }

  /** A second that passes changes one or two fields, so this is a few calls at most. */
  async write(face: ClockFace | ClockTeams): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      // Every now and then everything is written again, so a reloaded preset catches up.
      const now = Date.now();
      if (now - this.sentSince > RESYNC_MS) { this.sent = {}; this.sentSince = now; }
      const input = this.ref(this.input);
      for (const [field, value] of Object.entries(clockFields(face, this.penaltyColor))) {
        if (this.sent[field] === value) continue;
        await this.call({ Function: field.endsWith('.Color') ? 'SetColor' : field.endsWith('.Source') ? 'SetImage' : 'SetText', Input: input, SelectedName: field, Value: value });
        this.sent[field] = value;
      }
    } catch (e) {
      this.sent = {}; // vMix may have been restarted or the preset reloaded: start over
      throw e;
    } finally {
      this.writing = false;
    }
  }
}

const fresh = (): ManualScoreboardData => ({ manual: false, elapsedMs: 0, period: '1', score: { home: 0, away: 0 }, penalties: { home: [0, 0], away: [0, 0] } });

/**
 * The match clock driven by hand, for when the link to the hall's scoreboard fails. It works like TCunihockey's:
 * the game time counts up and stops at the end of the period, penalties count down with the game time and
 * disappear at 00:00, a new period starts at 00:00 and keeps the penalties.
 *
 * While it is switched on it owns the clock title: every change is written into the title's fields, one digit per
 * field as the title wants it. Switched off it writes nothing, and the scoreboard link is in charge again.
 */
export class ManualScoreboard {
  private d: ManualScoreboardData;
  private startedAt: number | null = null; // clock running since; elapsedMs and penalties are as of then
  names: Record<GfxSide, string> = { home: '', away: '' }; // short team names; empty = leave the title's names
  logos: Record<GfxSide, string> = { home: '', away: '' }; // logo files on the vMix computer; empty = leave the title's logos

  constructor(
    private readonly cfg: ManualScoreboardConfig,
    private readonly title: ClockTitle,
    private readonly changed: () => void, // something worth saving happened
    data?: ManualScoreboardData,
  ) {
    this.d = { ...fresh(), ...data };
  }

  toJSON(): ManualScoreboardData {
    return { ...this.d, elapsedMs: this.elapsed(), penalties: { home: this.remaining('home'), away: this.remaining('away') } };
  }

  get manual(): boolean { return this.d.manual; }
  get running(): boolean { return this.startedAt !== null; }

  // ---------- time ----------

  private get limit(): number { return this.cfg.periodMinutes * 60_000; }
  private ran(now = Date.now()): number { return this.startedAt === null ? 0 : now - this.startedAt; }
  private elapsed(now = Date.now()): number { return Math.min(this.limit, this.d.elapsedMs + this.ran(now)); }
  /** Penalties run with the game time, so they also stand still once the period is over. */
  private remaining(side: GfxSide, now = Date.now()): number[] {
    const ran = this.elapsed(now) - this.d.elapsedMs;
    return this.d.penalties[side].map((ms) => Math.max(0, ms - ran));
  }

  /** Folds the running time into the stored values, so they can be changed. */
  private settle(): void {
    const now = Date.now();
    const penalties = { home: this.remaining('home', now), away: this.remaining('away', now) };
    this.d.elapsedMs = this.elapsed(now);
    this.d.penalties = penalties;
    if (this.startedAt !== null) this.startedAt = now;
  }

  // ---------- operating ----------

  private need(): void {
    if (!this.d.manual) throw new PanelError('Die Matchuhr kommt von der Anzeigetafel. Zuerst auf «Manuell» umschalten.');
  }

  /**
   * Hands the clock title to the panel, or back to the scoreboard link. Taking over, the panel carries on from what
   * the title shows at that moment (as far as it can be read), with the clock standing still.
   */
  setMode(manual: boolean, shown?: { seconds?: number; period?: string; home?: number; away?: number; penalties?: Record<GfxSide, number[]> }): void {
    this.settle();
    this.startedAt = null;
    if (manual && !this.d.manual && shown) {
      if (shown.seconds !== undefined) this.d.elapsedMs = Math.min(this.limit, shown.seconds * 1000);
      if (shown.period && this.cfg.periods.includes(shown.period)) this.d.period = shown.period;
      if (shown.home !== undefined && shown.away !== undefined) this.d.score = { home: shown.home, away: shown.away };
      if (shown.penalties) for (const side of SIDES) this.d.penalties[side] = Array.from({ length: SLOTS }, (_, i) => (shown.penalties?.[side][i] ?? 0) * 1000);
    }
    this.d.manual = manual;
    this.title.forget();
    this.changed();
  }

  run(on: boolean): void {
    this.need();
    this.settle();
    if (on && this.d.elapsedMs >= this.limit) throw new PanelError('Der Spielabschnitt ist zu Ende. Zuerst den nächsten wählen oder die Zeit korrigieren.');
    this.startedAt = on ? Date.now() : null;
    this.changed();
  }

  /** Moves the game time to `ms`; running penalties move with it, as they run with the game time. */
  private moveTo(ms: number): void {
    this.need();
    this.settle();
    const before = this.d.elapsedMs;
    this.d.elapsedMs = Math.min(this.limit, Math.max(0, ms));
    const moved = this.d.elapsedMs - before;
    for (const side of SIDES) this.d.penalties[side] = this.d.penalties[side].map((left) => (left > 0 ? Math.max(0, left - moved) : 0));
    this.changed();
  }

  /** Corrects the game time by seconds. */
  adjust(seconds: number): void { this.moveTo(this.elapsed() + seconds * 1000); }

  /** Sets the game time. */
  setTime(seconds: number): void { this.moveTo(seconds * 1000); }

  /** Next period: the time starts at 00:00 again and stands still; the penalties stay. */
  setPeriod(period: string): void {
    this.need();
    if (!this.cfg.periods.includes(period)) throw new PanelError('Unbekannter Spielabschnitt');
    this.settle();
    this.startedAt = null;
    this.d.elapsedMs = 0;
    this.d.period = period;
    this.changed();
  }

  /** The score is the panel's own count also while the hall's scoreboard gives the time. */
  goal(side: GfxSide, delta: number): void {
    if (delta > 0 && this.cfg.stopOnGoal && this.running) { this.settle(); this.startedAt = null; }
    this.d.score[side] = Math.max(0, this.d.score[side] + delta);
    this.changed();
  }

  /** Puts a penalty of the given length into a slot (1 or 2); 0 clears the slot. */
  penalty(side: GfxSide, slot: number, seconds: number): void {
    this.need();
    if (slot < 1 || slot > SLOTS) throw new PanelError('Unbekannte Strafe');
    this.settle();
    this.d.penalties[side][slot - 1] = Math.max(0, seconds * 1000);
    this.changed();
  }

  /**
   * A penalty graphic was shown: the penalty also goes on the clock, into the team's first free slot.
   * False if this kind of penalty is not shown on the clock or both slots are taken.
   */
  addPenalty(side: GfxSide, label: string): boolean {
    try { this.startPenalty(side, label); return true; } catch { return false; }
  }

  /** Starts a penalty of the given kind in the team's first free slot. */
  startPenalty(side: GfxSide, label: string): void {
    this.need();
    const seconds = this.cfg.penaltyClock[label];
    if (!seconds) throw new PanelError(`${label} läuft nicht auf der Matchuhr`);
    const slot = this.remaining(side).findIndex((ms) => ms === 0);
    if (slot < 0) throw new PanelError('Beide Strafen-Plätze sind belegt. Zuerst eine Strafe löschen.');
    this.penalty(side, slot + 1, seconds);
  }

  get score(): Record<GfxSide, number> { return this.d.score; }
  get period(): string { return this.d.period; }

  /** Back to the start of a game: the goal count, or time, period and penalties of the clock by hand. */
  reset(what: 'score' | 'clock'): void {
    if (what === 'score') {
      this.d.score = { home: 0, away: 0 };
    } else {
      this.startedAt = null;
      this.d = { ...fresh(), manual: this.d.manual, score: this.d.score };
    }
    this.changed();
  }

  // ---------- vMix ----------

  /** What the title should show right now. */
  private face(now: number): ClockFace {
    // Game time shows the second that has begun, a penalty the second that is still running.
    const left = (side: GfxSide) => this.remaining(side, now).map((ms) => Math.ceil(ms / 1000));
    return {
      seconds: Math.floor(this.elapsed(now) / 1000), period: this.d.period, score: this.d.score,
      penalties: { home: left('home'), away: left('away') }, names: this.names, logos: this.logos,
    };
  }

  /** Called several times a second: stops the clock at the end of the period and brings the title up to date. */
  async push(now = Date.now()): Promise<void> {
    if (!this.d.manual) return;
    if (this.running && this.elapsed(now) >= this.limit) { this.settle(); this.startedAt = null; this.changed(); }
    await this.title.write(this.face(now));
  }

  // ---------- state for the screens ----------

  view(): Omit<ManualScoreboardState, 'onAir' | 'bodet' | 'counts'> {
    return {
      manual: this.d.manual,
      // Time and penalties as of `runningSince`; the screens count on from there by themselves.
      runningSince: this.startedAt,
      elapsedMs: this.d.elapsedMs,
      limitMs: this.limit,
      period: this.d.period, periods: this.cfg.periods,
      score: this.d.score,
      penalties: this.d.penalties,
    };
  }
}
