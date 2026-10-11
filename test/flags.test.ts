import { describe, expect, it } from 'vitest';
import { NONE, Options, optimizeFromMemory } from '../src/index.ts';
import { countChunk, headerInfo, readFixture } from './helpers.ts';

function baseOpts(): Options {
  const o = new Options();
  o.force = true;
  o.filters = [NONE];
  return o;
}

describe('chunk stripping (mirrors tests/flags.rs)', () => {
  it('strips an explicit chunk list, keeping others', () => {
    const input = readFixture('strip_chunks_list.png');
    expect(countChunk(input, 'tEXt')).toBe(3);
    expect(countChunk(input, 'iTXt')).toBe(1);
    expect(countChunk(input, 'iCCP')).toBe(1);

    const opts = baseOpts();
    opts.strip = { mode: 'strip', names: new Set(['iCCP', 'tEXt']) };
    const out = optimizeFromMemory(input, opts);
    expect(countChunk(out, 'tEXt')).toBe(0);
    expect(countChunk(out, 'iTXt')).toBe(1);
    expect(countChunk(out, 'iCCP')).toBe(0);
  });

  it('strips all non-display chunks with safe mode', () => {
    const input = readFixture('strip_chunks_safe.png');
    const opts = baseOpts();
    opts.strip = { mode: 'safe' };
    const out = optimizeFromMemory(input, opts);
    expect(countChunk(out, 'tEXt')).toBe(0);
    expect(countChunk(out, 'iTXt')).toBe(0);
  });

  it('strips everything with all mode', () => {
    const input = readFixture('strip_chunks_all.png');
    const opts = baseOpts();
    opts.strip = { mode: 'all' };
    const out = optimizeFromMemory(input, opts);
    expect(countChunk(out, 'tEXt')).toBe(0);
    expect(countChunk(out, 'iTXt')).toBe(0);
    expect(countChunk(out, 'iCCP')).toBe(0);
  });

  it('keeps everything with none mode', () => {
    const input = readFixture('strip_chunks_none.png');
    const opts = baseOpts();
    opts.strip = { mode: 'none' };
    const out = optimizeFromMemory(input, opts);
    expect(countChunk(out, 'tEXt')).toBe(3);
    expect(countChunk(out, 'iTXt')).toBe(1);
    expect(countChunk(out, 'iCCP')).toBe(1);
  });
});

describe('flags', () => {
  it('fix_errors recovers a file with a bad checksum', () => {
    const input = readFixture('fix_errors.png');
    const opts = baseOpts();
    opts.fixErrors = true;
    const out = optimizeFromMemory(input, opts);
    expect(headerInfo(out)).toMatchObject({ colorType: 3, bitDepth: 8 });
  });

  it('no_grayscale_change keeps colour type', () => {
    const input = readFixture('rgb_8_should_be_grayscale_8.png');
    const opts = baseOpts();
    opts.grayscaleReduction = false;
    const out = optimizeFromMemory(input, opts);
    expect(headerInfo(out)).toMatchObject({ colorType: 3, bitDepth: 8 });
  });

  it('scale_16 forces 16-bit down to 8-bit', () => {
    const input = readFixture('rgb_16_should_be_rgb_16.png');
    const opts = baseOpts();
    opts.scale16 = true;
    const out = optimizeFromMemory(input, opts);
    expect(headerInfo(out)).toMatchObject({ colorType: 2, bitDepth: 8 });
  });

  it('max_decompressed_size rejects oversized images', () => {
    const input = readFixture('max_size.png');
    const opts = new Options();
    opts.maxDecompressedSize = 150_000;
    try {
      optimizeFromMemory(input, opts);
      throw new Error('expected an error');
    } catch (err) {
      expect((err as { kind?: string }).kind).toBe('InflatedDataTooLong');
    }
  });
});
