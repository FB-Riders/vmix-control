import type { SponsorState } from '../shared/state';
import type { Config } from './config';
import { PanelError } from './errors';
import type { VmixParams } from './vmix';

type SponsorConfig = NonNullable<Config['sponsor']>;

/** One sponsor as in TCunihockey's [Sponsor01] to [Sponsor08]. */
export interface Sponsor {
  nr: number; // 1 to 8; what the automatic order refers to
  label: string; // on the button
  title: string; // shown above the logo
  picture: string; // full path of the logo on the vMix computer
}

/** The sponsors of a TCunihockey system config. */
export interface SponsorSet {
  list: Sponsor[];
  order: number[]; // sponsor numbers in the order of the automatic rotation; may repeat
  pauseSec?: number;
  showSec?: number;
}

const SETTLE_MS = 300; // vMix needs a moment to load a logo; faded in at once the title can come up empty
const SYNC_AFTER_MS = 2000; // vMix's state lags behind a fade-in by a poll or two
const TITLE_FIELD = 'TxtTop.Text';
const PICTURE_FIELD = 'ImgSponsor.Source';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reads [Sponsor01] to [Sponsor08] and [SponsorAuto] from the sections of a TCunihockey system config. */
export function parseSponsors(sections: Record<string, Record<string, string>>): SponsorSet | null {
  const list: Sponsor[] = [];
  for (const [name, s] of Object.entries(sections)) {
    const nr = Number(name.match(/^sponsor(\d+)$/)?.[1]);
    if (!nr || !s.PicturePath) continue;
    list.push({ nr, label: s.ButtonLabel || `Sponsor ${nr}`, title: s.Title ?? '', picture: s.PicturePath });
  }
  if (!list.length) return null;
  list.sort((a, b) => a.nr - b.nr);
  const auto = sections.sponsorauto ?? {};
  const seconds = (v: string | undefined) => (Number(v) > 0 ? Number(v) : undefined);
  return {
    list,
    order: (auto.Order ?? '').split(',').map((x) => Number(x.trim())).filter((n) => list.some((s) => s.nr === n)),
    pauseSec: seconds(auto.DurationPause),
    showSec: seconds(auto.DurationShow),
  };
}

/**
 * The sponsor overlay TCunihockey used to drive: one vMix title that gets a sponsor's logo and heading and is faded
 * in on its own overlay channel. A sponsor can be shown by hand (it stays until it is taken off) or by the automatic
 * rotation (in the configured order, each for a few seconds, with a pause in between).
 *
 * Without a list of sponsors the configured inputs are faded in as they are, in turn.
 */
export class Sponsors {
  enabled = false;
  private nextAt = 0;
  private activeUntil = 0; // when the sponsor on screen is taken off again; 0 = stays until taken off
  private rotation = 0;
  private live: number | null = null; // number of the sponsor on screen; 0 = an input as it is
  private shownAt = 0;

  constructor(
    private readonly cfg: SponsorConfig,
    private readonly call: (params: VmixParams) => Promise<void>,
    private readonly ref: (input: string) => string | number,
    private imported: SponsorSet | null,
  ) {}

  import(set: SponsorSet): void {
    this.imported = set;
    this.rotation = 0;
  }

  // ---------- reading ----------

  /** An imported system config goes before config.json. */
  private get list(): Sponsor[] {
    return this.imported?.list ?? this.cfg.list.map((s, i) => ({ nr: i + 1, ...s }));
  }

  private get order(): number[] {
    const order = (this.imported?.order ?? this.cfg.order).filter((n) => this.list.some((s) => s.nr === n));
    return order.length ? order : this.list.map((s) => s.nr);
  }

  private get showSec(): number { return this.imported?.showSec ?? this.cfg.durationSec; }
  /** From one fade-in to the next. */
  private get intervalSec(): number {
    return this.imported?.pauseSec ? this.imported.pauseSec + this.showSec : this.cfg.intervalSec;
  }

  /** The sponsor the rotation shows next. */
  private upcoming(): Sponsor | undefined {
    const { order } = this;
    return this.list.find((s) => s.nr === order[this.rotation % order.length]);
  }

  // ---------- vMix ----------

  /**
   * Fades a sponsor in. Without a number it is the next one of the rotation, shown for the configured time;
   * with a number it is that sponsor, and it stays until it is taken off.
   */
  async show(nr?: number): Promise<void> {
    if (!this.cfg.inputs.length) throw new PanelError('Kein Sponsor-Input konfiguriert');
    const now = Date.now();
    let input = this.cfg.inputs[0];
    let live = 0;
    if (this.list.length) {
      const sponsor = nr === undefined ? this.upcoming() : this.list.find((s) => s.nr === nr);
      if (!sponsor) throw new PanelError('Sponsor nicht gefunden');
      await this.call({ Function: 'SetText', Input: this.ref(input), SelectedName: TITLE_FIELD, Value: sponsor.title });
      await this.call({ Function: 'SetImage', Input: this.ref(input), SelectedName: PICTURE_FIELD, Value: sponsor.picture });
      if (this.live === null) await sleep(SETTLE_MS);
      live = sponsor.nr;
    } else {
      input = this.cfg.inputs[this.rotation % this.cfg.inputs.length];
    }
    if (nr === undefined) {
      this.rotation++;
      this.nextAt = now + this.intervalSec * 1000;
    }
    // Changing the sponsor while the title is on screen needs no new fade-in (which would fade it out instead).
    if (this.live === null || !this.list.length) await this.call({ Function: `OverlayInput${this.cfg.overlay}In`, Input: this.ref(input) });
    this.live = live;
    this.shownAt = Date.now();
    this.activeUntil = nr === undefined ? this.shownAt + this.showSec * 1000 : 0;
  }

  async hide(): Promise<void> {
    this.live = null;
    this.activeUntil = 0;
    await this.call({ Function: `OverlayInput${this.cfg.overlay}Out` });
  }

  setAuto(enabled: boolean): void {
    if (!this.cfg.inputs.length) throw new PanelError('Kein Sponsor-Input konfiguriert');
    this.enabled = enabled;
    this.nextAt = enabled ? Date.now() + this.intervalSec * 1000 : 0;
  }

  /**
   * Called on every poll. `busy` = a replay is running or the overlays are held off (highlights, break): a sponsor
   * on screen is taken off, and the rotation waits until the picture is free again. `onScreen` = vMix shows a sponsor
   * input on the sponsor channel.
   */
  tick(now: number, busy: boolean, onScreen: boolean): void {
    if (this.live !== null && now - this.shownAt > SYNC_AFTER_MS && !onScreen) {
      this.live = null; // taken off in vMix itself
      this.activeUntil = 0;
    }
    if (this.live !== null && (busy || (this.activeUntil && now >= this.activeUntil))) { this.hide().catch(() => {}); return; }
    if (this.enabled && this.live === null && !busy && now >= this.nextAt) {
      this.nextAt = now + this.intervalSec * 1000; // also if vMix refuses, so a failing call is not repeated every poll
      this.show().catch(() => {});
    }
  }

  // ---------- state for the screens ----------

  view(): SponsorState {
    return {
      enabled: this.enabled, nextAt: this.nextAt, activeUntil: this.activeUntil,
      intervalSec: this.intervalSec, durationSec: this.showSec,
      live: this.live,
      next: this.upcoming()?.nr ?? null,
      list: this.list.map((s) => ({ nr: s.nr, label: s.label })),
      overlay: this.cfg.overlay,
    };
  }
}
