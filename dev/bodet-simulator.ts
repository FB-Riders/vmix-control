// Stand-in for a Scorepad: connects to the panel like the real console does and
// plays a match using the hockey message family (11-16).
//
// In a terminal the match is driven from the keyboard (press ? for the keys). The game
// clock counts up from 00:00 as in floorball (--count-down for 20:00 → 00:00) and runs in
// real time; --speed fast-forwards it without changing how often frames
// are sent. --auto adds random goals and penalties and starts the periods by itself;
// it is the default when there is no keyboard (piped / background runs).
//
//   pnpm bodet [--host 127.0.0.1] [--port 4001] [--speed 1] [--period-minutes 20] [--count-down] [--auto]

import net from 'node:net';
import { parseArgs } from 'node:util';
import { encodeFrame } from '../server/bodet/protocol';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '4001' },
    speed: { type: 'string', default: '1' },
    'period-minutes': { type: 'string', default: '20' },
    auto: { type: 'boolean' },
    'count-down': { type: 'boolean' },
  },
});

const HELP = `
  space  start / stop the clock        n  next period
  h / H  home goal +1 / -1             a / A  away goal +1 / -1
  j / J  home penalty 2' / 5'          k / K  away penalty 2' / 5'
  u      end oldest home penalty       i      end oldest away penalty
  t / T  time-out home / away          + / -  clock +10 s / -10 s
  g      random events on / off        r      reset the match
  ?      this help                     q      quit
`;

const SPORT = '7';
const PERIODS = 3;
const MAX_PENALTIES = 3;
const TIMEOUT_SECONDS = 30;
const HORN_MS = 3000;
const FRAME_INTERVAL_MS = 500;
const TEAMS = ['home', 'away'] as const;

const interactive = process.stdin.isTTY === true;
const periodSeconds = Number(values['period-minutes']) * 60;
const countDown = values['count-down'] === true;
// The clock value at which a period starts and ends.
const periodStart = countDown ? periodSeconds : 0;
const periodEnd = countDown ? 0 : periodSeconds;
const tickMs = 1000 / Number(values.speed);

const pad = (value: number, width: number, fill = ' ') => String(value).padStart(width, fill);
const penaltyTime = (seconds: number) => `${Math.floor(seconds / 60)}${pad(seconds % 60, 2, '0')}`;
const clockTime = (seconds: number) => `${pad(Math.floor(seconds / 60), 2, '0')}:${pad(seconds % 60, 2, '0')}`;

interface Penalty { seconds: number; minutes: 2 | 5; player: number }

function newGame() {
  return {
    clock: periodStart,
    period: 1,
    running: !interactive,
    hornUntil: 0,
    score: [0, 0],
    penalties: [[], []] as [Penalty[], Penalty[]],
    timeouts: [0, 0],
    timeoutSeconds: 0,
    timeoutTeam: 0,
  };
}

let game = newGame();
let auto = values.auto ?? !interactive;
let connected = false;
let blink = false;

// --- output -----------------------------------------------------------------

function status(): string {
  const penalties = TEAMS.map((name, team) => {
    const list = game.penalties[team]!.map((p) => `#${p.player} ${penaltyTime(p.seconds).replace(/^(\d)/, '$1:')}`);
    return list.length ? `${name} ${list.join(', ')}` : '';
  }).filter(Boolean);
  return [
    connected ? '●' : '○ not connected',
    `P${game.period} ${clockTime(game.clock)} ${game.running ? '▶' : '■'}`,
    `${game.score[0]}:${game.score[1]}`,
    ...penalties,
    game.timeoutSeconds > 0 ? `time-out ${TEAMS[game.timeoutTeam]} ${game.timeoutSeconds}s` : '',
    auto ? 'auto' : '',
  ].filter(Boolean).join('  ');
}

function render(): void {
  if (interactive) process.stdout.write(`\r\x1b[K${status()}`);
}

function log(message: string): void {
  process.stdout.write(interactive ? `\r\x1b[K${message}\n` : `${message}\n`);
  render();
}

// --- game actions -----------------------------------------------------------

function goal(team: number, delta: number): void {
  game.score[team] = Math.max(0, game.score[team]! + delta);
  log(`${delta > 0 ? 'goal' : 'goal removed'} ${TEAMS[team]} → ${game.score[0]}:${game.score[1]}`);
}

function penalty(team: number, minutes: 2 | 5): void {
  const list = game.penalties[team]!;
  if (list.length >= MAX_PENALTIES) return log(`${TEAMS[team]} already has ${MAX_PENALTIES} penalties`);
  const player = 1 + Math.floor(Math.random() * 98);
  list.push({ seconds: minutes * 60, minutes, player });
  log(`penalty ${TEAMS[team]} #${player} ${minutes}'`);
}

function endPenalty(team: number): void {
  const ended = game.penalties[team]!.shift();
  if (ended) log(`penalty ${TEAMS[team]} #${ended.player} ended`);
}

function timeout(team: number): void {
  game.running = false;
  game.timeouts[team] = Math.min(9, game.timeouts[team]! + 1);
  game.timeoutTeam = team;
  game.timeoutSeconds = TIMEOUT_SECONDS;
  log(`time-out ${TEAMS[team]}`);
}

function toggleClock(): void {
  if (!game.running && game.clock === periodEnd) return log('period is over: press n for the next period');
  game.running = !game.running;
  log(game.running ? 'clock started' : 'clock stopped');
}

function nextPeriod(): void {
  if (game.period >= PERIODS) return log('already in the last period');
  game.period++;
  game.clock = periodStart;
  game.running = false;
  game.hornUntil = 0;
  log(`period ${game.period}`);
}

/** Corrects the game time. Penalties run with the game time, so they move with it. */
function adjustClock(delta: number): void {
  const before = game.clock;
  game.clock = Math.max(0, Math.min(periodSeconds, game.clock + delta));
  const played = (game.clock - before) * (countDown ? -1 : 1);
  for (const [team, list] of game.penalties.entries()) {
    for (const p of list) p.seconds = Math.min(p.minutes * 60, p.seconds - played);
    for (const p of list.filter((x) => x.seconds <= 0)) {
      list.splice(list.indexOf(p), 1);
      log(`penalty ${TEAMS[team]} #${p.player} ended`);
    }
  }
  render();
}

function quit(): void {
  if (interactive) {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
  }
  process.exit(0);
}

const KEYS: Record<string, () => void> = {
  ' ': toggleClock,
  n: nextPeriod,
  h: () => goal(0, 1),
  H: () => goal(0, -1),
  a: () => goal(1, 1),
  A: () => goal(1, -1),
  j: () => penalty(0, 2),
  J: () => penalty(0, 5),
  k: () => penalty(1, 2),
  K: () => penalty(1, 5),
  u: () => endPenalty(0),
  i: () => endPenalty(1),
  t: () => timeout(0),
  T: () => timeout(1),
  '+': () => adjustClock(10),
  '-': () => adjustClock(-10),
  g: () => {
    auto = !auto;
    log(`random events ${auto ? 'on' : 'off'}`);
  },
  r: () => {
    game = newGame();
    log('match reset');
  },
  '?': () => log(HELP),
  q: quit,
  '\u0003': quit, // Ctrl-C arrives as a key in raw mode
};

// --- clock ------------------------------------------------------------------

function tick(): void {
  if (game.timeoutSeconds > 0) game.timeoutSeconds--;

  if (auto && !game.running && game.clock === periodEnd && game.period < PERIODS && Date.now() > game.hornUntil) {
    nextPeriod();
    game.running = true;
  }

  if (game.running) {
    game.clock += countDown ? -1 : 1;
    for (const [team, list] of game.penalties.entries()) {
      for (const p of list) p.seconds--;
      while (list[0]?.seconds === 0) endPenalty(team);
    }
    if (game.clock === periodEnd) {
      game.running = false;
      game.hornUntil = Date.now() + HORN_MS;
      log(`end of period ${game.period}`);
    }
    if (auto && game.running) {
      if (Math.random() < 1 / 240) goal(Math.random() < 0.5 ? 0 : 1, 1);
      if (Math.random() < 1 / 300) penalty(Math.random() < 0.5 ? 0 : 1, 2);
    }
  }
  render();
}

// --- protocol ---------------------------------------------------------------

function frames(): Buffer {
  blink = !blink;
  // Status word: bit 7 always set, bit 1 = clock stopped, bit 2 = horn.
  const horn = Date.now() < game.hornUntil;
  const status = String.fromCharCode(0x80 | (game.running ? 0 : 0x02) | (horn ? 0x04 : 0));
  const clock = pad(Math.floor(game.clock / 60), 2) + pad(game.clock % 60, 2, '0');

  const slot = (team: number, index: number) => {
    const p = game.penalties[team]![index];
    // Indicator: bit 7 set, bit 0 = 2', bit 6 = 5'; the lit segment blinks while it counts down.
    const lit = p && !(game.running && blink) ? (p.minutes === 2 ? 0x01 : 0x40) : 0;
    return String.fromCharCode(0x80 | lit) + penaltyTime(p?.seconds ?? 0);
  };
  const players = [0, 1]
    .flatMap((team) => [0, 1, 2].map((i) => game.penalties[team]![i]))
    .map((p) => (p ? pad(p.player, 2) : '  '))
    .join('');
  // Time-out indicator: "0" + count, alternating with one less while the time-out runs.
  const timeoutIndicator = (team: number) => {
    const running = game.timeoutSeconds > 0 && game.timeoutTeam === team;
    return String.fromCharCode(0x30 + game.timeouts[team]! - (running && blink ? 1 : 0));
  };

  return Buffer.concat([
    encodeFrame(`11${status}${SPORT}${clock}${pad(game.score[0]!, 3)}${pad(game.score[1]!, 3)}${game.period}`),
    encodeFrame(`12${SPORT}${slot(0, 0)}${slot(0, 1)}`),
    encodeFrame(`13${SPORT}${slot(1, 0)}${slot(1, 1)}`),
    encodeFrame(`14${SPORT}${slot(0, 2)}${slot(1, 2)}`),
    encodeFrame(`15${SPORT}${players}`),
    encodeFrame(`16${SPORT}${timeoutIndicator(0)}${timeoutIndicator(1)}${pad(game.timeoutSeconds, 2, '0')}`),
  ]);
}

function run(): void {
  const socket = net.connect({ host: values.host, port: Number(values.port) });
  let timer: NodeJS.Timeout | undefined;
  let failed = false;
  socket.on('connect', () => {
    connected = true;
    log(`connected to ${values.host}:${values.port}`);
    timer = setInterval(() => socket.write(frames()), FRAME_INTERVAL_MS);
  });
  socket.on('error', (error) => {
    failed = true;
    if (connected || !interactive) log(`connection: ${error.message}`);
  });
  socket.on('close', () => {
    clearInterval(timer);
    if (connected && !failed) log('connection closed');
    connected = false;
    render();
    setTimeout(run, 2000);
  });
}

if (interactive) {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (input: string) => {
    for (const key of input) KEYS[key]?.();
  });
  log(`Scorepad simulator (speed x${values.speed}), clock stopped. Press space to start.\n${HELP}`);
}

setInterval(tick, tickMs);
run();
