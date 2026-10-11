import { SizeLimitExceeded } from './bitwriter.ts';
import { PngError } from '../error.ts';
import { deflateRaw as deflateRawImpl, deflateRawSize as deflateRawSizeImpl, zlibCompress } from './deflate.ts';
import { inflateZlib } from './inflate.ts';

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
  // fastOptimal limits level-11 parsing and match-interior tree insertion
  // for the default preset's speed budget, protecting low-entropy streams.
  // Explicit compression levels retain their original parsing unless opted in.
  | { kind: 'libdeflater'; compression: number; fastOptimal?: boolean }
  | { kind: 'zopfli'; options: ZopfliOptions };

export function libdeflater(compression: number, fastOptimal = false): Deflater {
  if (fastOptimal) return { kind: 'libdeflater', compression, fastOptimal };
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
  if (a.kind === 'libdeflater' && b.kind === 'libdeflater') return a.compression === b.compression && Boolean(a.fastOptimal) === Boolean(b.fastOptimal);
  if (a.kind !== 'zopfli' || b.kind !== 'zopfli') return false;
  const bo = b.options;
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
export function deflate(data: Uint8Array, compression: number, maxSize?: number, fastOptimal = false): Uint8Array {
  try {
    return zlibCompress(data, mapLevel(compression), maxSize, fastOptimal);
  } catch (err) {
    if (err instanceof SizeLimitExceeded) throw PngError.deflatedDataTooLong(maxSize!);
    throw err;
  }
}

/** Compress `data` as a raw DEFLATE stream (no zlib wrapper). */
export function deflateRaw(data: Uint8Array, compression: number, maxSize?: number, fastOptimal = false): Uint8Array {
  try {
    return deflateRawImpl(data, mapLevel(compression), maxSize, fastOptimal);
  } catch (err) {
    if (err instanceof SizeLimitExceeded) throw PngError.deflatedDataTooLong(maxSize!);
    throw err;
  }
}

/** Internal size-only trial: null means the exact output size exceeds the bound. */
export function deflateRawSize(data: Uint8Array, compression: number, maxSize?: number, fastOptimal = false): number | null {
  try {
    return deflateRawSizeImpl(data, mapLevel(compression), maxSize, fastOptimal);
  } catch (err) {
    if (err instanceof SizeLimitExceeded) return null;
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
  return deflate(data, compression, maxSize, deflater.kind === 'libdeflater' && deflater.fastOptimal);
}

/** Internal exact zlib-size trial, without allocating output or calculating Adler-32. */
export function deflaterDeflateSize(deflater: Deflater, data: Uint8Array, maxSize?: number): number {
  const compression = deflater.kind === 'libdeflater' ? deflater.compression : 12;
  // The byte-aligned zlib header and checksum add six bytes without changing
  // the DEFLATE parser, block choices, or raw stream alignment.
  if (maxSize !== undefined && maxSize < 6) throw PngError.deflatedDataTooLong(maxSize);
  const size = deflateRawSize(data, compression, maxSize === undefined ? undefined : maxSize - 6, deflater.kind === 'libdeflater' && deflater.fastOptimal);
  if (size === null) throw PngError.deflatedDataTooLong(maxSize!);
  return size + 6;
}
