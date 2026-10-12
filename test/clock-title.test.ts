import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ClockFace, ClockTitle, clockFields } from '../server/scoreboard';
import type { VmixParams } from '../server/vmix';

const face = (over: Partial<ClockFace> = {}): ClockFace => ({
  seconds: 414, period: '2', score: { home: 18, away: 2 },
  penalties: { home: [94, 0], away: [0, 0] },
  names: { home: 'FBR', away: '' }, logos: { home: 'C:\\logos\\FBR.png', away: '' },
  ...over,
});

test('clock title: one digit per field, score and period', () => {
  const f = clockFields(face(), '#FFF000');
  assert.deepEqual(
    ['M10', 'M01', 'T', 'S10', 'S01'].map((x) => f[`TxtClockTime${x}.Text`]),
    ['0', '6', ':', '5', '4'],
  );
  assert.equal(f['TxtClockPeriod.Text'], '2');
  assert.deepEqual([f['TxtHomeScore.Text'], f['TxtAwayScore.Text']], ['18', '2']);
});

test('clock title: a running penalty has its time and box, a free slot neither', () => {
  const f = clockFields(face(), '#FFF000');
  assert.deepEqual(['M10', 'M01', 'T', 'S10', 'S01'].map((x) => f[`TxtHomePen1${x}.Text`]), ['0', '1', ':', '3', '4']);
  assert.equal(f['RectHomePen1.Fill.Color'], '#FFF000');
  assert.deepEqual(['M10', 'M01', 'T', 'S10', 'S01'].map((x) => f[`TxtHomePen2${x}.Text`]), ['', '', '', '', '']);
  assert.equal(f['RectHomePen2.Fill.Color'], '#00000000');
});

test('clock title: names and logos are only written when known', () => {
  const f = clockFields(face(), '#FFF000');
  assert.equal(f['TxtHomeName.Text'], 'FBR');
  assert.equal(f['ImgHomeTeam.Source'], 'C:\\logos\\FBR.png');
  assert.equal('TxtAwayName.Text' in f, false);
  assert.equal('ImgAwayTeam.Source' in f, false);
});

test('clock title: only changed fields are sent, with the function that fits the field', async () => {
  const calls: VmixParams[] = [];
  const title = new ClockTitle('clock', '#FFF000', async (p) => { calls.push(p); }, (input) => input);
  await title.write(face());
  assert.equal(calls.find((c) => c.SelectedName === 'ImgHomeTeam.Source')?.Function, 'SetImage');
  assert.equal(calls.find((c) => c.SelectedName === 'RectHomePen1.Fill.Color')?.Function, 'SetColor');
  assert.equal(calls.find((c) => c.SelectedName === 'TxtHomeScore.Text')?.Function, 'SetText');

  calls.length = 0;
  await title.write(face({ seconds: 415 }));
  assert.deepEqual(calls.map((c) => [c.SelectedName, c.Value]), [['TxtClockTimeS01.Text', '5']]);
});

test('clock title: after a failed write everything is sent again', async () => {
  let fail = true;
  const calls: VmixParams[] = [];
  const title = new ClockTitle('clock', '#FFF000', async (p) => { if (fail) throw new Error('down'); calls.push(p); }, (input) => input);
  await assert.rejects(title.write(face()));
  fail = false;
  await title.write(face());
  assert.equal(calls.length, Object.keys(clockFields(face(), '#FFF000')).length);
});
