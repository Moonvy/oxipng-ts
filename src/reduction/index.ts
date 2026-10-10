import { colorTypeEquals, hasTrns } from '../colors.js';
import type { Deadline } from '../deadline.js';
import type { Evaluator } from '../evaluate.js';
import type { Options } from '../options.js';
import type { PngImage } from '../png/index.js';
import { cleanedAlphaChannel, reducedAlphaChannel } from './alpha.js';
import { expandedBitDepthTo8, reducedBitDepth16To8, reducedBitDepth8OrLess } from './bitDepth.js';
import { INDEXED_MAX_DIFF, indexedToChannels, reducedRgbToGrayscale, reducedToIndexed } from './color.js';
import { changedInterlacing } from './interlace.js';
import { CoOccurrenceMatrix, reducedPalette, sortedPalette, sortedPaletteBattiato, sortedPaletteEzeng } from './palette.js';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Run all applicable reductions, using the evaluator to pick the best result. */
export function performReductions(
  pngIn: PngImage,
  opts: Options,
  deadline: Deadline,
  eval_: Evaluator,
): PngImage {
  let png = pngIn;
  let evaluationAdded = false;

  // Infer the effort level from the settings.
  const effort = (() => {
    if (opts.deflater.kind !== 'libdeflater') return 4;
    const c = opts.deflater.compression;
    if (c <= 9) return 0;
    if (c === 10) return 1;
    if (c === 11) return opts.filters.length <= 4 ? 2 : 3;
    return 4;
  })();

  if (opts.optimizeAlpha) {
    const reduced = cleanedAlphaChannel(png);
    if (reduced) png = reduced;
  }

  if (opts.bitDepthReduction) {
    const reduced = reducedBitDepth16To8(png, opts.scale16);
    if (reduced) png = reduced;
  }

  if (opts.colorTypeReduction && opts.grayscaleReduction) {
    const reduced = reducedRgbToGrayscale(png);
    if (reduced) png = reduced;
  }

  if (opts.bitDepthReduction) {
    const reduced = expandedBitDepthTo8(png);
    if (reduced) png = reduced;
  }

  if (opts.interlace !== null) {
    const reduced = changedInterlacing(png, opts.interlace);
    if (reduced) png = reduced;
  }

  let baseline = png;

  if (opts.paletteReduction && !deadline.passed()) {
    const reduced = reducedPalette(png, opts.optimizeAlpha);
    if (reduced) {
      png = reduced;
      if (bytesEqual(png.data, baseline.data)) baseline = png;
    }
    const sorted = sortedPalette(png);
    if (sorted) png = sorted;
    if (png !== baseline) {
      eval_.tryImageWithDescription(png, 'Indexed (luma sort)');
      evaluationAdded = true;
    }
  }

  if (opts.colorTypeReduction && !deadline.passed()) {
    const reduced = reducedAlphaChannel(png, opts.optimizeAlpha);
    if (reduced) {
      png = reduced;
      if (hasTrns(png.ihdr.colorType) && baseline.data.length - png.data.length <= 1000) {
        eval_.tryImage(png);
        evaluationAdded = true;
      } else {
        baseline = png;
      }
    }
  }

  if (effort >= 3 && opts.colorTypeReduction && !deadline.passed()) {
    const reduced = indexedToChannels(png, opts.grayscaleReduction, opts.optimizeAlpha);
    if (reduced) {
      eval_.tryImage(reduced);
      evaluationAdded = true;
    }
  }

  let indexed: PngImage | null = null;
  if (opts.colorTypeReduction && opts.paletteReduction && !deadline.passed()) {
    const reduced = reducedToIndexed(png, opts.grayscaleReduction);
    if (reduced) {
      const sorted = sortedPalette(reduced);
      const next = sorted ?? reduced;
      if (png.data.length - next.data.length <= INDEXED_MAX_DIFF) {
        eval_.tryImageWithDescription(next, 'Indexed (luma sort)');
        evaluationAdded = true;
      } else {
        baseline = next;
      }
      indexed = next;
    }
  }

  if (effort >= 2 && opts.paletteReduction && !deadline.passed()) {
    const palettes = [baseline.ihdr.colorType];
    const input = indexed ?? png;
    const matrix = CoOccurrenceMatrix.from(input);
    if (matrix) {
      const maxSwapDist = effort >= 3 ? 50 : 1;
      if (!deadline.passed()) {
        const reduced = sortedPaletteEzeng(input, matrix, maxSwapDist);
        if (reduced && !palettes.some((ct) => colorTypeEquals(ct, reduced.ihdr.colorType))) {
          palettes.push(reduced.ihdr.colorType);
          eval_.tryImageWithDescription(reduced, 'Indexed (ezeng sort)');
          evaluationAdded = true;
        }
      }
      if (effort >= 4 && !deadline.passed()) {
        const reduced = sortedPaletteBattiato(input, matrix);
        if (reduced && !palettes.some((ct) => colorTypeEquals(ct, reduced.ihdr.colorType))) {
          palettes.push(reduced.ihdr.colorType);
          eval_.tryImageWithDescription(reduced, 'Indexed (battiato sort)');
          evaluationAdded = true;
        }
      }
    }
  }

  if (opts.bitDepthReduction && !deadline.passed()) {
    const reduced = reducedBitDepth8OrLess(png);
    if ((effort >= 3 || reduced === null) && !deadline.passed()) {
      const indexedReduced = indexed ? reducedBitDepth8OrLess(indexed) : null;
      if (indexedReduced && (reduced === null || !bytesEqual(reduced.data, indexedReduced.data))) {
        eval_.tryImage(indexedReduced);
        evaluationAdded = true;
      }
    }
    if (reduced) {
      eval_.tryImage(reduced);
      evaluationAdded = true;
    }
  }

  if (evaluationAdded) eval_.tryImage(baseline);
  return baseline;
}
