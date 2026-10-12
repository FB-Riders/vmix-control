// Message layer: turns Bodet Scorepad messages into one consolidated scoreboard state.
// (Taken over from the club's live-scoreboard bridge.)
//
// The Scorepad emits a different message family per sport. All byte offsets below are
// 0-based into the frame payload (the Bodet manual counts from 1):
//
//   Hockey family    11 clock/score/period   12-14 penalty times   15 penalty players   16 time-outs
//   Handball family  01 clock/period         02 score              03 penalty times     04 time-outs
//   Basketball       18 clock/period         30 score              36 tenths of a second
//
// The message number decides how a frame is read; the sport code is only reported.

import { EventEmitter } from 'node:events';
import type { Frame } from './protocol';

export type TeamKey = 'home' | 'away';

export interface Penalty {
  slot: number;
  active: boolean;
  /** Remaining penalty time in seconds. */
  seconds: number;
  display: string;
  /** Jersey number, when the operator entered one (hockey family only). */
  player: number | null;
}

export interface TeamState {
  score: number;
  timeouts: number;
  penalties: Penalty[];
}

export interface ScoreboardState {
  /** A Scorepad (or its RS232 interface) is connected. */
  connected: boolean;
  /** `live`: frames are arriving. `stale`: connected or not, the data is old. `none`: nothing received yet. */
  signal: 'none' | 'live' | 'stale';
  sport: { code: string; name: string } | null;
  clock: {
    minutes: number;
    seconds: number;
    /** Only set while the console transmits tenths (last minute, basketball family). */
    tenths: number | null;
    display: string;
    running: boolean;
    horn: boolean;
  };
  period: { number: number | null; extraTime: boolean; display: string };
  home: TeamState;
  away: TeamState;
  /** `team` is who called the running time-out, when the console tells (blinking indicator). */
  timeout: { running: boolean; seconds: number; team: TeamKey | null };
  updatedAt: string | null;
}

const SPORTS: Record<string, string> = {
  '3': 'badminton',
  '4': 'handball',
  '5': 'basketball',
  '7': 'ice-hockey',
};

const PENALTY_SLOTS = 3;
const BLANK = 0x20;

const pad = (value: number) => String(value).padStart(2, '0');
const formatPenalty = (seconds: number) => `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;

function digit(byte: number | undefined): number | null {
  return byte !== undefined && byte >= 0x30 && byte <= 0x39 ? byte - 0x30 : null;
}

/** Reads a blank-padded decimal field. Returns null when it holds anything but digits and blanks. */
function readNumber(payload: Buffer, at: number, length: number): number | null {
  let value = 0;
  for (let i = at; i < at + length; i++) {
    if (payload[i] === BLANK) continue;
    const d = digit(payload[i]);
    if (d === null) return null;
    value = value * 10 + d;
  }
  return value;
}

/** Four bytes: `MMSS`, or `SSDt` (seconds, literal "D", tenths) during the last minute. */
function readClock(payload: Buffer, at: number) {
  if (payload[at + 2] === 0x44) {
    const seconds = readNumber(payload, at, 2);
    const tenths = digit(payload[at + 3]);
    return seconds === null || tenths === null ? null : { minutes: 0, seconds, tenths };
  }
  const minutes = readNumber(payload, at, 2);
  const seconds = readNumber(payload, at + 2, 2);
  return minutes === null || seconds === null ? null : { minutes, seconds, tenths: null };
}

/** Three bytes `MSS`. A single minute digit cannot hold 10+, so ":".."?" are read as 10..15. */
function readPenaltySeconds(payload: Buffer, at: number): number | null {
  const first = payload[at];
  if (first === undefined) return null;
  const minutes = first === BLANK ? 0 : first >= 0x30 && first <= 0x3f ? first - 0x30 : null;
  const seconds = readNumber(payload, at + 1, 2);
  return minutes === null || seconds === null ? null : minutes * 60 + seconds;
}

function emptyTeam(): TeamState {
  return {
    score: 0,
    timeouts: 0,
    penalties: Array.from({ length: PENALTY_SLOTS }, (_, i) => ({
      slot: i + 1,
      active: false,
      seconds: 0,
      display: '0:00',
      player: null,
    })),
  };
}

function initialState(): ScoreboardState {
  return {
    connected: false,
    signal: 'none',
    sport: null,
    clock: { minutes: 0, seconds: 0, tenths: null, display: '00:00', running: false, horn: false },
    period: { number: null, extraTime: false, display: '' },
    home: emptyTeam(),
    away: emptyTeam(),
    timeout: { running: false, seconds: 0, team: null },
    updatedAt: null,
  };
}

export interface ScoreboardStats {
  /** Frames seen per message number, including ones this server does not interpret. */
  messages: Record<string, number>;
  malformed: number;
  /** Most recent frame (hex) of each message number that is not interpreted. */
  unknown: Record<string, string>;
  lastFrameAt: string | null;
}

/**
 * Holds the current scoreboard state and emits `change` (with the new state) whenever
 * a frame, a connection change or a stale signal actually alters it.
 */
export class Scoreboard extends EventEmitter<{ change: [ScoreboardState] }> {
  readonly stats: ScoreboardStats = { messages: {}, malformed: 0, unknown: {}, lastFrameAt: null };
  readonly #staleAfterMs: number;
  // Working copy, mutated by the message handlers; consumers only ever see #snapshot.
  #state = initialState();
  #snapshot: ScoreboardState = initialState();
  #published = '';
  #lastFrameAt = 0;
  // The time-out indicator blinks between n-1 and n while a time-out runs, so the count
  // is the larger of the last two values seen.
  #timeoutIndicators: Record<TeamKey, [number, number]> = { home: [0, 0], away: [0, 0] };

  constructor(options: { staleAfterMs?: number } = {}) {
    super();
    this.#staleAfterMs = options.staleAfterMs ?? 5000;
  }

  get state(): ScoreboardState {
    return this.#snapshot;
  }

  handleFrames(frames: Frame[], now = Date.now()): void {
    if (frames.length === 0) return;
    for (const frame of frames) this.#apply(frame.payload);
    this.#lastFrameAt = now;
    this.stats.lastFrameAt = new Date(now).toISOString();
    this.#state.signal = 'live';
    this.#publish(now);
  }

  setConnected(connected: boolean, now = Date.now()): void {
    this.#state.connected = connected;
    if (!connected && this.#state.signal === 'live') this.#state.signal = 'stale';
    this.#publish(now);
  }

  /** Call periodically: flags the data as stale when the console went quiet. */
  checkStale(now = Date.now()): void {
    if (this.#state.signal === 'live' && now - this.#lastFrameAt > this.#staleAfterMs) {
      this.#state.signal = 'stale';
      this.#publish(now);
    }
  }

  #publish(now: number): void {
    const { updatedAt: _ignored, ...comparable } = this.#state;
    const serialized = JSON.stringify(comparable);
    if (serialized === this.#published) return;
    this.#published = serialized;
    this.#state.updatedAt = new Date(now).toISOString();
    this.#snapshot = structuredClone(this.#state);
    this.emit('change', this.#snapshot);
  }

  #apply(payload: Buffer): void {
    const id = payload.toString('latin1', 0, 2);
    this.stats.messages[id] = (this.stats.messages[id] ?? 0) + 1;

    const handler = this.#handlers[id];
    if (!handler) {
      this.stats.unknown[id] = payload.toString('hex');
      return;
    }
    if (payload.length < handler.length) {
      this.stats.malformed++;
      return;
    }
    handler.apply(payload);
  }

  // `length` is the minimum payload length each message needs to be read safely.
  readonly #handlers: Record<string, { length: number; apply: (payload: Buffer) => void }> = {
    '11': {
      length: 15,
      apply: (p) => {
        this.#setStatus(p[2]!);
        this.#setSport(p[3]!);
        this.#setClock(readClock(p, 4));
        this.#setScore('home', readNumber(p, 8, 3));
        this.#setScore('away', readNumber(p, 11, 3));
        this.#setPeriod(p[14]!);
      },
    },
    '12': {
      length: 11,
      apply: (p) => {
        this.#setSport(p[2]!);
        this.#setPenalty('home', 0, readPenaltySeconds(p, 4));
        this.#setPenalty('home', 1, readPenaltySeconds(p, 8));
      },
    },
    '13': {
      length: 11,
      apply: (p) => {
        this.#setSport(p[2]!);
        this.#setPenalty('away', 0, readPenaltySeconds(p, 4));
        this.#setPenalty('away', 1, readPenaltySeconds(p, 8));
      },
    },
    '14': {
      length: 11,
      apply: (p) => {
        this.#setSport(p[2]!);
        this.#setPenalty('home', 2, readPenaltySeconds(p, 4));
        this.#setPenalty('away', 2, readPenaltySeconds(p, 8));
      },
    },
    '15': {
      length: 15,
      apply: (p) => {
        this.#setSport(p[2]!);
        (['home', 'away'] as const).forEach((team, t) => {
          for (let slot = 0; slot < PENALTY_SLOTS; slot++) {
            const at = 3 + (t * PENALTY_SLOTS + slot) * 2;
            const blank = p[at] === BLANK && p[at + 1] === BLANK;
            this.#state[team].penalties[slot]!.player = blank ? null : readNumber(p, at, 2);
          }
        });
      },
    },
    '16': { length: 7, apply: (p) => this.#setTimeout(p) },

    '01': {
      length: 11,
      apply: (p) => {
        this.#setStatus(p[2]!);
        this.#setSport(p[3]!);
        this.#setClock(readClock(p, 4));
        this.#setTimeoutCount('home', digit(p[8]));
        this.#setTimeoutCount('away', digit(p[9]));
        this.#setPeriod(p[10]!);
      },
    },
    '02': {
      length: 9,
      apply: (p) => {
        this.#setSport(p[2]!);
        this.#setScore('home', readNumber(p, 3, 3));
        this.#setScore('away', readNumber(p, 6, 3));
      },
    },
    '03': {
      length: 21,
      apply: (p) => {
        this.#setSport(p[2]!);
        (['home', 'away'] as const).forEach((team, t) => {
          for (let slot = 0; slot < PENALTY_SLOTS; slot++) {
            this.#setPenalty(team, slot, readPenaltySeconds(p, 3 + (t * PENALTY_SLOTS + slot) * 3));
          }
        });
      },
    },
    '04': { length: 7, apply: (p) => this.#setTimeout(p) },

    '18': {
      length: 13,
      apply: (p) => {
        this.#setStatus(p[2]!);
        this.#setSport(p[3]!);
        this.#setClock(readClock(p, 4));
        this.#setTimeoutCount('home', digit(p[8]));
        this.#setTimeoutCount('away', digit(p[9]));
        this.#setPeriod(p[12]!);
      },
    },
    '30': {
      length: 9,
      apply: (p) => {
        this.#setSport(p[2]!);
        this.#setScore('home', readNumber(p, 3, 3));
        this.#setScore('away', readNumber(p, 6, 3));
      },
    },
    '36': {
      length: 5,
      apply: (p) => {
        const seconds = readNumber(p, 2, 2);
        const tenths = digit(p[4]);
        if (seconds !== null && tenths !== null) this.#setClock({ minutes: 0, seconds, tenths });
      },
    },
  };

  /** Status word: bit 1 set = clock stopped, bit 2 set = horn sounding. */
  #setStatus(status: number): void {
    this.#state.clock.running = (status & 0x02) === 0;
    this.#state.clock.horn = (status & 0x04) !== 0;
  }

  #setSport(byte: number): void {
    const code = String.fromCharCode(byte);
    if (this.#state.sport?.code !== code) {
      this.#state.sport = { code, name: SPORTS[code] ?? 'unknown' };
    }
  }

  #setClock(clock: { minutes: number; seconds: number; tenths: number | null } | null): void {
    if (!clock) return;
    const display =
      clock.tenths === null
        ? `${pad(clock.minutes)}:${pad(clock.seconds)}`
        : `${clock.seconds}.${clock.tenths}`;
    Object.assign(this.#state.clock, clock, { display });
  }

  #setScore(team: TeamKey, score: number | null): void {
    if (score !== null) this.#state[team].score = score;
  }

  #setPeriod(byte: number): void {
    const number = digit(byte);
    const extraTime = byte === 0x45; // "E"
    this.#state.period = { number, extraTime, display: extraTime ? 'OT' : number === null ? '' : String(number) };
  }

  #setPenalty(team: TeamKey, slot: number, seconds: number | null): void {
    if (seconds === null) return;
    Object.assign(this.#state[team].penalties[slot]!, {
      seconds,
      active: seconds > 0,
      display: formatPenalty(seconds),
    });
  }

  #setTimeoutCount(team: TeamKey, count: number | null): void {
    if (count !== null) this.#state[team].timeouts = count;
  }

  /** Messages 04 / 16: home indicator, guest indicator, two-digit countdown in seconds. */
  #setTimeout(p: Buffer): void {
    this.#setSport(p[2]!);
    let blinking: TeamKey | null = null;
    (['home', 'away'] as const).forEach((team, i) => {
      const byte = p[3 + i]!;
      const value = byte === BLANK ? 0 : Math.max(0, Math.min(9, byte - 0x30));
      const history = this.#timeoutIndicators[team];
      history[0] = history[1];
      history[1] = value;
      this.#state[team].timeouts = Math.max(history[0], history[1]);
      if (history[0] !== history[1]) blinking ??= team;
    });
    const seconds = readNumber(p, 5, 2);
    if (seconds !== null) {
      const running = seconds > 0;
      this.#state.timeout = { running, seconds, team: running ? blinking ?? this.#state.timeout.team : null };
    }
  }
}
