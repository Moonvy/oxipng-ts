import { describe, expect, it } from 'vitest';
import { Options, optimizeFromMemory } from '../src/index.js';
import { assertRgbaEqual, decodePng, headerInfo, readFixture } from './helpers.js';

const FIXTURES = [
  'rgb_8_should_be_rgb_8.png',
  'rgb_16_should_be_rgb_16.png',
  'rgba_8_should_be_rgba_8.png',
  'rgba_16_should_be_rgba_16.png',
  'grayscale_8_should_be_grayscale_8.png',
  'grayscale_16_should_be_grayscale_16.png',
  'palette_8_should_be_palette_8.png',
  'palette_4_should_be_palette_4.png',
  'small_files.png',
  'issue-140.png',
  'issue-182.png',
];

describe('optimizeFromMemory smoke test', () => {
  for (const name of FIXTURES) {
    it(`preserves pixels for ${name}`, () => {
      const input = readFixture(name);
      const original = decodePng(input);
      const output = optimizeFromMemory(input, new Options());
      const optimized = decodePng(output);
      expect(optimized.width).toBe(original.width);
      expect(optimized.height).toBe(original.height);
      assertRgbaEqual(original.rgba, optimized.rgba, name);
    });
  }

  it('reduces a palette image to 4-bit', () => {
    const input = readFixture('palette_8_should_be_palette_4.png');
    const opts = Options.fromPreset(3);
    opts.force = true;
    const output = optimizeFromMemory(input, opts);
    expect(headerInfo(output).bitDepth).toBe(4);
  });
});
