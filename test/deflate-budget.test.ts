import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Options } from '../src/options.ts';
import { deflaterDeflate, deflaterDeflateSize, deflaterEquals, libdeflater } from '../src/deflate/index.ts';

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

  it('handles empty and short data with matching size trials', () => {
    for (const data of [new Uint8Array(), Uint8Array.of(1), Uint8Array.of(1, 2, 3)]) {
      const deflater = libdeflater(11, true), output = deflaterDeflate(deflater, data);
      expect(inflateSync(output).equals(data)).toBe(true);
      expect(deflaterDeflateSize(deflater, data)).toBe(output.length);
    }
  });
});
