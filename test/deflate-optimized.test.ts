import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { deflateRaw, deflateRawSize } from '../src/deflate/deflate.js';
import { SizeLimitExceeded } from '../src/deflate/bitwriter.js';

function patterned(length: number, alphabet: number): Uint8Array {
  const backing = new Uint8Array(length + 19);
  const bytes = backing.subarray(7, 7 + length);
  let state = 172973;
  for (let i = 0; i < length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    bytes[i] = (state >>> 24) % alphabet;
  }
  return bytes;
}

describe('wide-prefix matching and cost-based parsing', () => {
  for (const level of [7, 8, 9, 10, 11, 12]) {
    it(`independently decodes offset views, overlaps and block tails at level ${level}`, () => {
      for (const length of [0, 1, 2, 3, 4, 7, 8, 259, 32767, 32768, 32769, 65535, 65536, 65539, 131070, 131071]) {
        const data = patterned(length, length % 2 ? 13 : 256);
        if (length > 1000) {
          data.copyWithin(700, 100, 359);
          data.fill(0, 2000, Math.min(length, 2900));
          data.set(data.subarray(100, 103), length - 3);
        }
        const copy = data.slice();
        const encoded = deflateRaw(data, level);
        expect(inflateRawSync(encoded).equals(data)).toBe(true);
        expect(data).toEqual(copy);
        expect(deflateRawSize(data, level, encoded.length)).toBe(encoded.length);
        expect(() => deflateRawSize(data, level, encoded.length - 1)).toThrow(SizeLimitExceeded);
        expect(deflateRaw(data, level)).toEqual(encoded);
      }
    });
  }

  it('uses profitable three-byte matches with different fourth bytes', () => {
    const data = patterned(16000, 256);
    for (let i = 0; i < data.length; i += 4) data.set([4, 27, 191], i);
    const baseline = deflateRaw(data, 6);
    for (const level of [10, 11, 12]) {
      const output = deflateRaw(data, level);
      expect(output.length).toBeLessThan(baseline.length * 0.99);
      expect(inflateRawSync(output).equals(data)).toBe(true);
    }
  });

  it('preserves abrupt distribution changes and stored-block fallbacks', () => {
    const data = patterned(180000, 256);
    data.set(patterned(16384, 2));
    data.fill(0, 32768, 65536);
    data.set(patterned(32768, 13), 100000);
    for (const level of [10, 11, 12]) {
      const encoded = deflateRaw(data, level);
      expect(inflateRawSync(encoded).equals(data)).toBe(true);
      expect(deflateRawSize(data, level, encoded.length)).toBe(encoded.length);
      expect(() => deflateRawSize(data, level, encoded.length - 1)).toThrow(SizeLimitExceeded);
      expect(deflateRaw(data, level)).toEqual(encoded);
    }
  });

  it('finds older five-to-seven-byte matches behind a nearer four-byte prefix', () => {
    // Every record has an original, a decoy sharing four bytes, then a copy
    // of the original with a different eighth byte. An eight-byte hash
    // cannot find that copy, and keeping only the nearest prefix loses it.
    for (const [prefixLength, ceiling] of [[5, 17400], [6, 16300], [7, 15400]]) {
      const data = patterned(24000, 256);
      for (let i = 0; i < data.length; i += 24) {
        data.copyWithin(i + 8, i, i + 4);
        data[i + 12] = data[i + 4] ^ 255;
        data.copyWithin(i + 16, i, i + prefixLength);
        data[i + 16 + prefixLength] = data[i + prefixLength] ^ 255;
      }
      for (const level of [10, 11, 12]) {
        const output = deflateRaw(data, level);
        expect(output.length).toBeLessThan(ceiling);
        expect(inflateRawSync(output).equals(data)).toBe(true);
      }
    }
  });

  it('resets tree and chain state across levels, rejected limits and block tails', () => {
    const data = patterned(200003, 13);
    // Overlapping runs stress suffix insertion; copies at the full window
    // distance reuse the same tree slots, including around block boundaries.
    data.fill(0, 9000, 20000);
    for (const pos of [32768, 65530, 100000, 163840]) {
      data.set(data.subarray(pos - 32768, pos - 32768 + 258), pos);
    }
    const before = data.slice();
    for (const level of [12, 7, 10, 6, 11, 1, 12]) {
      const output = deflateRaw(data, level);
      expect(inflateRawSync(output).equals(data)).toBe(true);
      expect(deflateRawSize(data, level)).toBe(output.length);
      expect(() => deflateRaw(data, level, output.length - 1)).toThrow(SizeLimitExceeded);
      expect(deflateRaw(data, level, output.length)).toEqual(output);
    }
    expect(data).toEqual(before);
  });
});
