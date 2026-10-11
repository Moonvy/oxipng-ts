export {
  BitDepth,
  channelsPerPixel,
  colorTypeEquals,
  colorTypeToString,
  grayscale,
  GRAYSCALE_ALPHA,
  hasAlpha,
  hasTrns,
  indexed,
  isGray,
  isRgb,
  pngHeaderCode,
  rgb,
  RGBA,
  rgba8,
  rgba8A,
  rgba8B,
  rgba8G,
  rgba8R,
  type ColorType,
  type GrayscaleAlphaColorType,
  type GrayscaleColorType,
  type IndexedColorType,
  type RGB16,
  type RGBAColorType,
  type RGBColorType,
  type RGBA8,
} from './colors.ts';

export { PngError, type OptimizationResult, type PngErrorKind } from './error.ts';

export {
  deflate,
  deflateRaw,
  deflaterDeflate,
  deflaterEquals,
  deflaterToString,
  inflate,
  libdeflater,
  zopfli,
  type Deflater,
  type ZopfliOptions,
} from './deflate/index.ts';

export {
  fileHeaderIsValid,
  extractIcc,
  makeIccp,
  nameBytes,
  parseIhdrChunk,
  parseNextChunk,
  postprocessChunks,
  preprocessChunks,
  rawDataSize,
  srgbRenderingIntent,
  stripKeep,
  DISPLAY_CHUNKS,
  type Chunk,
  type IhdrData,
  type RawChunk,
  type StripChunks,
} from './headers.ts';

export {
  filterLine,
  paethPredictor,
  rowFilterFromNumber,
  rowFilterName,
  ROW_FILTER_ALL,
  ROW_FILTER_NAMES,
  RowFilter,
  unfilterLine,
  type RowFilter as RowFilterType,
} from './filters/index.ts';

export {
  basic,
  filterStrategyCompare,
  filterStrategyEquals,
  filterStrategyKey,
  filterStrategyToString,
  strategyEvaluator,
  AVERAGE,
  BigEnt,
  Bigrams,
  Brute,
  Entropy,
  MinSum,
  NONE,
  PAETH,
  Predefined,
  SUB,
  UP,
  type FilterStrategy,
  type StrategyEvaluator,
} from './filters/strategies.ts';

export { Frame } from './apng.ts';
export { PngData, PngImage, writePngBlock } from './png/index.ts';
export { ScanLines, ScanLineRanges, type ScanLine } from './png/scanLines.ts';
export { Options } from './options.ts';
export { Deadline, now, AtomicMin } from './deadline.ts';
export { Evaluator, type Candidate } from './evaluate.ts';
export { isFullyOptimized, optimizeFromMemory, optimizePng, optimizeRaw, performTrials, RawImage, recompressFrames } from './optimize.ts';
export {
  LogLevel,
  getLogLevel,
  setLogLevel,
  setLogSink,
  logDebug,
  logError,
  logInfo,
  logTrace,
  logWarn,
} from './log.ts';

// Reduction internals (exported for parity with oxipng's `internal_tests`).
export { cleanedAlphaChannel, reducedAlphaChannel } from './reduction/alpha.ts';
export {
  expandedBitDepthTo8,
  reducedBitDepth16To8,
  reducedBitDepth8OrLess,
  reducedBitDepthForced,
  scaledBitDepth16To8,
} from './reduction/bitDepth.ts';
export { INDEXED_MAX_DIFF, indexedToChannels, reducedRgbToGrayscale, reducedToIndexed } from './reduction/color.ts';
export { changedInterlacing } from './reduction/interlace.ts';
export {
  CoOccurrenceMatrix,
  reducedPalette,
  sortedPalette,
  sortedPaletteBattiato,
  sortedPaletteEzeng,
} from './reduction/palette.ts';
export { performReductions } from './reduction/index.ts';

import { Options } from './options.ts';
import { optimizeFromMemory } from './optimize.ts';


/**
 * Optimize a PNG image held in memory.
 *
 * @param image   The input PNG bytestream (a `Uint8Array` or `ArrayBuffer`).
 * @param options Optional {@link Options}; defaults match oxipng's `-o 2`.
 * @returns The optimized PNG bytestream.
 */
export async function oxipng(
  image: Uint8Array | ArrayBuffer | ArrayBufferView,
  options?: Options,
): Promise<Uint8Array> {
  return oxipngSync(image, options);
}

/** Synchronous variant of {@link oxipng}. */
export function oxipngSync(
  image: Uint8Array | ArrayBuffer | ArrayBufferView,
  options?: Options,
): Uint8Array {
  const data = toUint8Array(image);
  const opts = options ?? new Options();
  return optimizeFromMemory(data, opts);
}

function toUint8Array(image: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (image instanceof Uint8Array) return image;
  if (image instanceof ArrayBuffer) return new Uint8Array(image);
  return new Uint8Array(image.buffer, image.byteOffset, image.byteLength);
}
