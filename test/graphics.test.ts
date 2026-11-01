import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Graphics } from '../server/graphics';
import type { VmixParams } from '../server/vmix';

const config = (home: string) => `[Home]\nTeamLong=Heim\nTeamShort=HEI\n${home}\n[Away]\nTeamLong=Gast\nTeamShort=GAS\n7=Gast Spielerin\n`;

function graphics(home: string) {
  const calls: VmixParams[] = [];
  const cfg = { overlay: 2, titles: { playerName: 'name' }, labels: { bestPlayer: 'Best Player', result: {} }, autoHideSec: {}, penalties: [], shortcuts: [] };
  const g = new Graphics(cfg as never, async (p) => { calls.push(p); }, (input) => input, () => []);
  g.load(config(home));
  return { g, calls };
}

test('a top scorer filed only under 00 can be picked, with that number', () => {
  const { g } = graphics('14=Livia Simon\n00=Finja Helbling\n17=Giulia Gattiker');
  assert.deepEqual(g.view(null, '').home?.players, [
    { nr: '00', name: 'Finja Helbling', top: true },
    { nr: '14', name: 'Livia Simon', top: false },
    { nr: '17', name: 'Giulia Gattiker', top: false },
  ]);
});

test('a top scorer who also has a shirt number is listed once, under it', () => {
  const { g } = graphics('70=Simon Suter\n00=Simon Suter');
  assert.deepEqual(g.view(null, '').home?.players, [{ nr: '70', name: 'Simon Suter', top: true }]);
});

test('the picked top scorer goes on air with the icon and no number', async () => {
  const { g, calls } = graphics('00=Finja Helbling');
  await g.show({ kind: 'name', team: 'home', player: '00' }, '', '');
  const value = (field: string) => calls.find((c) => c.SelectedName === field)?.Value;
  assert.equal(value('TxtName.Text'), 'FINJA HELBLING');
  assert.equal(value('TxtNumber.Text'), '');
  assert.ok(calls.some((c) => c.Function === 'SetImageVisibleOn' && c.SelectedName === 'ImgTopscorer.Source'));
});
