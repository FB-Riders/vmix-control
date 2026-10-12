import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameDecoder, encodeFrame } from '../server/bodet/protocol';
import { Scoreboard, type ScoreboardState } from '../server/bodet/console';

const RUNNING = '\u0080';
const STOPPED = '\u0082';
const HORN = '\u0086';
const IND = '\u0081'; // penalty indicator, 2' lit

function feed(scoreboard: Scoreboard, ...messages: string[]): ScoreboardState {
  const decoder = new FrameDecoder();
  scoreboard.handleFrames(decoder.push(Buffer.concat(messages.map((m) => encodeFrame(m)))));
  return scoreboard.state;
}

test('message 11: clock, score and period (manual example: 6:54, 18-2, 2nd period)', () => {
  const state = feed(new Scoreboard(), `11${RUNNING}7 654 18  22`);
  assert.deepEqual(state.clock, { minutes: 6, seconds: 54, tenths: null, display: '06:54', running: true, horn: false });
  assert.equal(state.home.score, 18);
  assert.equal(state.away.score, 2);
  assert.deepEqual(state.period, { number: 2, extraTime: false, display: '2' });
  assert.deepEqual(state.sport, { code: '7', name: 'ice-hockey' });
  assert.equal(state.signal, 'live');
});

test('message 11: three-digit scores, stopped clock, horn and extra time', () => {
  const state = feed(new Scoreboard(), `11${HORN}7 000111110E`);
  assert.equal(state.home.score, 111);
  assert.equal(state.away.score, 110);
  assert.equal(state.clock.running, false);
  assert.equal(state.clock.horn, true);
  assert.deepEqual(state.period, { number: null, extraTime: true, display: 'OT' });
});

test('messages 12-15: penalty times and player numbers per team', () => {
  const state = feed(
    new Scoreboard(),
    `127${IND}134${IND}156`,
    `137${IND}037${RUNNING}000`,
    `147${RUNNING}000${IND}108`,
    '157' + ' 3' + '12' + '  ' + '  ' + ' 7' + '  ',
  );
  assert.deepEqual(
    state.home.penalties.map((p) => [p.active, p.seconds, p.display, p.player]),
    [[true, 94, '1:34', 3], [true, 116, '1:56', 12], [false, 0, '0:00', null]],
  );
  assert.deepEqual(
    state.away.penalties.map((p) => [p.active, p.seconds, p.display, p.player]),
    [[true, 37, '0:37', null], [false, 0, '0:00', 7], [true, 68, '1:08', null]],
  );
});

test('message 16: blinking time-out indicator still yields a stable count', () => {
  const scoreboard = new Scoreboard();
  feed(scoreboard, '1671028');
  assert.equal(feed(scoreboard, '1670027').home.timeouts, 1);
  const state = feed(scoreboard, '1671026');
  assert.equal(state.home.timeouts, 1);
  assert.equal(state.away.timeouts, 0);
  assert.deepEqual(state.timeout, { running: true, seconds: 26, team: 'home' });
  assert.deepEqual(feed(scoreboard, '1671000').timeout, { running: false, seconds: 0, team: null });
});

test('handball family: messages 01, 02 and 03', () => {
  const state = feed(
    new Scoreboard(),
    `01${STOPPED}41654132`,
    '024 23 19',
    '034050145154138144000',
  );
  assert.equal(state.clock.display, '16:54');
  assert.equal(state.clock.running, false);
  assert.equal(state.period.number, 2);
  assert.deepEqual([state.home.timeouts, state.away.timeouts], [1, 3]);
  assert.deepEqual([state.home.score, state.away.score], [23, 19]);
  assert.deepEqual(state.home.penalties.map((p) => p.display), ['0:50', '1:45', '1:54']);
  assert.deepEqual(state.away.penalties.map((p) => p.display), ['1:38', '1:44', '0:00']);
});

test('basketball family: tenths of a second in the last minute', () => {
  const scoreboard = new Scoreboard();
  assert.equal(feed(scoreboard, `18${RUNNING}535D900  1 `).clock.display, '35.9');
  const state = feed(scoreboard, '36358', '305 5  78 ');
  assert.deepEqual([state.clock.seconds, state.clock.tenths], [35, 8]);
  assert.deepEqual([state.home.score, state.away.score], [5, 78]);
});

test('emits change only when the state really changes', () => {
  const scoreboard = new Scoreboard();
  let changes = 0;
  scoreboard.on('change', () => changes++);
  feed(scoreboard, `11${RUNNING}7 654  1  02`);
  feed(scoreboard, `11${RUNNING}7 654  1  02`);
  assert.equal(changes, 1);
  feed(scoreboard, `11${RUNNING}7 653  1  02`);
  assert.equal(changes, 2);
});

test('published snapshots are not mutated by later frames', () => {
  const scoreboard = new Scoreboard();
  const before = feed(scoreboard, `11${RUNNING}7 654  1  02`);
  feed(scoreboard, `11${RUNNING}7 653  2  02`);
  assert.equal(before.home.score, 1);
  assert.equal(scoreboard.state.home.score, 2);
});

test('unknown and truncated messages are counted, not applied', () => {
  const scoreboard = new Scoreboard();
  const state = feed(scoreboard, '99HOME', '117');
  assert.equal(state.home.score, 0);
  assert.equal(scoreboard.stats.unknown['99'], Buffer.from('99HOME').toString('hex'));
  assert.equal(scoreboard.stats.malformed, 1);
});

test('signal goes stale after silence and on disconnect', () => {
  const scoreboard = new Scoreboard({ staleAfterMs: 5000 });
  const frames = new FrameDecoder().push(encodeFrame(`11${RUNNING}7 654  1  02`));
  scoreboard.setConnected(true, 0);
  scoreboard.handleFrames(frames, 1000);
  scoreboard.checkStale(5000);
  assert.equal(scoreboard.state.signal, 'live');
  scoreboard.checkStale(6001);
  assert.equal(scoreboard.state.signal, 'stale');
  scoreboard.handleFrames(frames, 7000);
  assert.equal(scoreboard.state.signal, 'live');
  scoreboard.setConnected(false, 8000);
  assert.deepEqual([scoreboard.state.connected, scoreboard.state.signal], [false, 'stale']);
});
