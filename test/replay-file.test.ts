import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type FileEvent, parseReplayFile } from '../server/replay-file';
import { ReplayBook } from '../server/replays';

const event = (id: number, inSec: number, seconds: number, cams: number[], text: string) => `
      <event>
        <inPoint>${inSec * 10_000_000}</inPoint>
        <outPoint>${(inSec + seconds) * 10_000_000}</outPoint>
        <selectedAngle>0</selectedAngle>
        <description>${text}</description>
        <description>-</description>
        ${[1, 2, 3, 4].map((n) => `<selectedAngles>${cams.includes(n) ? 'True' : 'False'}</selectedAngles>`).join('')}
        <id>${id}</id>
        <speed>-1</speed>
      </event>`;

// Lists as vMix writes them: twenty, empty ones self-closed. Highlights in 10, periods in 11 to 13.
const file = (lists: Record<number, string>) => `<replay>
  <idDigits>4</idDigits>
  <events>${Array.from({ length: 20 }, (_, i) => (lists[i + 1] ? `<list name="">${lists[i + 1]}</list>` : '<list name="" />')).join('\n')}
  </events>
  <stream>
    <cameraName>Cam 1</cameraName>
    <segment><timestamp>2026-10-09T19:31:49.0009737+02:00</timestamp><videoStartTime>200000</videoStartTime><filename>a.avi</filename></segment>
    <segment><timestamp>2026-10-09T19:51:49.0004284+02:00</timestamp><videoStartTime>12000400000</videoStartTime><filename>b.avi</filename></segment>
  </stream>
</replay>`;

const sample = file({
  10: event(4, 1924.6, 4, [1, 2], 'Tor') + event(8, 2500, 4, [1], 'Chance') + event(30, 3000, 4, [1], 'Tor'),
  11: event(2, 1914.4, 4, [1, 2], 'Szene') + event(3, 1913.1, 5.5, [1, 2], 'Tor') + event(7, 2500, 4, [1], 'Chance'),
  12: event(10, 3917, 9.5, [1, 3], 'Strafe'),
});

test('replay file: lists by number, events in order with length, cameras and text', () => {
  const lists = parseReplayFile(sample);
  assert.deepEqual(Object.keys(lists), ['10', '11', '12']);
  assert.deepEqual(lists[11].map((e) => [e.id, e.start, e.seconds, e.cameras, e.text]), [
    [2, 1914.4, 4, [1, 2], 'Szene'], [3, 1913.1, 5.5, [1, 2], 'Tor'], [7, 2500, 4, [1], 'Chance'],
  ]);
});

test('replay file: the in point gets the time of day from the recording segments', () => {
  const [first] = parseReplayFile(sample)[12];
  // 3917 s into the recording lies in the second segment, which started at 19:51:49 with the recording at 1200.04 s.
  assert.equal(new Date(first.at ?? 0).toISOString(), '2026-10-09T18:37:05.960Z');
});

test('replay file: anything else is refused', () => {
  assert.throws(() => parseReplayFile('<vmix><inputs /></vmix>'));
});

const read = (e: FileEvent) => ({ time: '', cams: e.cameras.map(String), type: e.text });

test('adopting: one scene per period event, highlights found by the number after the original or the same start', () => {
  const calls: string[] = [];
  const book = new ReplayBook(async (p) => { calls.push(`${p.Function}${p.Value ?? ''}`); }, [11, 12, 13], 10, 4);
  const result = book.adopt(parseReplayFile(sample), read, (type) => type === 'Tor');
  assert.deepEqual(result, { scenes: 4, highlights: 2, unknown: 1 });

  const scenes = book.all().reverse();
  assert.deepEqual(scenes.map((s) => [s.period, s.type, s.seconds, s.fav, book.isHighlight(s.id)]), [
    [0, 'Szene', 4, false, false],
    [0, 'Tor', 5.5, false, true], // its copy is event 4; a goal is a highlight without a star
    [0, 'Chance', 4, true, true], // its copy is event 8, not the next number, but it starts at the same moment
    [1, 'Strafe', 9.5, false, false],
  ]);
});

test('adopting: a highlight without a scene keeps its place, so the others are still counted back to correctly', async () => {
  const calls: string[] = [];
  const book = new ReplayBook(async (p) => { calls.push(`${p.Function}${p.Value ?? ''}`); }, [11, 12, 13], 10, 4);
  book.adopt(parseReplayFile(sample), read, (type) => type === 'Tor');
  const goal = book.all().find((s) => s.type === 'Tor');
  assert.ok(goal);
  // The goal's copy is the first of three events in the highlight tab: two steps back from the last one.
  await book.setType(goal, 'Tor');
  const inHighlights = calls.slice(calls.indexOf('ReplaySelectEvents10'));
  assert.deepEqual(inHighlights, ['ReplaySelectEvents10', 'ReplaySelectLastEvent', 'ReplaySelectPreviousEvent', 'ReplaySelectPreviousEvent', 'ReplaySetSelectedEventTextTor']);
});
