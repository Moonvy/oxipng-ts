import { channelsPerPixel, hasAlpha, colorTypeEquals, colorTypeToString, type BitDepth, type ColorType } from './colors.ts';
import { Deadline } from './deadline.ts';
import { deflaterDeflate, deflaterEquals, libdeflater, type Deflater } from './deflate/index.ts';
import { Evaluator, type Candidate } from './evaluate.ts';
import { PngError } from './error.ts';
import { NONE, Bigrams, type FilterStrategy } from './filters/strategies.ts';
import { makeIccp, postprocessChunks, preprocessChunks, stripKeep, type Chunk, type IhdrData } from './headers.ts';
import { logDebug, logInfo, logTrace, logWarn } from './log.ts';
import { Options } from './options.ts';
import { PngData, PngImage } from './png/index.ts';
import { performReductions } from './reduction/index.ts';
import { filterSetDifference, filterSetFrom } from './util/filterSet.ts';

/** Check if an image was already optimized. */
export function isFullyOptimized(originalSize: number, optimizedSize: number, opts: Options): boolean {
  return originalSize <= optimizedSize && !opts.force;
}

/** Perform optimization on data already loaded in memory. */
export function optimizeFromMemory(data: Uint8Array, opts: Options): Uint8Array {
  logInfo('Processing from memory');
  const deadline = new Deadline(opts.timeout, logWarn);
  const originalSize = data.length;
  const png = PngData.fromSlice(data, opts);
  const optimized = optimizePng(png, data, opts, deadline);
  if (isFullyOptimized(originalSize, optimized.length, opts)) {
    logInfo('Image already optimized');
    return data;
  }
  return optimized;
}

/** Perform optimization on a decoded PNG. */
export function optimizePng(png: PngData, originalData: Uint8Array, optsIn: Options, deadline: Deadline): Uint8Array {
  const fileOriginalSize = originalData.length;
  const idatOriginalSize = png.idatData.length;
  const raw = png.raw;
  logDebug(`    ${raw.ihdr.width}x${raw.ihdr.height} pixels, PNG format`);
  logDebug(`    IDAT size = ${idatOriginalSize} bytes`);
  logDebug(`    File size = ${fileOriginalSize} bytes`);

  const opts = optsIn.clone();
  preprocessChunks(png.auxChunks, opts, logWarn);

  const maxSize = opts.force ? undefined : raw.estimatedOutputSize(png.idatData);
  const result = optimizeRaw(raw, opts, deadline, maxSize);
  if (result) {
    png.raw = result.image;
    png.idatData = result.idatData!;
    recompressFrames(png, opts, deadline, result.filter);
    postprocessChunks(png.auxChunks, png.raw.ihdr, raw.ihdr, logWarn);
  }

  const output = png.output();
  logTrace(`    Optimized file size = ${output.length} bytes`);
  return output;
}

/** Perform optimization on the input image data using the options provided. */
export function optimizeRaw(
  image: PngImage,
  opts: Options,
  deadline: Deadline,
  maxSize: number | undefined,
): Candidate | null {
  const compression =
    opts.deflater.kind === 'libdeflater' && opts.deflater.compression < 11
      ? Math.min(5, opts.deflater.compression)
      : opts.filters.length <= 4
        ? 7
        : 8;
  const evalDeflater = libdeflater(compression);
  const evalFilters = opts.filters.length <= 2 ? opts.filters : filterSetFrom([NONE, Bigrams]);

  const eval_ = new Evaluator(
    deadline,
    evalFilters,
    evalDeflater,
    false,
    false,
    (msg) => logTrace(msg),
  );
  let newImage = performReductions(image, opts, deadline, eval_);
  const evalResult = eval_.getBestCandidate();
  if (evalResult) newImage = evalResult.image;

  // Keep the reduction model and cached scores consistent. Spend less on
  // filter selection for the default preset only when no reduction trials
  // were needed and the 8-bit truecolor input is not already highly compressed.
  const cheapEvaluation = opts.fastEvaluation && evalResult === null &&
    opts.deflater.kind === 'libdeflater' && opts.deflater.compression === 11 &&
    opts.filters.length === 4 && image.ihdr.bitDepth === 8 && !image.ihdr.interlaced &&
    newImage.ihdr.bitDepth === 8 &&
    (newImage.ihdr.colorType.kind === 'rgb' || newImage.ihdr.colorType.kind === 'rgba') &&
    newImage.data.length >= 65536 && maxSize !== undefined && maxSize * 8 >= newImage.data.length;
  const trialDeflater = cheapEvaluation ? libdeflater(2) : evalDeflater;

  const reductionOccurred =
    !colorTypeEquals(newImage.ihdr.colorType, image.ihdr.colorType) ||
    newImage.ihdr.bitDepth !== image.ihdr.bitDepth ||
    newImage.ihdr.interlaced !== image.ihdr.interlaced;

  if (reductionOccurred) {
    logDebug(`Transformed image to ${image.ihdr.bitDepth}-bit ${colorTypeToString(newImage.ihdr.colorType)}`);
  }

  let result: Candidate | null;
  let deflater: Deflater;
  if (opts.idatRecoding || reductionOccurred) {
    result = performTrials(newImage, opts, deadline, maxSize, evalResult, evalFilters, trialDeflater);
    if (result === null) return null;
    deflater = opts.deflater;
  } else {
    result = evalResult;
    if (result === null) return null;
    deflater = evalDeflater;
  }

  if (
    result.idatData !== null &&
    (maxSize === undefined || result.estimatedOutputSize < maxSize)
  ) {
    logDebug('Found better result:');
    logDebug(`    ${deflaterLabel(deflater)}, f = ${result.filter}`);
    return result;
  }
  return null;
}

function deflaterLabel(d: Deflater): string {
  return d.kind === 'libdeflater' ? `zc = ${d.compression}` : `zopfli, zi = ${d.options.iterationCount}`;
}

/** Perform compression trials to select the best filter. */
export function performTrials(
  image: PngImage,
  opts: Options,
  deadline: Deadline,
  maxSize: number | undefined,
  evalResultIn: Candidate | null,
  evalFilters: FilterStrategy[],
  evalDeflater: Deflater,
): Candidate | null {
  let evalResult = evalResultIn;
  let filters = opts.filters;
  const fastEval = opts.fastEvaluation && (filters.length > 1 || evalResult !== null);

  if (fastEval) {
    if (evalResult !== null) {
      filters = filterSetDifference(filters, evalFilters);
    }
    if (filters.length > 0) {
      logTrace(`Evaluating ${filters.length} filters`);
      const eval_ = new Evaluator(
        deadline,
        filters,
        evalDeflater,
        opts.optimizeAlpha,
        deflaterEquals(opts.deflater, evalDeflater),
        (msg) => logTrace(msg),
      );
      if (evalResult) eval_.setBestSize(evalResult.estimatedOutputSize);
      eval_.tryImage(image);
      const r = eval_.getBestCandidate();
      if (r) evalResult = r;
    }

    const result = evalResult;
    if (result === null) return null;

    if (result.idatData === null) {
      logDebug(`Trying filter ${result.filter} with ${deflaterLabel(opts.deflater)}`);
      const canReuse = result.filteredData !== undefined &&
        (result.filteredOptimizeAlpha === opts.optimizeAlpha || !hasAlpha(result.image.ihdr.colorType));
      const data = canReuse ? result.filteredData! : result.image.filterImage(result.filterUsed, opts.optimizeAlpha)[0];
      result.filteredData = undefined;
      try {
        const idatData = deflaterDeflate(opts.deflater, data, maxSize === undefined ? undefined : maxSize - result.image.keyChunksSize());
        result.estimatedOutputSize = result.image.estimatedOutputSize(idatData);
        result.idatData = idatData;
      } catch (err) {
        if (err instanceof PngError && err.kind === 'DeflatedDataTooLong') {
          logTrace(`>${err.size} bytes`);
        }
      }
    }
    return result;
  }

  logDebug(`Trying ${filters.length} filters with ${deflaterLabel(opts.deflater)}`);
  const eval_ = new Evaluator(deadline, filters, opts.deflater, opts.optimizeAlpha, true, (msg) => logTrace(msg));
  if (maxSize !== undefined) eval_.setBestSize(maxSize);
  eval_.tryImage(image);
  return eval_.getBestCandidate();
}

/** Recompress the additional frames of an APNG. */
export function recompressFrames(png: PngData, opts: Options, deadline: Deadline, filter: FilterStrategy): void {
  if (!opts.idatRecoding || png.frames.length === 0) return;
  for (let i = 0; i < png.frames.length; i++) {
    if (deadline.passed()) return;
    const frame = png.frames[i];
    const ihdr: IhdrData = { ...png.raw.ihdr, width: frame.width, height: frame.height };
    const image = PngImage.new(ihdr, frame.data);
    const [filtered] = image.filterImage(filter, opts.optimizeAlpha);
    const maxSize = frame.data.length - 1;
    try {
      const data = deflaterDeflate(opts.deflater, filtered, maxSize);
      logDebug(`Recompressed fdAT #${i}: ${data.length} (${frame.data.length - data.length} bytes decrease)`);
      frame.data = data;
    } catch {
      /* keep original frame data */
    }
  }
}

/** A raw image definition which can be used to create an optimized PNG. */
export class RawImage {
  private png: PngImage;
  private auxChunks: Chunk[];

  constructor(width: number, height: number, colorType: ColorType, bitDepth: BitDepth, data: Uint8Array) {
    const validDepth =
      colorType.kind === 'grayscale'
        ? true
        : colorType.kind === 'indexed'
          ? bitDepth <= 8
          : bitDepth >= 8;
    if (!validDepth) throw PngError.invalidDepthForType(bitDepth, colorType);

    const bpp = bitDepth * channelsPerPixel(colorType);
    const rowBytes = Math.ceil((bpp * width) / 8);
    const expectedLen = rowBytes * height;
    if (data.length !== expectedLen) throw PngError.incorrectDataLength(data.length, expectedLen);

    this.png = new PngImage({ width, height, colorType, bitDepth, interlaced: false }, data);
    this.auxChunks = [];
  }

  /** Add a PNG chunk, such as "iTXt", to be included in the output. */
  addPngChunk(name: string, data: Uint8Array): void {
    this.auxChunks.push({ name, data });
  }

  /** Add an ICC profile for the image. */
  addIccProfile(data: Uint8Array): void {
    try {
      const iccp = makeIccp(data, libdeflater(1), undefined);
      this.auxChunks.push(iccp);
    } catch {
      /* ignore */
    }
  }

  /** Create an optimized PNG from the raw image data. */
  createOptimizedPng(optsIn: Options): Uint8Array {
    const opts = optsIn.clone();
    const auxChunks = this.auxChunks.filter((c) => stripKeep(opts.strip, c.name)).map((c) => ({ name: c.name, data: c.data }));
    preprocessChunks(auxChunks, opts, logWarn);

    const deadline = new Deadline(opts.timeout, logWarn);
    const result = optimizeRaw(this.png, opts, deadline, undefined);
    if (!result) throw PngError.other('Failed to optimize input data');

    const png = new PngData(result.image, result.idatData!, auxChunks, []);
    postprocessChunks(png.auxChunks, png.raw.ihdr, this.png.ihdr, logWarn);
    return png.output();
  }
}
