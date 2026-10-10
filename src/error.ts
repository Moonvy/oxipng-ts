import type { BitDepth, ColorType } from './colors.js';

export type PngErrorKind =
  | 'APNGOutOfOrder'
  | 'C2PAMetadataPreventsChanges'
  | 'ChunkMissing'
  | 'ChunkPreventsChanges'
  | 'CRCMismatch'
  | 'DeflatedDataTooLong'
  | 'IncorrectDataLength'
  | 'InflatedDataTooLong'
  | 'InvalidData'
  | 'InvalidDepthForType'
  | 'NotPNG'
  | 'ReadFailed'
  | 'TruncatedData'
  | 'WriteFailed'
  | 'Other';

function chunkNameToString(name: Uint8Array | number[]): string {
  return String.fromCharCode(...name);
}

/**
 * Error type mirroring oxipng's `PngError`, carrying a machine-readable `kind`
 * alongside the human readable message.
 */
export class PngError extends Error {
  readonly kind: PngErrorKind;
  /** Numeric payload for `DeflatedDataTooLong` / `InflatedDataTooLong` etc. */
  readonly size?: number;
  /** The offending chunk name, for chunk related errors. */
  readonly chunk?: Uint8Array;

  private constructor(kind: PngErrorKind, message: string, extra?: { size?: number; chunk?: Uint8Array }) {
    super(message);
    this.name = 'PngError';
    this.kind = kind;
    if (extra?.size !== undefined) this.size = extra.size;
    if (extra?.chunk !== undefined) this.chunk = extra.chunk;
  }

  static apngOutOfOrder(): PngError {
    return new PngError('APNGOutOfOrder', 'APNG chunks are out of order');
  }
  static c2paMetadataPreventsChanges(): PngError {
    return new PngError(
      'C2PAMetadataPreventsChanges',
      'The image contains C2PA manifest that would be invalidated by any file changes',
    );
  }
  static chunkMissing(name: string): PngError {
    return new PngError('ChunkMissing', `Chunk ${name} missing or empty`);
  }
  static chunkPreventsChanges(name: Uint8Array): PngError {
    return new PngError(
      'ChunkPreventsChanges',
      `The image contains a ${chunkNameToString(name)} chunk that would be invalidated by any file changes`,
      { chunk: name },
    );
  }
  static crcMismatch(name: Uint8Array): PngError {
    return new PngError(
      'CRCMismatch',
      `CRC mismatch in ${chunkNameToString(name)} chunk; May be recoverable by using --fix`,
      { chunk: name },
    );
  }
  static deflatedDataTooLong(size: number): PngError {
    return new PngError('DeflatedDataTooLong', 'Deflated data too long', { size });
  }
  static incorrectDataLength(actual: number, expected: number): PngError {
    return new PngError(
      'IncorrectDataLength',
      `Data length ${actual} does not match the expected length ${expected}`,
      { size: expected },
    );
  }
  static inflatedDataTooLong(max: number): PngError {
    return new PngError('InflatedDataTooLong', `Inflated data would exceed the maximum size (${max} bytes)`, {
      size: max,
    });
  }
  static invalidData(): PngError {
    return new PngError('InvalidData', 'Invalid data found; unable to read PNG file');
  }
  static invalidDepthForType(depth: BitDepth, colorType: ColorType): PngError {
    return new PngError('InvalidDepthForType', `Invalid bit depth ${depth} for color type ${colorType}`);
  }
  static notPNG(): PngError {
    return new PngError('NotPNG', 'Invalid header detected; Not a PNG file');
  }
  static readFailed(source: string, cause: unknown): PngError {
    return new PngError('ReadFailed', `Failed to read from ${source}: ${cause}`);
  }
  static truncatedData(): PngError {
    return new PngError('TruncatedData', 'Missing data in the file; the file is truncated');
  }
  static writeFailed(target: string, cause: unknown): PngError {
    return new PngError('WriteFailed', `Failed to write to ${target}: ${cause}`);
  }
  static other(message: string): PngError {
    return new PngError('Other', message);
  }
}

export type OptimizationResult = [inputSize: number, outputSize: number];
