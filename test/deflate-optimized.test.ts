import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deflateRaw, deflateRawSize } from '../src/deflate/deflate.ts';
import { SizeLimitExceeded } from '../src/deflate/bitwriter.ts';

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
  it('preserves length-range minima in long-match blocks at every length boundary', () => {
    const data = Uint8Array.from({ length: 100003 }, (_, i) => (i % 7) * 13);
    for (let len = 3; len <= 258; len++) {
      const pos = 1000 + len * 350;
      data.copyWithin(pos, pos - 700, pos - 700 + len);
      data[pos + len] ^= 255;
    }
    for (const [level, hash] of [
      [10, '0c2d55c0a34d6d90c3dbcd322a915581121c9ba9cdff545dec872f788261a4bd'],
      [11, '0c2d55c0a34d6d90c3dbcd322a915581121c9ba9cdff545dec872f788261a4bd'],
      [12, 'e632350bae4113dd8754958d71e558a922fc6ffb19924dad3cf8f70203d761db'],
    ] as const) {
      const output = deflateRaw(data, level);
      expect(createHash('sha256').update(output).digest('hex')).toBe(hash);
      expect(inflateRawSync(output).equals(data)).toBe(true);
      expect(deflateRawSize(data, level, output.length)).toBe(output.length);
      expect(() => deflateRawSize(data, level, output.length - 1)).toThrow(SizeLimitExceeded);
    }
  });

  it('preserves converged models and literal-only gaps across a block tail', () => {
    const data = new Uint8Array(65536);
    const hash = 'd8d8a351b0fee47044a54c54cabceb63d9fa50b39af7bc0059b1f423ccff2cdf';
    for (const level of [10, 11, 12]) {
      const output = deflateRaw(data, level);
      expect(createHash('sha256').update(output).digest('hex')).toBe(hash);
      expect(inflateRawSync(output).equals(data)).toBe(true);
      expect(deflateRawSize(data, level)).toBe(output.length);
    }
  });

  it('preserves scalar length choices across every DEFLATE length boundary', () => {
    const data = patterned(100003, 13);
    for (let len = 3; len <= 258; len++) {
      const pos = 1000 + len * 350;
      data.copyWithin(pos, pos - 700, pos - 700 + len);
      data[pos + len] ^= 255;
    }
    // Reference streams from before range minima and convergence stopping.
    for (const [level, hash] of [
      [10, '43c0363700fcd95671d74518495e02861ea9531ad9d04974bef4147ccd132a8a'],
      [11, '0b3dec72230ad2519e64cfdcd39f38fc65a69a97d91d8453d8bd1df7ee88f2f4'],
      [12, '80205c3f7ad1809fcf07b7e1a042460e8fc046caf8d17d171c3b32d4d0acf86e'],
    ] as const) {
      const output = deflateRaw(data, level);
      expect(createHash('sha256').update(output).digest('hex')).toBe(hash);
      expect(inflateRawSync(output).equals(data)).toBe(true);
      expect(deflateRawSize(data, level, output.length)).toBe(output.length);
      expect(() => deflateRawSize(data, level, output.length - 1)).toThrow(SizeLimitExceeded);
    }
  });

  it('preserves reference streams when inserting long-match interiors across blocks', () => {
    const data = new Uint8Array(131079);
    for (let i = 0; i < data.length; i++) data[i] = i % 521 < 259 ? (i % 7) * 13 : (i % 3) * 41;
    for (const pos of [32765, 65533, 98303]) {
      data.fill(0, pos - 300, pos + 300);
      data[pos] = 255;
    }
    // Golden hashes from the encoder before splitting tree insertion and
    // path computation. They cover ties and tree ordering as well as pixels.
    for (const [level, hash] of [
      [10, '54b943f1d452875b0c89019a7a4c3f352c9aa19e0590f35179c4ec16a5bafb3e'],
      [11, 'd5d2b78bcf8b894890be31f6ed3dd3f47f2ef89cad45a707896598b06850ce73'],
      [12, '8e6b6026589d35674abcdde1fa27d8cdfb9ef7cfb7275241d3ad8d40cedeb7e9'],
    ] as const) {
      const output = deflateRaw(data, level);
      expect(createHash('sha256').update(output).digest('hex')).toBe(hash);
      expect(inflateRawSync(output).equals(data)).toBe(true);
      expect(deflateRawSize(data, level)).toBe(output.length);
    }
  });

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
