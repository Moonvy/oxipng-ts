import { describe, expect, it } from 'vitest';
import { BitDepth, Options, PngData, PngError, RawImage, RGBA, indexed, optimizeFromMemory, rgba8 } from '../src/index.ts';
import { decodePng, headerInfo, readFixture } from './helpers.ts';

describe('raw API (mirrors tests/raw.rs)', () => {
  it('round-trips a decoded image through RawImage', () => {
    const input = readFixture('raw_api.png');
    const opts = new Options();
    opts.force = true;

    const decoded = PngData.fromSlice(input, opts);
    const ihdr = decoded.raw.ihdr;
    const raw = new RawImage(ihdr.width, ihdr.height, ihdr.colorType, ihdr.bitDepth, decoded.raw.data);
    for (const chunk of decoded.auxChunks) {
      if (chunk.name !== 'IDAT') raw.addPngChunk(chunk.name, chunk.data);
    }

    const output = raw.createOptimizedPng(opts);
    const reparsed = PngData.fromSlice(output, opts);
    expect(reparsed.auxChunks.length).toBe(decoded.auxChunks.length);
    expect(() => decodePng(output)).not.toThrow();
  });

  it('optimizes a custom indexed image', () => {
    const palette = [rgba8(255, 255, 255, 255), rgba8(255, 0, 0, 255), rgba8(0, 255, 0, 255), rgba8(0, 0, 255, 255)];
    const raw = new RawImage(
      4,
      4,
      indexed(palette),
      BitDepth.Eight,
      new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3]),
    );
    const opts = new Options();
    opts.force = true;
    const out = raw.createOptimizedPng(opts);
    expect(() => decodePng(out)).not.toThrow();
    expect(headerInfo(out).colorType).toBe(3);
  });

  it('rejects an invalid depth for the colour type', () => {
    expect(
      () => new RawImage(2, 2, RGBA, BitDepth.Four, new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3])),
    ).toThrow(PngError);
  });

  it('rejects an incorrect data length', () => {
    expect(() => new RawImage(2, 2, RGBA, BitDepth.Eight, new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1]))).toThrow(PngError);
  });
});

describe('not-a-png handling', () => {
  it('throws NotPNG for arbitrary bytes', () => {
    try {
      optimizeFromMemory(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), new Options());
      throw new Error('expected error');
    } catch (err) {
      expect((err as { kind?: string }).kind).toBe('NotPNG');
    }
  });
});
