import { describe, expect, it, vi } from 'vitest';
import { Deadline, Entropy, Evaluator, NONE, Options, PAETH, PngImage, RGBA, SUB,
  deflate, indexed, libdeflater, performTrials } from '../src/index.js';
import { readFixture } from './helpers.js';
import { PngData } from '../src/png/index.js';

describe('filtering and trial pipeline', () => {
  it('subtracts palette overhead while retaining candidates tied at the limit', () => {
    const image = new PngImage({ width: 16, height: 1, bitDepth: 8, interlaced: false,
      colorType: indexed([0x000000ff, 0xffffffff]) }, new Uint8Array(16));
    const [filtered] = image.filterImage(NONE, false);
    const size = image.estimatedOutputSize(deflate(filtered, 6));
    const evaluator = new Evaluator(new Deadline(null), [NONE], libdeflater(6), false, true);
    evaluator.setBestSize(size);
    evaluator.tryImage(image);
    expect(evaluator.getBestCandidate()?.estimatedOutputSize).toBe(size);
    const tooSmall = new Evaluator(new Deadline(null), [NONE], libdeflater(6), false, true);
    tooSmall.setBestSize(size - 1);
    tooSmall.tryImage(image);
    expect(tooSmall.getBestCandidate()).toBeNull();
  });

  for (const optimizeAlpha of [false, true]) {
    it(`reuses only compatible winning streams (optimizeAlpha=${optimizeAlpha})`, () => {
      const image = new PngImage({ width: 8, height: 2, bitDepth: 8, interlaced: false,
        colorType: RGBA }, Uint8Array.from({ length: 64 }, (_, i) => i % 4 === 3 ? 0 : i));
      const evaluator = new Evaluator(new Deadline(null), [SUB], libdeflater(5), false, false);
      evaluator.tryImage(image);
      const candidate = evaluator.getBestCandidate()!;
      const spy = vi.spyOn(image, 'filterImage');
      const opts = Options.fromPreset(2);
      opts.optimizeAlpha = optimizeAlpha;
      opts.filters = [SUB];
      const result = performTrials(image, opts, new Deadline(null), undefined, candidate, [SUB], libdeflater(5));
      expect(spy).toHaveBeenCalledTimes(optimizeAlpha ? 1 : 0);
      expect(result?.idatData).toBeDefined();
      expect(result?.filteredData).toBeUndefined();
      expect(image.data).toEqual(Uint8Array.from({ length: 64 }, (_, i) => i % 4 === 3 ? 0 : i));
    });
  }

  for (const file of ['interlaced_odd_width.png', 'interlaced_vertical_filters.png', 'rgba_16_should_be_rgba_16.png']) {
    it(`borrowed rows remain lossless and immutable: ${file}`, () => {
      const image = PngData.fromSlice(readFixture(file), new Options()).raw;
      const original = image.data.slice();
      for (const strategy of [NONE, SUB, PAETH, Entropy]) {
        const [filtered] = image.filterImage(strategy, false);
        const decoded = PngImage.new(image.ihdr, deflate(filtered, 6));
        expect(decoded.data).toEqual(original);
        expect(image.data).toEqual(original);
      }
    });
  }
});
