import type { GfxRequest, GfxSide } from '../shared/actions';
import type { GfxState, GfxTeam } from '../shared/state';
import type { Config } from './config';
import { PanelError } from './errors';
import type { VmixParams } from './vmix';

type GraphicsConfig = NonNullable<Config['graphics']>;
type TitleKey = keyof GraphicsConfig['titles'];

/** One team as written in a TCunihockey game config. */
interface Team {
  long: string;
  short: string;
  coach: string;
  players: Record<string, string>; // shirt number -> "Vorname Nachname"
  topscorer: string; // name filed under 00; shown with the top scorer icon
  lines: string[][]; // shirt numbers: defender left, defender right, centre, wing left, wing right
  goalies: string[];
  starting: string[]; // shirt numbers of the starting six as entered (Starting6); may be empty
}

interface Game {
  title: string;
  date: string;
  time: string;
  location: string;
  referees: string[];
  commentators: string[];
  home: Team;
  away: Team;
}

/** What goes into one vMix title before it is faded in. */
interface Graphic {
  title: TitleKey;
  text: Record<string, string>; // GT field (without ".Text") -> content
  image?: Record<string, string>; // GT image (without ".Source") -> file on the vMix computer
  visible?: Record<string, boolean>; // GT image -> shown or hidden
  summary: string; // for the operator
}

const TOPSCORER = '00';
const HIDDEN = '#00000000';
const empty = (n: string | undefined) => !n || n === '-';

/**
 * Reads a TCunihockey game config (the format written by unihockey.live/generator):
 * [Game] with the match data, [Home] and [Away] with "number=name" per player plus team keys.
 */
export function parseGameConfig(text: string): Game {
  return readGame(parseIni(text));
}

/** The sections of a TCunihockey config file ("[Name]" followed by "key=value" lines); section names in lower case. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const head = line.match(/^\[(.+)\]$/);
    if (head) { current = head[1].toLowerCase(); sections[current] ??= {}; continue; }
    const eq = line.indexOf('=');
    if (!current || eq < 1) continue;
    sections[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

function readGame(sections: Record<string, Record<string, string>>): Game {
  if (!sections.home || !sections.away) throw new PanelError('Das ist keine Spiel-Konfiguration: [Home] und [Away] fehlen');

  const list = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim());
  const team = (s: Record<string, string>): Team => {
    const players: Record<string, string> = {};
    for (const [k, v] of Object.entries(s)) if (/^\d+$/.test(k) && k !== TOPSCORER && v) players[k] = v;
    return {
      long: s.TeamLong ?? '', short: s.TeamShort ?? '', coach: s.Headcoach ?? s.Coach ?? '',
      players, topscorer: s[TOPSCORER] ?? '',
      lines: [s.Line1, s.Line2, s.Line3, s.Line4].map(list),
      goalies: list(s.Goal),
      starting: list(s.Starting6),
    };
  };
  const g = sections.game ?? {};
  return {
    title: g.Title ?? '', date: g.Date ?? '', time: g.Time ?? '', location: g.Location ?? '',
    referees: [g.Referee1, g.Referee2].filter((x): x is string => !!x),
    commentators: [g.Commentator1, g.Commentator2].filter((x): x is string => !!x),
    home: team(sections.home), away: team(sections.away),
  };
}

/**
 * The on-screen graphics TCunihockey used to drive: fills the league's vMix titles from the game config and fades
 * them in on one overlay channel, one at a time. The match clock is not touched; it comes from the scoreboard.
 */
export class Graphics {
  private game: Game | null = null;
  private live: { kind: GfxRequest['kind']; team?: GfxSide; summary: string; until: number | null } | null = null; // until: taken off by itself then
  private six: { team: GfxSide; shown: number } | null = null; // starting six being presented

  constructor(
    private readonly cfg: GraphicsConfig,
    private readonly call: (params: VmixParams) => Promise<void>,
    private readonly ref: (input: string) => string | number,
    private readonly colors: (input: string) => string[], // colour fields the title has
  ) {}

  get loaded(): boolean { return !!this.game; }
  /** Kind of the graphic that is on, if any. */
  get liveKind(): GfxRequest['kind'] | null { return this.live?.kind ?? null; }

  load(text: string): void {
    this.game = parseGameConfig(text);
  }

  // ---------- reading ----------

  private need(): Game {
    if (!this.game) throw new PanelError('Noch keine Spiel-Konfiguration geladen');
    return this.game;
  }

  private team(side: GfxSide | undefined): Team {
    if (!side) throw new PanelError('Team fehlt');
    return this.need()[side];
  }

  private logo(t: Team): string {
    return this.cfg.logoPath && t.short ? `${this.cfg.logoPath.replace(/[\\/]$/, '')}\\${t.short}${this.cfg.logoExt}` : '';
  }

  /** Number and name as they appear in a title. The top scorer keeps the icon instead of a number where a list says 00. */
  private player(t: Team, nr: string | undefined): { nr: string; name: string; top: boolean } {
    if (empty(nr)) return { nr: '', name: '', top: false };
    if (nr === TOPSCORER) return { nr: '', name: t.topscorer.toUpperCase(), top: !!t.topscorer };
    const name = t.players[nr as string] ?? '';
    return { nr: nr as string, name: name.toUpperCase(), top: !!name && name === t.topscorer };
  }

  /** The starting six as the game config names them (Starting6); without that, the first goalie and the first line. */
  private startingSix(t: Team): string[] {
    const named = t.starting.filter((n) => !empty(n));
    return (named.length ? named : [t.goalies[0], ...(t.lines[0] ?? [])].filter((n) => !empty(n))).slice(0, 6);
  }

  /** Short names and logo files of both teams, for the shoot-out display. */
  teams(): Record<GfxSide, { short: string; logo: string }> | null {
    const g = this.game;
    return g ? { home: { short: g.home.short, logo: this.logo(g.home) }, away: { short: g.away.short, logo: this.logo(g.away) } } : null;
  }

  // ---------- composing ----------

  private compose(req: GfxRequest, score: string, periods: string): Graphic {
    const { labels } = this.cfg;
    const g = this.need();
    const names = (people: string[], what: string) => {
      const picked = req.value === '1' ? people.slice(0, 1) : req.value === '2' ? people.slice(1, 2) : people;
      if (!picked.length) throw new PanelError(`${what} fehlt in der Spiel-Konfiguration`);
      return picked.join('\n');
    };
    const board = (top: string, main: string, bottom: string, summary: string): Graphic => ({
      title: 'board', summary,
      text: { TxtHomeTeam: g.home.long.toUpperCase(), TxtAwayTeam: g.away.long.toUpperCase(), TxtTop: top.toUpperCase(), TxtMain: main, TxtBottom: bottom },
      image: { ImgHomeTeam: this.logo(g.home), ImgAwayTeam: this.logo(g.away) },
    });
    const fill = (template: string) => template.replace('{date}', g.date).replace('{time}', g.time).replace('{location}', g.location).replace('{title}', g.title);

    switch (req.kind) {
      case 'opener':
        return board(fill(this.cfg.opener.top), fill(this.cfg.opener.main), fill(this.cfg.opener.bottom), 'Opener');
      case 'result': {
        const label = labels.result[(req.value ?? 'end') as keyof typeof labels.result] ?? labels.result.end;
        return board(label, score.replace(':', ' : '), req.text ?? periods, `${label} ${score}`);
      }
      case 'commentators':
        return { title: 'leagueInfo', summary: labels.commentator, text: { TxtTop: labels.commentator.toUpperCase(), TxtInfo: names(g.commentators, 'Kommentator'), TxtBottom: '' } };
      case 'referees':
        return { title: 'leagueInfo', summary: labels.referee, text: { TxtTop: labels.referee.toUpperCase(), TxtInfo: names(g.referees, 'Schiedsrichter'), TxtBottom: '' } };
      case 'text':
        if (!req.text?.trim()) throw new PanelError('Text fehlt');
        return { title: 'leagueInfo', summary: req.text.split('\n')[0], text: { TxtTop: '', TxtInfo: req.text.trim(), TxtBottom: '' } };
    }

    const t = this.team(req.team);
    const logo = { ImgTeam: this.logo(t) };
    switch (req.kind) {
      case 'coach':
        if (!t.coach) throw new PanelError('Coach fehlt in der Spiel-Konfiguration');
        return { title: 'teamInfo', summary: `${labels.coach} ${t.coach}`, text: { TxtTop: labels.coach.toUpperCase(), TxtInfo: t.coach.toUpperCase(), TxtBottom: '' }, image: logo };
      case 'timeout':
        return { title: 'teamInfo', summary: `${labels.timeout} ${t.short}`, text: { TxtTop: '', TxtInfo: labels.timeout.toUpperCase(), TxtBottom: '' }, image: logo };
      case 'goal':
      case 'penalty': {
        const own = req.player === 'own';
        const p = own ? { nr: '', name: labels.ownGoal.toUpperCase(), top: false } : this.player(t, req.player);
        if (!p.name) throw new PanelError('Spieler wählen');
        const event = req.kind === 'goal' ? score : req.value ?? '';
        return {
          title: 'playerEvent', summary: `${req.kind === 'goal' ? 'Tor' : `Strafe ${event}`} · ${p.nr} ${p.name}`,
          text: { TxtTop: '', TxtEvent: event, TxtNumber: p.nr, TxtName: p.name, TxtBottom: '' },
          image: logo, visible: { ImgTopscorer: p.top },
        };
      }
      case 'name':
      case 'bestPlayer': {
        const p = this.player(t, req.player);
        if (!p.name) throw new PanelError('Spieler wählen');
        const top = req.kind === 'bestPlayer' ? labels.bestPlayer.toUpperCase() : '';
        return { title: 'playerName', summary: `${top || 'Name'} · ${p.nr} ${p.name}`, text: { TxtTop: top, TxtNumber: p.nr, TxtName: p.name, TxtBottom: '' }, image: logo, visible: { ImgTopscorer: p.top } };
      }
      case 'lineup': {
        const text: Record<string, string> = {
          TxtTeam: t.long.toUpperCase(), TxtTop: labels.lineup.toUpperCase(), TxtGoaliesLbl: labels.goalies,
          TxtFuncLabel: t.coach ? labels.coach : '', TxtFuncName: t.coach.toUpperCase(),
        };
        const visible: Record<string, boolean> = {};
        const place = (pos: string, nr: string | undefined) => {
          const p = this.player(t, nr);
          text[`TxtNamePos${pos}`] = p.name;
          text[`TxtNumberPos${pos}`] = p.nr;
          visible[`ImgTopscPos${pos}`] = p.top;
        };
        for (let l = 0; l < 4; l++) {
          text[`TxtLine${l + 1}Lbl`] = labels.lines[l] ?? '';
          for (let p = 0; p < 5; p++) place(`${l + 1}${p + 1}`, t.lines[l]?.[p]);
        }
        place('51', t.goalies[0]);
        place('52', t.goalies[1]);
        return { title: req.team === 'home' ? 'lineupHome' : 'lineupAway', summary: `${labels.lineup} ${t.short}`, text, image: { ImgTeamLogo: this.logo(t) }, visible };
      }
      case 'startingSix': {
        // All six are filled in at once. The title fades in with the team logo only and keeps the players hidden;
        // next() brings them on one by one with the title's own pages.
        const text: Record<string, string> = { TxtTop: labels.startingSix.toUpperCase() };
        const visible: Record<string, boolean> = {};
        const six = this.startingSix(t);
        for (let i = 1; i <= 6; i++) {
          const p = this.player(t, six[i - 1]);
          text[`TxtNamePos${i}`] = p.name; text[`TxtNumberPos${i}`] = p.nr; visible[`ImgTopscPos${i}`] = p.top;
        }
        return { title: 'startingSix', summary: `${labels.startingSix} ${t.short}`, text, image: logo, visible };
      }
    }
    throw new PanelError('Unbekannter Einblender');
  }

  // ---------- vMix ----------

  private async fill(g: Graphic): Promise<void> {
    const input = this.ref(this.cfg.titles[g.title]);
    for (const [field, value] of Object.entries(g.text)) await this.call({ Function: 'SetText', Input: input, SelectedName: `${field}.Text`, Value: value });
    // The top and bottom line sit on a bar of their own. The titles leave it to the sender to show the bar with the
    // line and to hide it without: a line without its bar is hard to read, a bar without a line is an empty stripe.
    const has = this.colors(this.cfg.titles[g.title]);
    for (const line of ['Top', 'Bottom']) {
      const bar = `Rect${line}.Fill.Color`;
      if (!(`Txt${line}` in g.text) || !has.includes(bar)) continue;
      await this.call({ Function: 'SetColor', Input: input, SelectedName: bar, Value: g.text[`Txt${line}`].trim() ? this.cfg.barColor : HIDDEN });
    }
    // The box for a personal sponsor stays empty: the panel shows none, and one left on by another program would be an empty frame.
    for (const box of ['RectSponsBackgr.Fill.Color', 'RectSponsBorder.Fill.Color']) {
      if (has.includes(box)) await this.call({ Function: 'SetColor', Input: input, SelectedName: box, Value: HIDDEN });
    }
    for (const [field, file] of Object.entries(g.image ?? {})) if (file) await this.call({ Function: 'SetImage', Input: input, SelectedName: `${field}.Source`, Value: file });
    for (const [field, on] of Object.entries(g.visible ?? {})) await this.call({ Function: on ? 'SetImageVisibleOn' : 'SetImageVisibleOff', Input: input, SelectedName: `${field}.Source` });
  }

  /** Fills the title for the request and fades it in; whatever was on the graphics channel before is replaced. */
  async show(req: GfxRequest, score: string, periods: string): Promise<void> {
    const g = this.compose(req, score, periods);
    await this.fill(g);
    await this.call({ Function: `OverlayInput${this.cfg.overlay}In`, Input: this.ref(this.cfg.titles[g.title]) });
    const seconds = this.cfg.autoHideSec[req.kind];
    this.live = { kind: req.kind, team: req.team, summary: g.summary, until: seconds ? Date.now() + seconds * 1000 : null };
    this.six = req.kind === 'startingSix' && req.team ? { team: req.team, shown: 0 } : null;
  }

  /**
   * Starting six: brings on the next player. The title has one animation page per player ("Page1" to "Page6");
   * the first one also takes the team logo away.
   */
  async next(): Promise<void> {
    if (!this.six) throw new PanelError('Starting 6 ist nicht eingeblendet');
    const t = this.team(this.six.team);
    const six = this.startingSix(t);
    if (this.six.shown >= six.length) throw new PanelError('Alle Spielerinnen sind eingeblendet');
    const i = this.six.shown + 1;
    await this.call({ Function: 'TitleBeginAnimation', Input: this.ref(this.cfg.titles.startingSix), Value: `Page${i}` });
    this.six.shown = i;
  }

  async hide(): Promise<void> {
    await this.call({ Function: `OverlayInput${this.cfg.overlay}Out` });
    this.live = null;
    this.six = null;
  }

  /** Called on every poll: short graphics (a goal, a name) go off by themselves after their time. */
  tick(now: number): void {
    if (this.live?.until && now >= this.live.until) this.hide().catch(() => {});
  }

  /** vMix shows something else on the graphics channel (or nothing): what the panel remembered is no longer on. */
  sync(onChannel: string | undefined): void {
    if (this.live && !Object.values(this.cfg.titles).includes(onChannel ?? '')) { this.live = null; this.six = null; }
  }

  // ---------- state for the screens ----------

  view(score: { home: string; away: string } | null, periods: string): GfxState {
    const g = this.game;
    const team = (t: Team): GfxTeam => ({
      long: t.long, short: t.short, coach: t.coach,
      players: Object.entries(t.players).map(([nr, name]) => ({ nr, name, top: name === t.topscorer })).sort((a, b) => Number(a.nr) - Number(b.nr)),
      startingSix: this.startingSix(t).map((nr) => { const p = this.player(t, nr); return { nr: p.nr, name: p.name, top: p.top }; }),
    });
    return {
      game: g ? { title: g.title, date: g.date, time: g.time, location: g.location, referees: g.referees, commentators: g.commentators } : null,
      home: g ? team(g.home) : null,
      away: g ? team(g.away) : null,
      live: this.live ? { ...this.live, six: this.six ? { shown: this.six.shown, total: this.startingSix(this.team(this.six.team)).length } : null } : null,
      score, periods,
      penalties: this.cfg.penalties,
      shortcuts: this.cfg.shortcuts,
      results: Object.entries(this.cfg.labels.result).map(([id, label]) => ({ id, label })),
      overlay: this.cfg.overlay,
    };
  }
}
