import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

import { LogLevel, Options, PngData, pngHeaderCode, setLogLevel } from '../src/index.js';

export const FILES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'files');

// Keep the test output clean; individual tests can raise the level if needed.
setLogLevel(LogLevel.Off);

export const COLOR = {
  GRAYSCALE: 0,
  RGB: 2,
  INDEXED: 3,
  GRAYSCALE_ALPHA: 4,
  RGBA: 6,
} as const;

export function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FILES_DIR, name)));
}

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Decode a PNG using the independent `pngjs` implementation. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const png = PNG.sync.read(Buffer.from(bytes));
  return {
    width: png.width,
    height: png.height,
    rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length),
  };
}

export interface HeaderInfo {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  interlaced: boolean;
}

/** Read the IHDR fields using the library's own decoder. */
export function headerInfo(bytes: Uint8Array, opts?: Options): HeaderInfo {
  const o = opts?.clone() ?? new Options();
  o.fixErrors = true;
  const png = PngData.fromSlice(bytes, o);
  return {
    width: png.raw.ihdr.width,
    height: png.raw.ihdr.height,
    colorType: pngHeaderCode(png.raw.ihdr.colorType),
    bitDepth: png.raw.ihdr.bitDepth,
    interlaced: png.raw.ihdr.interlaced,
  };
}

export function auxChunkNames(bytes: Uint8Array, opts?: Options): string[] {
  const o = opts?.clone() ?? new Options();
  o.fixErrors = true;
  const png = PngData.fromSlice(bytes, o);
  return png.auxChunks.map((c) => c.name);
}

export function countChunk(bytes: Uint8Array, name: string): number {
  return auxChunkNames(bytes).filter((n) => n === name).length;
}

/** Assert two RGBA buffers are byte-for-byte identical. */
export function assertRgbaEqual(a: Uint8Array, b: Uint8Array, message?: string): void {
  if (a.length !== b.length) throw new Error(`${message ?? 'RGBA'} length mismatch: ${a.length} !== ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`${message ?? 'RGBA'} mismatch at byte ${i} (pixel ${(i / 4) | 0}, channel ${i % 4}): ${a[i]} !== ${b[i]}`);
    }
  }
}
