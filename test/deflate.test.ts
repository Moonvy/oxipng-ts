import { describe, expect, it } from 'vitest';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { deflate, deflateRaw, inflate } from '../src/index.js';

const enc = (s: string) => new TextEncoder().encode(s);

function lcg(n: number): Uint8Array {
  const b = new Uint8Array(n);
  let s = 123456789;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    b[i] = s & 0xff;
  }
  return b;
}

const PATTERNS: Record<string, Uint8Array> = {
  empty: new Uint8Array(0),
  oneByte: enc('a'),
  tiny: new Uint8Array([0, 1, 2, 255]),
  text: enc('hello hello hello world world world '.repeat(40)),
  zeros: new Uint8Array(200000),
  alternating: (() => {
    const b = new Uint8Array(100000);
    for (let i = 0; i < b.length; i++) b[i] = i % 2 ? 0xaa : 0x55;
    return b;
  })(),
  runs: (() => {
    const b = new Uint8Array(120000);
    for (let i = 0; i < b.length; i++) b[i] = (i >> 8) & 0xff;
    return b;
  })(),
  random: lcg(150000),
};

const LEVELS = [0, 1, 2, 3, 6, 9, 12];

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe('deflate/inflate round-trips', () => {
  for (const [name, data] of Object.entries(PATTERNS)) {
    for (const level of LEVELS) {
      it(`${name} (level ${level})`, () => {
        const z = deflate(data, level);

        // Our own decoder.
        expect(sameBytes(inflate(z, data.length), data)).toBe(true);

        // Independent oracle: Node's zlib must accept our stream and reproduce the input.
        const viaNode = new Uint8Array(inflateSync(Buffer.from(z)));
        expect(sameBytes(viaNode, data)).toBe(true);
      });
    }
  }
});

describe('raw deflate', () => {
  for (const [name, data] of Object.entries(PATTERNS)) {
    it(`${name} (raw, level 9)`, () => {
      const raw = deflateRaw(data, 9);
      const viaNode = new Uint8Array(inflateRawSync(Buffer.from(raw)));
      expect(sameBytes(viaNode, data)).toBe(true);
    });
  }
});

describe('zlib wrapper', () => {
  it('writes a valid zlib header', () => {
    const z = deflate(enc('hello'), 6);
    expect(z[0]).toBe(0x78);
    expect(((z[0] << 8) | z[1]) % 31).toBe(0);
  });

  it('rejects a bad header', () => {
    expect(() => inflate(new Uint8Array([0x00, 0x00, 0x00, 0x00]), 10)).toThrow();
  });

  it('bounds the output size', () => {
    const z = deflate(enc('x'.repeat(1000)), 6);
    expect(() => inflate(z, 10)).toThrow();
  });
});

describe('size limits and reusable match state', () => {
  for (const level of [0, 6, 12]) {
    it(`accepts the exact limit and exposes the public error (level ${level})`, () => {
      const data = enc('size limit '.repeat(8000));
      for (const compress of [deflate, deflateRaw]) {
        const output = compress(data, level);
        expect(compress(data, level, output.length)).toEqual(output);
        for (const limit of [0, 1, output.length - 1]) {
          expect(() => compress(data, level, limit)).toThrow(expect.objectContaining({
            kind: 'DeflatedDataTooLong', size: limit,
          }));
        }
        // Aborted compression must not contaminate the next hash generation.
        expect(compress(data, level)).toEqual(output);
      }
    });
  }

  it('round-trips offset views across windows and blocks after repeated aborts', () => {
    const backing = new Uint8Array(600013);
    let state = 12345;
    for (let i = 0; i < backing.length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      backing[i] = state >>> 24;
    }
    backing.copyWithin(340000, 123, 90123);
    const data = backing.subarray(7, backing.length - 6);
    for (let i = 0; i < 3; i++) {
      expect(() => deflate(data, 9, 32)).toThrow(expect.objectContaining({ kind: 'DeflatedDataTooLong' }));
      const z = deflate(data, 9);
      expect(sameBytes(new Uint8Array(inflateSync(z)), data)).toBe(true);
    }
  });
});

describe('match-chain window boundaries', () => {
  // Recorded from the pre-ring encoder. Besides independent decompression,
  // preserve the exact match choices on either side of the 32 KiB limit.
  const cases = [
    [32767, '3f87d72bd4bbbe0a3ca29bc68ba857e93ae04572f316abead3df4d5ac5665a1d'],
    [32768, 'c25ab02628542d8b3b4f7d9bf74adcf7cb64098a5df7465c6082f0340b3f181d'],
    [32769, 'a49cf38c1c114af37c9d81db9441e49b844fc53681bcdde0e000762daf315769'],
  ] as const;
  for (const [distance, digest] of cases) {
    for (const level of [1, 6, 12]) {
      it(`preserves distance ${distance} after two ring wraps, level ${level}`, () => {
        const backing = new Uint8Array(100017);
        let state = 0x93abcd01;
        for (let i = 0; i < backing.length; i++) {
          state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
          backing[i] = state >>> 24;
        }
        const pos = 65553;
        backing.copyWithin(pos, pos - distance, pos - distance + 258);
        const data = backing.subarray(7);
        const raw = deflateRaw(data, level);
        expect(createHash('sha256').update(raw).digest('hex')).toBe(digest);
        expect(sameBytes(new Uint8Array(inflateRawSync(raw)), data)).toBe(true);
      });
    }
  }
});
