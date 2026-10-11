import { describe, expect, it } from 'vitest';
import { Options, PngError, optimizeFromMemory } from '../src/index.ts';
import { readFixture } from './helpers.ts';

describe('optimizeFromMemory (mirrors tests/lib.rs)', () => {
  it('succeeds on an already optimized image', () => {
    const input = readFixture('fully_optimized.png');
    expect(() => optimizeFromMemory(input, new Options())).not.toThrow();
  });

  it('rejects a corrupted header', () => {
    const input = readFixture('corrupted_header.png');
    expect(() => optimizeFromMemory(input, new Options())).toThrow(PngError);
  });

  it('handles an APNG input', () => {
    const input = readFixture('apng_file.png');
    const out = optimizeFromMemory(input, Options.fromPreset(0));
    expect(out.length).toBeGreaterThan(0);
  });

  it('recompresses an sRGB iCCP profile and strips it when safe', () => {
    const file = readFixture('badsrgb.png');
    const outDefault = optimizeFromMemory(file, new Options());
    expect(outDefault.length).toBeGreaterThan(1000);

    const opts = new Options();
    opts.strip = { mode: 'safe' };
    const outStripped = optimizeFromMemory(file, opts);
    expect(outStripped.length).toBeLessThan(1000);
  });
});
