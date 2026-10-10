import { afterEach, describe, expect, it, vi } from 'vitest';
import * as compression from '../src/deflate/index.js';
import { Deadline } from '../src/deadline.js';
import { Evaluator } from '../src/evaluate.js';
import { grayscale, indexed, RGBA } from '../src/colors.js';
import { Bigrams, MinSum, NONE, SUB, UP, type FilterStrategy } from '../src/filters/strategies.js';
import { PngImage } from '../src/png/index.js';
import { Options } from '../src/options.js';
import { performTrials } from '../src/optimize.js';

afterEach(() => vi.restoreAllMocks());

function image(dataLength = 187): PngImage {
  const data = new Uint8Array(dataLength);
  for (let i = 0; i < data.length; i++) data[i] = ((i * 13) ^ (i >>> 3)) & 255;
  return new PngImage({ width: 17, height: 11, bitDepth: 8, colorType: grayscale(null), interlaced: false }, data);
}

function evaluate(images: PngImage[], finalRound: boolean, filters: FilterStrategy[], deflater = compression.libdeflater(6)) {
  const trace: string[] = [];
  const evaluator = new Evaluator(new Deadline(null), filters, deflater, false, finalRound, (msg) => trace.push(msg));
  for (const candidate of images) evaluator.tryImage(candidate);
  return { best: evaluator.getBestCandidate(), trace };
}

describe('exact zlib size trials', () => {
  const inputs = [new Uint8Array(0), new Uint8Array([42]), image().data];
  for (const deflater of [compression.libdeflater(0), compression.libdeflater(1), compression.libdeflater(6.4), compression.libdeflater(12), compression.zopfli()]) {
    it(`matches encoded sizes and bounded errors for ${JSON.stringify(deflater)}`, () => {
      for (const data of inputs) {
        const encoded = compression.deflaterDeflate(deflater, data);
        expect(compression.deflaterDeflateSize(deflater, data)).toBe(encoded.length);
        for (const limit of [encoded.length, encoded.length + 0.5, Infinity]) {
          expect(compression.deflaterDeflateSize(deflater, data, limit)).toBe(encoded.length);
          expect(compression.deflaterDeflate(deflater, data, limit)).toEqual(encoded);
        }
        for (const limit of [-1, 0, 1, 5, 6, 7, encoded.length - 0.5]) {
          const error = expect.objectContaining({ kind: 'DeflatedDataTooLong', size: limit });
          expect(() => compression.deflaterDeflateSize(deflater, data, limit)).toThrow(error);
          expect(() => compression.deflaterDeflate(deflater, data, limit)).toThrow(error);
        }
      }
    });
  }
});

describe('size-only image evaluation', () => {
  const filters = [NONE, SUB, UP, MinSum, Bigrams];

  for (const deflater of [compression.libdeflater(0), compression.libdeflater(6), compression.libdeflater(12), compression.zopfli()]) {
    it(`selects the same candidate and traces as writing trials: ${JSON.stringify(deflater)}`, () => {
      const gray = image();
      const palette = image();
      palette.ihdr = { ...palette.ihdr, colorType: indexed([0x000000ff, 0xffffffff, 0xff000000]) };
      palette.data = palette.data.map((value) => value % 3);
      const rgba = image(748);
      rgba.ihdr = { ...rgba.ihdr, colorType: RGBA };
      const images = [palette, rgba, gray];
      const counted = evaluate(images, false, filters, deflater);
      const written = evaluate(images, true, filters, deflater);
      expect(counted.trace).toEqual(written.trace);
      expect(counted.best).not.toBeNull();
      expect(counted.best!.image).toBe(written.best!.image);
      expect(counted.best!.filter).toBe(written.best!.filter);
      expect(counted.best!.filterUsed).toEqual(written.best!.filterUsed);
      expect(counted.best!.estimatedOutputSize).toBe(written.best!.estimatedOutputSize);
      expect(counted.best!.nth).toBe(written.best!.nth);
      expect(counted.best!.idatData).toBeNull();
      expect(compression.deflaterDeflate(deflater, counted.best!.filteredData!)).toEqual(written.best!.idatData);
      expect(written.best!.filteredData).toBeUndefined();
    });
  }

  it('keeps equal-size tie breaks for image length, filter order, and later images', () => {
    const stream = new Uint8Array([0, 1, 2, 3]);
    const larger = image(2);
    const first = image(1);
    const later = image(1);
    for (const candidate of [larger, first, later]) {
      vi.spyOn(candidate, 'filterImage').mockImplementation((filter) => [stream, filter]);
    }
    for (const finalRound of [false, true]) {
      const { best } = evaluate([larger, first, later], finalRound, [UP, NONE, SUB]);
      expect(best!.image).toBe(later);
      expect(best!.filter).toBe(NONE);
      expect(best!.nth).toBe(2);
    }
  });

  it('accounts for palette and transparency chunks in inclusive size limits', () => {
    const candidate = image();
    candidate.ihdr = { ...candidate.ihdr, colorType: indexed([0x00000000, 0xffffffff]) };
    candidate.data.fill(0);
    const filtered = candidate.filterImage(NONE, false)[0];
    const size = candidate.keyChunksSize() + compression.deflaterDeflate(compression.libdeflater(6), filtered).length;
    for (const bound of [0, candidate.keyChunksSize() + 5, size - 1, size]) {
      const outcomes = [false, true].map((finalRound) => {
        const trace: string[] = [];
        const evaluator = new Evaluator(new Deadline(null), [NONE], compression.libdeflater(6), false, finalRound, (msg) => trace.push(msg));
        evaluator.setBestSize(bound);
        evaluator.tryImage(candidate);
        return { best: evaluator.getBestCandidate(), trace };
      });
      expect(outcomes[0].trace).toEqual(outcomes[1].trace);
      expect(outcomes[0].best?.estimatedOutputSize).toBe(outcomes[1].best?.estimatedOutputSize);
      expect(outcomes[0].best !== null).toBe(bound === size);
    }
  });

  it('retains the winning filtered stream for final compression with the alpha setting', () => {
    const candidate = image(748);
    candidate.ihdr = { ...candidate.ihdr, colorType: RGBA };
    const filterSpy = vi.spyOn(candidate, 'filterImage');
    const evaluator = new Evaluator(new Deadline(null), [MinSum], compression.libdeflater(6), true, false);
    evaluator.tryImage(candidate);
    const best = evaluator.getBestCandidate()!;
    expect(best.filteredOptimizeAlpha).toBe(true);
    const expected = compression.deflaterDeflate(compression.libdeflater(12), best.filteredData!);
    const opts = new Options();
    opts.filters = [MinSum];
    opts.deflater = compression.libdeflater(12);
    opts.fastEvaluation = true;
    opts.optimizeAlpha = true;
    const result = performTrials(candidate, opts, new Deadline(null), undefined, best, [MinSum], compression.libdeflater(6));
    expect(result!.idatData).toEqual(expected);
    expect(result!.filteredData).toBeUndefined();
    expect(filterSpy).toHaveBeenCalledTimes(1);
  });

  it('checks the deadline before each filter and retains work completed before expiry', () => {
    for (const finalRound of [false, true]) {
      const deadline = new Deadline(null);
      vi.spyOn(deadline, 'passed').mockReturnValueOnce(false).mockReturnValue(true);
      const candidate = image();
      const filterSpy = vi.spyOn(candidate, 'filterImage');
      const evaluator = new Evaluator(deadline, [NONE, SUB], compression.libdeflater(6), false, finalRound);
      evaluator.tryImage(candidate);
      evaluator.tryImage(image());
      expect(evaluator.getBestCandidate()!.filter).toBe(NONE);
      expect(filterSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('continues after unexpected compression failures just as writing trials do', () => {
    for (const finalRound of [false, true]) {
      const spy = vi.spyOn(compression, finalRound ? 'deflaterDeflate' : 'deflaterDeflateSize');
      spy.mockImplementationOnce(() => { throw new Error('encoder failed'); });
      const { best, trace } = evaluate([image()], finalRound, [NONE, SUB]);
      expect(best!.filter).toBe(SUB);
      expect(trace).toHaveLength(1);
      spy.mockRestore();
    }
  });
});
