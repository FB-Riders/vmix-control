import type { GfxSide } from '../../shared/actions';
import type { BodetState } from '../../shared/state';
import type { ClockFace } from '../scoreboard';
import { Scoreboard, type ScoreboardState } from './console';
import { FrameDecoder } from './protocol';
import { createSource } from './source';

export interface BodetConfig {
  mode: 'listen' | 'connect'; // listen: the Scorepad connects to this computer; connect: the panel dials the RJ45/RS232 interface
  host: string;
  port: number;
  staleMs: number; // no data for this long: the link counts as lost
  overtime: string; // what the period field shows during extra time
}

const SLOTS = 2; // penalty slots per team in the title

/**
 * The link to the hall's Bodet Scorepad: receives its protocol output over the network and keeps the game state
 * (clock, period, score, penalties, time-outs) as the console shows it. The panel writes that into the clock title
 * while the match clock is set to follow the scoreboard.
 */
export class BodetLink {
  private readonly console: Scoreboard;
  private readonly decoder = new FrameDecoder();
  private peer = '';
  private error = '';

  constructor(private readonly cfg: BodetConfig, log: (message: string) => void, changed: () => void) {
    this.console = new Scoreboard({ staleAfterMs: cfg.staleMs });
    this.console.on('change', changed);
    createSource({
      mode: cfg.mode, host: cfg.host, port: cfg.port, log,
      onData: (chunk) => this.console.handleFrames(this.decoder.push(chunk)),
      onConnection: (connected, peer) => {
        log(`Scorepad ${connected ? 'verbunden' : 'getrennt'} (${peer})`);
        this.peer = connected ? peer : '';
        if (!connected) this.decoder.reset();
        this.console.setConnected(connected);
      },
      onError: (message) => { this.error = message; changed(); },
    });
    setInterval(() => this.console.checkStale(), 1000);
  }

  private get s(): ScoreboardState { return this.console.state; }

  /** The Scorepad has delivered data at some point; what it last said is what the title shows. */
  get hasData(): boolean { return this.s.signal !== 'none'; }
  get live(): boolean { return this.s.signal === 'live'; }

  get period(): string {
    const { period } = this.s;
    return period.extraTime ? this.cfg.overtime : period.number === null ? '' : String(period.number);
  }

  get score(): Record<GfxSide, number> { return { home: this.s.home.score, away: this.s.away.score }; }

  /** Game time in seconds. */
  get seconds(): number { return this.s.clock.minutes * 60 + this.s.clock.seconds; }

  /** Seconds left of the running penalties, first to last, as many as the title has slots. */
  penalties(side: GfxSide): number[] {
    const running = this.s[side].penalties.filter((p) => p.active).map((p) => p.seconds);
    return Array.from({ length: SLOTS }, (_, i) => running[i] ?? 0);
  }

  /** The team whose time-out is running, if the console tells. */
  get timeout(): GfxSide | null { return this.s.timeout.running ? this.s.timeout.team : null; }

  /** Time, period and penalties are the console's; the score is counted in the panel, where the goal graphics are. */
  face(score: Record<GfxSide, number>, names: Record<GfxSide, string>, logos: Record<GfxSide, string>): ClockFace {
    return { seconds: this.seconds, period: this.period, score, penalties: { home: this.penalties('home'), away: this.penalties('away') }, names, logos };
  }

  view(): BodetState {
    const s = this.s;
    return {
      connected: s.connected, signal: s.signal, peer: this.peer, port: this.cfg.port, error: this.error,
      running: s.clock.running, seconds: this.seconds, period: this.period, score: this.score,
      penalties: { home: this.penalties('home'), away: this.penalties('away') },
      timeout: this.timeout,
    };
  }
}
