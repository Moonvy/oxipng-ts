import { describe, expect, it } from 'vitest';
import { Options, optimizeFromMemory } from '../src/index.ts';
import { assertRgbaEqual, decodePng, readFixture } from './helpers.ts';

/**
 * Independent losslessness check: every lossless option set must produce a PNG
 * whose decoded pixels are byte-for-byte identical to the input. Decoding is
 * done with `pngjs`, an unrelated implementation, so a shared bug in our own
 * decoder cannot mask a regression.
 */
const FIXTURES = [
  'rgb_8_should_be_rgb_8.png',
  'rgb_16_should_be_rgb_16.png',
  'rgba_8_should_be_rgba_8.png',
  'rgba_16_should_be_rgba_16.png',
  'grayscale_8_should_be_grayscale_8.png',
  'grayscale_16_should_be_grayscale_16.png',
  'grayscale_alpha_8_should_be_grayscale_alpha_8.png',
  'grayscale_alpha_16_should_be_grayscale_alpha_16.png',
  'palette_8_should_be_palette_8.png',
  'palette_4_should_be_palette_4.png',
  'palette_2_should_be_palette_2.png',
  'palette_1_should_be_palette_1.png',
  'rgb_8_should_be_grayscale_8.png',
  'rgba_8_should_be_palette_8.png',
  'rgba_8_should_be_grayscale_8.png',
  'rgb_16_should_be_palette_4.png',
  'rgb_trns_8_should_be_palette_8.png',
  'small_files.png',
  'issue-60.png',
  'issue-140.png',
  'issue-182.png',
  'interlaced_rgb_8_should_be_rgb_8.png',
  'interlaced_odd_width.png',
  'interlaced_vertical_filters.png',
];

const OPTION_SETS: Array<[string, () => Options]> = [
  ['default', () => new Options()],
  ['preset 0', () => Options.fromPreset(0)],
  ['preset 3', () => Options.fromPreset(3)],
];

describe('losslessness sweep (independent decode)', () => {
  for (const file of FIXTURES) {
    for (const [label, make] of OPTION_SETS) {
      it(`${file} (${label})`, () => {
        const input = readFixture(file);
        const original = decodePng(input);
        const output = optimizeFromMemory(input, make());
        const optimized = decodePng(output);
        expect(optimized.width).toBe(original.width);
        expect(optimized.height).toBe(original.height);
        assertRgbaEqual(original.rgba, optimized.rgba, `${file} (${label})`);
      });
    }
  }
});
