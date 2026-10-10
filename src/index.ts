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
} from './colors.js';

export { PngError, type OptimizationResult, type PngErrorKind } from './error.js';

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
} from './deflate/index.js';

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
} from './headers.js';

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
} from './filters/index.js';

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
} from './filters/strategies.js';

export { Frame } from './apng.js';
export { PngData, PngImage, writePngBlock } from './png/index.js';
export { ScanLines, ScanLineRanges, type ScanLine } from './png/scanLines.js';
export { Options } from './options.js';
export { Deadline, now, AtomicMin } from './deadline.js';
export { Evaluator, type Candidate } from './evaluate.js';
export { isFullyOptimized, optimizeFromMemory, optimizePng, optimizeRaw, performTrials, RawImage, recompressFrames } from './optimize.js';
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
} from './log.js';

// Reduction internals (exported for parity with oxipng's `internal_tests`).
export { cleanedAlphaChannel, reducedAlphaChannel } from './reduction/alpha.js';
export {
  expandedBitDepthTo8,
  reducedBitDepth16To8,
  reducedBitDepth8OrLess,
  reducedBitDepthForced,
  scaledBitDepth16To8,
} from './reduction/bitDepth.js';
export { INDEXED_MAX_DIFF, indexedToChannels, reducedRgbToGrayscale, reducedToIndexed } from './reduction/color.js';
export { changedInterlacing } from './reduction/interlace.js';
export {
  CoOccurrenceMatrix,
  reducedPalette,
  sortedPalette,
  sortedPaletteBattiato,
  sortedPaletteEzeng,
} from './reduction/palette.js';
export { performReductions } from './reduction/index.js';

import { Options } from './options.js';
import { optimizeFromMemory } from './optimize.js';


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
