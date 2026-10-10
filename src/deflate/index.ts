import { SizeLimitExceeded } from './bitwriter.js';
import { PngError } from '../error.js';
import { deflateRaw as deflateRawImpl, zlibCompress } from './deflate.js';
import { inflateZlib } from './inflate.js';

export interface ZopfliOptions {
  /** Number of iterations to perform. */
  iterationCount: number;
  /** Stop after this many iterations without improvement. */
  iterationsWithoutImprovement: number;
}

/**
 * DEFLATE algorithms supported for the main compression trials.
 *
 * `zopfli` currently maps to the strongest level of the built-in encoder; the
 * option is preserved so the CLI/API surface matches oxipng.
 */
export type Deflater =
  | { kind: 'libdeflater'; compression: number }
  | { kind: 'zopfli'; options: ZopfliOptions };

export function libdeflater(compression: number): Deflater {
  return { kind: 'libdeflater', compression };
}

export function zopfli(options: Partial<ZopfliOptions> = {}): Deflater {
  return {
    kind: 'zopfli',
    options: {
      iterationCount: options.iterationCount ?? 15,
      iterationsWithoutImprovement: options.iterationsWithoutImprovement ?? Number.MAX_SAFE_INTEGER,
    },
  };
}

export function deflaterEquals(a: Deflater, b: Deflater): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'libdeflater') return a.compression === (b as { compression: number }).compression;
  const bo = (b as { options: ZopfliOptions }).options;
  return (
    a.options.iterationCount === bo.iterationCount &&
    a.options.iterationsWithoutImprovement === bo.iterationsWithoutImprovement
  );
}

export function deflaterToString(d: Deflater): string {
  return d.kind === 'libdeflater' ? `zc = ${d.compression}` : `zopfli, zi = ${d.options.iterationCount}`;
}

/** Map a libdeflate-style level (0-12) onto the built-in encoder's levels. */
function mapLevel(compression: number): number {
  return Math.max(0, Math.min(12, Math.round(compression)));
}

/** Compress `data` as a zlib stream, enforcing the optional `maxSize` bound. */
export function deflate(data: Uint8Array, compression: number, maxSize?: number): Uint8Array {
  try {
    return zlibCompress(data, mapLevel(compression), maxSize);
  } catch (err) {
    if (err instanceof SizeLimitExceeded) throw PngError.deflatedDataTooLong(maxSize!);
    throw err;
  }
}

/** Compress `data` as a raw DEFLATE stream (no zlib wrapper). */
export function deflateRaw(data: Uint8Array, compression: number, maxSize?: number): Uint8Array {
  try {
    return deflateRawImpl(data, mapLevel(compression), maxSize);
  } catch (err) {
    if (err instanceof SizeLimitExceeded) throw PngError.deflatedDataTooLong(maxSize!);
    throw err;
  }
}

/** Decompress a zlib stream, treating `outSize` as an upper bound on the output. */
export function inflate(data: Uint8Array, outSize: number): Uint8Array {
  try {
    return inflateZlib(data, outSize);
  } catch (err) {
    if (err instanceof PngError) throw err;
    throw PngError.invalidData();
  }
}

/** Run the configured deflater over `data`, enforcing the optional `maxSize` bound. */
export function deflaterDeflate(deflater: Deflater, data: Uint8Array, maxSize?: number): Uint8Array {
  const compression = deflater.kind === 'libdeflater' ? deflater.compression : 12;
  return deflate(data, compression, maxSize);
}
