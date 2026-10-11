import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Options } from '../src/options.ts';
import { deflaterDeflate, deflaterDeflateSize, deflaterEquals, libdeflater } from '../src/deflate/index.ts';
import { optimizeFromMemory } from '../src/optimize.ts';

function mixedData(): Uint8Array {
  const data = new Uint8Array(150019).subarray(7);
  let state = 71831;
  for (let i = 0; i < data.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    data[i] = i < 50000 ? state & 31 : i < 100000 ? i % 7 : state & 255;
  }
  return data;
}

describe('default optimal-parser budget', () => {
  it('applies only to preset 2 and distinguishes size-trial configurations', () => {
    expect(new Options().deflater).toEqual(libdeflater(11, true));
    expect(Options.fromPreset(2).deflater).toEqual(libdeflater(11, true));
    for (const level of [0, 1, 3, 4, 5, 6]) {
      expect(Options.fromPreset(level).deflater).not.toHaveProperty('fastOptimal', true);
    }
    expect(deflaterEquals(libdeflater(11), libdeflater(11, true))).toBe(false);
    expect(deflaterEquals(libdeflater(11), { kind: 'libdeflater', compression: 11, fastOptimal: false })).toBe(true);
  });

  it('emits lossless data with exact size trials and output limits across block transitions', () => {
    const data = mixedData(), deflater = libdeflater(11, true);
    const output = deflaterDeflate(deflater, data);
    expect(inflateSync(output).equals(data)).toBe(true);
    expect(deflaterDeflateSize(deflater, data, output.length)).toBe(output.length);
    expect(deflaterDeflate(deflater, data, output.length)).toEqual(output);
    expect(() => deflaterDeflateSize(deflater, data, output.length - 1)).toThrow();
    expect(() => deflaterDeflate(deflater, data, output.length - 1)).toThrow();
    expect(output.length).toBeLessThanOrEqual(deflaterDeflate(libdeflater(11), data).length * 1.05);
  });

  it('retains full parsing for highly compressible blocks', () => {
    const data = Uint8Array.from({ length: 100003 }, (_, i) => i % 7);
    expect(deflaterDeflate(libdeflater(11, true), data)).toEqual(deflaterDeflate(libdeflater(11), data));
  });

  it('preserves the baseline PNG streams for gradients and reduced low-colour shapes', () => {
    // Recorded before reducing the match-interior insertion budget. Shapes
    // become indexed data with several common bytes, rather than just zeros.
    for (const [name, hash] of [
      ['gradient.png', 'b513f32f5158757c8fb5d957f5cfac8e5e66973fa2a38025549f17532a9c83b4'],
      ['shapes.png', '2fc0f819fd3da75c7f560b6be4baa18e2d5eb9b770b33f7faca9092652f50445'],
    ]) {
      const input = readFileSync(new URL(`../docs/samples/${name}`, import.meta.url));
      const output = optimizeFromMemory(input, Options.fromPreset(2));
      expect(createHash('sha256').update(output).digest('hex')).toBe(hash);
    }
  });

  it('handles empty and short data with matching size trials', () => {
    for (const data of [new Uint8Array(), Uint8Array.of(1), Uint8Array.of(1, 2, 3)]) {
      const deflater = libdeflater(11, true), output = deflaterDeflate(deflater, data);
      expect(inflateSync(output).equals(data)).toBe(true);
      expect(deflaterDeflateSize(deflater, data)).toBe(output.length);
    }
  });

  it('updates skipped match interiors across window and block tails without mutating input', () => {
    for (const distance of [32767, 32768, 32769]) {
      for (const tail of [1, 3, 7]) {
        const backing = new Uint8Array(65535 + tail + 19).fill(0x9b);
        const data = backing.subarray(7, backing.length - 12);
        let state = 192731;
        for (let i = 0; i < data.length; i++) {
          state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
          data[i] = (state >>> 24) % 31;
        }
        // Repeated long prefixes followed by different tails exercise tree
        // branches while retaining matches at and around the window limit.
        for (let p = 512; p + 258 < distance; p += 300) {
          data.copyWithin(p, 0, 258);
          data[p + 257] ^= p & 255;
        }
        data.copyWithin(distance, 0, 258);
        data.copyWithin(65535 - 129, 512, 512 + 129 + tail);
        const original = backing.slice();
        const deflater = libdeflater(11, true);
        const output = deflaterDeflate(deflater, data);
        expect(inflateSync(output).equals(data)).toBe(true);
        expect(deflaterDeflateSize(deflater, data, output.length)).toBe(output.length);
        expect(deflaterDeflate(deflater, data, output.length)).toEqual(output);
        expect(() => deflaterDeflateSize(deflater, data, output.length - 1)).toThrow();
        expect(() => deflaterDeflate(deflater, data, output.length - 1)).toThrow();
        expect(backing).toEqual(original);
      }
    }
  });

  it('does not change other compression levels when the default budget is requested', () => {
    const data = mixedData();
    for (const level of [0, 1, 7, 10, 12]) {
      expect(deflaterDeflate(libdeflater(level, true), data)).toEqual(deflaterDeflate(libdeflater(level), data));
    }
  });
});
