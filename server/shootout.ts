import type { GfxSide } from '../shared/actions';
import type { ShootoutState, Shot } from '../shared/state';
import { PanelError } from './errors';
import type { VmixParams } from './vmix';

export interface ShootoutConfig {
  input: string; // the league's penalty shoot-out title
  overlay: number; // the match clock's channel: the display takes the clock's place
  colors: { open: string; goal: string; miss: string };
}

/** What the title shows besides the attempts; taken from the match clock so both look the same. */
export interface ShootoutFacts {
  homeName: string;
  awayName: string;
  homeScore: string;
  awayScore: string;
  homeLogo: string;
  awayLogo: string;
}

const SLOTS = 5; // circles per team in the title
const SIDES: GfxSide[] = ['home', 'away'];
const circle = (side: GfxSide, n: number) => `Circ${side === 'home' ? 'Home' : 'Away'}Shot${n}.Fill.Color`;

/**
 * The penalty shoot-out display: the league's title with five circles per team that takes the place of the match
 * clock. Every attempt colours the next circle of its team as scored or missed. After five attempts each the
 * circles are cleared for the next round; the tally of goals goes on.
 */
export class Shootout {
  private on = false;
  private shownAt = 0;
  private rows: Record<GfxSide, Shot[]> = { home: [], away: [] };
  private taken: Record<GfxSide, Shot[]> = { home: [], away: [] }; // every attempt, also of cleared rounds
  private sent = ''; // names and score last written into the title

  constructor(
    private readonly cfg: ShootoutConfig,
    private readonly call: (params: VmixParams) => Promise<void>,
    private readonly ref: (input: string) => string | number,
  ) {}

  get input(): string { return this.cfg.input; }
  get live(): boolean { return this.on; }

  private text(field: string, value: string): Promise<void> {
    return this.call({ Function: 'SetText', Input: this.ref(this.cfg.input), SelectedName: `${field}.Text`, Value: value });
  }

  private async paint(side: GfxSide, n: number): Promise<void> {
    const shot = this.rows[side][n - 1];
    await this.call({ Function: 'SetColor', Input: this.ref(this.cfg.input), SelectedName: circle(side, n), Value: this.cfg.colors[shot ?? 'open'] });
  }

  private async paintAll(): Promise<void> {
    for (const side of SIDES) for (let n = 1; n <= SLOTS; n++) await this.paint(side, n);
  }

  /** Names and score, written only when they changed. */
  async facts(f: ShootoutFacts): Promise<void> {
    const key = JSON.stringify(f);
    if (key === this.sent) return;
    this.sent = key;
    await this.text('TxtHomeName', f.homeName);
    await this.text('TxtAwayName', f.awayName);
    await this.text('TxtHomeScore', f.homeScore);
    await this.text('TxtAwayScore', f.awayScore);
    for (const [field, file] of [['ImgHomeTeam', f.homeLogo], ['ImgAwayTeam', f.awayLogo]]) {
      if (file) await this.call({ Function: 'SetImage', Input: this.ref(this.cfg.input), SelectedName: `${field}.Source`, Value: file });
    }
  }

  /** Puts the display on the clock's channel, with the attempts entered so far. */
  async show(f: ShootoutFacts): Promise<void> {
    this.sent = '';
    await this.facts(f);
    await this.paintAll();
    await this.call({ Function: `OverlayInput${this.cfg.overlay}In`, Input: this.ref(this.cfg.input) });
    this.on = true;
    this.shownAt = Date.now();
  }

  /** Takes the display off; with a clock input the match clock comes back in its place. */
  async hide(clock?: string | number): Promise<void> {
    this.on = false;
    await this.call(clock !== undefined ? { Function: `OverlayInput${this.cfg.overlay}In`, Input: clock } : { Function: `OverlayInput${this.cfg.overlay}Out` });
  }

  async shot(side: GfxSide, result: Shot): Promise<void> {
    if (this.rows[side].length >= SLOTS) {
      // The sixth attempt starts a new round, but only once the other team has finished the round as well.
      const other = side === 'home' ? 'away' : 'home';
      if (this.rows[other].length < SLOTS) throw new PanelError('Alle fünf Versuche sind eingetragen. Zuerst das andere Team eintragen oder die Anzeige leeren.');
      this.rows = { home: [], away: [] };
      await this.paintAll();
    }
    this.rows[side].push(result);
    this.taken[side].push(result);
    await this.paint(side, this.rows[side].length);
  }

  /** Takes back the last attempt of a team. */
  async undo(side: GfxSide): Promise<void> {
    if (!this.rows[side].length) throw new PanelError('Kein Versuch eingetragen');
    this.rows[side].pop();
    this.taken[side].pop();
    await this.paint(side, this.rows[side].length + 1);
  }

  /** Clears the circles for the next round (`all`: also forgets the tally, for a new shoot-out). */
  async reset(all: boolean): Promise<void> {
    this.rows = { home: [], away: [] };
    if (all) this.taken = { home: [], away: [] };
    await this.paintAll();
  }

  /** vMix shows something else on the channel: the display was taken off there. */
  sync(now: number, onScreen: boolean): void {
    if (this.on && !onScreen && now - this.shownAt > 2000) this.on = false;
  }

  view(): ShootoutState {
    const side = (s: GfxSide) => ({ row: this.rows[s], goals: this.taken[s].filter((x) => x === 'goal').length, attempts: this.taken[s].length });
    return { live: this.on, home: side('home'), away: side('away'), slots: SLOTS, overlay: this.cfg.overlay };
  }
}
