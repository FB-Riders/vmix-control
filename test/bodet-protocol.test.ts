import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameDecoder, encodeFrame, lrc } from '../server/bodet/protocol';

const hex = (text: string) => Buffer.from(text.replaceAll(' ', ''), 'hex');

// Captures printed in the Bodet manual (ref. 608264A, basketball chapter).
// The manual's message-50 captures are left out: their checksums are off by 0x03 from
// the algorithm the same manual specifies (and that its message 18 / 36 captures follow).
const MANUAL_FRAMES = [
  '01 7F 02 47 31 38 80 35 20 31 35 36 30 30 20 20 31 20 03 26',
  '01 7F 02 47 33 36 30 30 39 03 25',
  '01 7F 02 47 33 36 33 36 39 03 20',
  '01 7F 02 47 31 38 86 35 30 30 44 30 30 30 20 20 31 20 03 66',
  '01 7F 02 47 31 38 82 35 20 31 33 35 30 30 20 20 31 20 03 21',
].map(hex);

test('lrc matches the frames printed in the Bodet manual', () => {
  for (const frame of MANUAL_FRAMES) {
    assert.equal(lrc(frame.subarray(1, -1)), frame.at(-1));
  }
});

test('encodeFrame reproduces a manual frame byte for byte', () => {
  assert.deepEqual(encodeFrame('3636' + '9'), MANUAL_FRAMES[2]);
});

test('decodes back-to-back frames', () => {
  const decoder = new FrameDecoder();
  const frames = decoder.push(Buffer.concat(MANUAL_FRAMES));
  assert.equal(frames.length, MANUAL_FRAMES.length);
  assert.equal(frames[0]!.address, 0x7f);
  assert.equal(frames[0]!.control, 0x47);
  assert.equal(frames[1]!.payload.toString('latin1'), '36009');
});

test('reassembles frames split across chunks at every position', () => {
  const stream = Buffer.concat(MANUAL_FRAMES);
  for (let split = 1; split < stream.length; split++) {
    const decoder = new FrameDecoder();
    const frames = [...decoder.push(stream.subarray(0, split)), ...decoder.push(stream.subarray(split))];
    assert.equal(frames.length, MANUAL_FRAMES.length, `split at ${split}`);
  }
});

test('drops a corrupted frame and resynchronises on the next one', () => {
  const corrupted = Buffer.from(MANUAL_FRAMES[0]!);
  corrupted[8] = 0x39;
  const decoder = new FrameDecoder();
  const frames = decoder.push(Buffer.concat([hex('ff 00 41'), corrupted, MANUAL_FRAMES[1]!]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.payload.toString('latin1'), '36009');
  assert.equal(decoder.stats.lrcErrors, 1);
  assert.equal(decoder.stats.frames, 1);
});

test('verifyLrc: false accepts frames with a wrong checksum', () => {
  const frame = Buffer.from(MANUAL_FRAMES[1]!);
  frame[frame.length - 1] = 0x7e;
  assert.equal(new FrameDecoder().push(frame).length, 0);
  assert.equal(new FrameDecoder({ verifyLrc: false }).push(frame).length, 1);
});

test('does not buffer endless noise', () => {
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(Buffer.alloc(10_000, 0x41)), []);
  assert.deepEqual(decoder.push(MANUAL_FRAMES[1]!).length, 1);
});
