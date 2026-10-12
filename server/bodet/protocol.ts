// Bodet Scorepad framing layer (Bodet ref. 608264, "Network output and protocols").
//
//   SOH address STX CTRL message... ETX LRC
//
// LRC = XOR of every byte after SOH up to and including ETX, masked with 0x7F,
// and bumped by 0x20 when the result is below 0x20 (so it is never a control byte).

export const SOH = 0x01;
export const STX = 0x02;
export const ETX = 0x03;

const DEFAULT_ADDRESS = 0x7f;
const DEFAULT_CONTROL = 0x47;
// Longest documented frame is ~40 bytes; anything far beyond that is line noise.
const MAX_FRAME_LENGTH = 256;

export interface Frame {
  address: number;
  control: number;
  /** Message bytes between CTRL and ETX. The first two are the ASCII message number. */
  payload: Buffer;
}

export interface DecoderStats {
  frames: number;
  lrcErrors: number;
  framingErrors: number;
  discardedBytes: number;
}

/** `bytes` must be the frame content after SOH, up to and including ETX. */
export function lrc(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value ^= byte;
  value &= 0x7f;
  return value < 0x20 ? value + 0x20 : value;
}

export function encodeFrame(
  payload: Uint8Array | string,
  address = DEFAULT_ADDRESS,
  control = DEFAULT_CONTROL,
): Buffer {
  const message = typeof payload === 'string' ? Buffer.from(payload, 'latin1') : payload;
  const body = Buffer.concat([Buffer.from([address, STX, control]), message, Buffer.from([ETX])]);
  return Buffer.concat([Buffer.from([SOH]), body, Buffer.from([lrc(body)])]);
}

/** Incremental decoder: feed it arbitrary TCP/serial chunks, get back complete, checksum-valid frames. */
export class FrameDecoder {
  readonly stats: DecoderStats = { frames: 0, lrcErrors: 0, framingErrors: 0, discardedBytes: 0 };
  readonly #verifyLrc: boolean;
  #buffer: Buffer = Buffer.alloc(0);

  /** `verifyLrc: false` is a commissioning escape hatch; leave it on in production. */
  constructor(options: { verifyLrc?: boolean } = {}) {
    this.#verifyLrc = options.verifyLrc ?? true;
  }

  push(chunk: Uint8Array): Frame[] {
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, chunk]) : Buffer.from(chunk);
    const frames: Frame[] = [];

    for (;;) {
      const start = this.#buffer.indexOf(SOH);
      if (start === -1) {
        this.#discard(this.#buffer.length);
        break;
      }
      if (start > 0) this.#discard(start);
      if (this.#buffer.length < 4) break;

      if (this.#buffer[2] !== STX) {
        this.stats.framingErrors++;
        this.#discard(1);
        continue;
      }

      const end = this.#buffer.indexOf(ETX, 4);
      if (end === -1 || end + 1 >= this.#buffer.length) {
        if (this.#buffer.length <= MAX_FRAME_LENGTH) break; // wait for the rest
        this.stats.framingErrors++;
        this.#discard(1);
        continue;
      }

      if (this.#verifyLrc && lrc(this.#buffer.subarray(1, end + 1)) !== this.#buffer[end + 1]) {
        // Resynchronise on the next SOH instead of trusting this frame's length.
        this.stats.lrcErrors++;
        this.#discard(1);
        continue;
      }

      frames.push({
        address: this.#buffer[1]!,
        control: this.#buffer[3]!,
        payload: Buffer.from(this.#buffer.subarray(4, end)),
      });
      this.stats.frames++;
      this.#buffer = this.#buffer.subarray(end + 2);
    }

    return frames;
  }

  reset(): void {
    this.#buffer = Buffer.alloc(0);
  }

  #discard(count: number): void {
    this.stats.discardedBytes += count;
    this.#buffer = this.#buffer.subarray(count);
  }
}
