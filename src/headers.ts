import {
  BitDepth,
  bitDepthFromNumber,
  channelsPerPixel,
  GRAYSCALE_ALPHA,
  RGBA,
  grayscale,
  indexed,
  rgb,
  rgba8,
  type ColorType,
} from './colors.js';
import { crc32, readBeU16, readBeU32 } from './util/bytes.js';
import { deflaterDeflate, inflate, type Deflater } from './deflate/index.js';
import { PngError } from './error.js';
import type { Options } from './options.js';

/** Chunks that affect image display, kept by `--strip safe`. */
export const DISPLAY_CHUNKS: readonly string[] = ['cICP', 'iCCP', 'sRGB', 'pHYs', 'acTL', 'fcTL', 'fdAT'];

/** Headers from the IHDR chunk of the image. */
export interface IhdrData {
  width: number;
  height: number;
  colorType: ColorType;
  bitDepth: BitDepth;
  interlaced: boolean;
}

/** Bits per pixel. */
export function ihdrBpp(ihdr: IhdrData): number {
  return ihdr.bitDepth * channelsPerPixel(ihdr.colorType);
}

/** Byte length of the IDAT stream that is correct for this IHDR. */
export function rawDataSize(ihdr: IhdrData): number {
  const w = ihdr.width;
  const h = ihdr.height;
  const bpp = ihdrBpp(ihdr);
  const bitmapSize = (b: number, width: number, height: number) =>
    Math.ceil((width * b) / 8) * height;

  if (ihdr.interlaced) {
    let size = bitmapSize(bpp, (w + 7) >> 3, (h + 7) >> 3) + ((h + 7) >> 3);
    if (w > 4) size += bitmapSize(bpp, (w + 3) >> 3, (h + 7) >> 3) + ((h + 7) >> 3);
    size += bitmapSize(bpp, (w + 3) >> 2, (h + 3) >> 3) + ((h + 3) >> 3);
    if (w > 2) size += bitmapSize(bpp, (w + 1) >> 2, (h + 3) >> 2) + ((h + 3) >> 2);
    size += bitmapSize(bpp, (w + 1) >> 1, (h + 1) >> 2) + ((h + 1) >> 2);
    if (w > 1) size += bitmapSize(bpp, w >> 1, (h + 1) >> 1) + ((h + 1) >> 1);
    return size + bitmapSize(bpp, w, h >> 1) + (h >> 1);
  }
  return bitmapSize(bpp, w, h) + h;
}

export interface Chunk {
  name: string;
  data: Uint8Array;
}

/** Chunks that conflict with image data reductions. */
export const REDUCTION_CONFLICTS: readonly string[] = ['bKGD', 'sBIT', 'hIST'];

export type StripChunks =
  | { mode: 'none' }
  | { mode: 'strip'; names: Set<string> }
  | { mode: 'safe' }
  | { mode: 'keep'; names: Set<string> }
  | { mode: 'all' };

export function stripKeep(strip: StripChunks, name: string): boolean {
  switch (strip.mode) {
    case 'none':
      return true;
    case 'keep':
      return strip.names.has(name);
    case 'strip':
      return !strip.names.has(name);
    case 'safe':
      return DISPLAY_CHUNKS.includes(name);
    case 'all':
      return false;
  }
}

export function fileHeaderIsValid(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export interface RawChunk {
  name: string;
  data: Uint8Array;
}

const NAME_DECODER = /* @__PURE__ */ (() => {
  const table = new Array<string>(256);
  for (let i = 0; i < 256; i++) table[i] = String.fromCharCode(i);
  return table;
})();

function chunkName(bytes: Uint8Array, offset: number): string {
  return NAME_DECODER[bytes[offset]] + NAME_DECODER[bytes[offset + 1]] + NAME_DECODER[bytes[offset + 2]] + NAME_DECODER[bytes[offset + 3]];
}

export interface ChunkParseState {
  offset: number;
}

export function parseNextChunk(
  byteData: Uint8Array,
  state: ChunkParseState,
  fixErrors: boolean,
): RawChunk | null {
  const start = state.offset;
  if (start + 4 > byteData.length) throw PngError.truncatedData();
  const length = readBeU32(byteData, start);
  if (byteData.length < start + 12 + length) throw PngError.truncatedData();
  const nameOffset = start + 4;
  const name = chunkName(byteData, nameOffset);
  if (name === 'IEND') {
    state.offset = start + 12 + length;
    return null;
  }
  const dataStart = nameOffset + 4;
  const data = byteData.subarray(dataStart, dataStart + length);
  const crcOffset = dataStart + length;
  const crc = readBeU32(byteData, crcOffset);
  state.offset = crcOffset + 4;

  const chunkBytes = byteData.subarray(nameOffset, crcOffset);
  if (!fixErrors && crc32(chunkBytes) !== crc) {
    throw PngError.crcMismatch(nameBytes(name));
  }
  return { name, data };
}

export function nameBytes(name: string): Uint8Array {
  return new Uint8Array([name.charCodeAt(0), name.charCodeAt(1), name.charCodeAt(2), name.charCodeAt(3)]);
}

export function parseIhdrChunk(
  byteData: Uint8Array,
  paletteData: Uint8Array | undefined,
  trnsData: Uint8Array | undefined,
): IhdrData {
  if (byteData.length < 13) throw PngError.truncatedData();
  const interlaced = byteData[12];
  const colorCode = byteData[9];
  let colorType: ColorType;
  switch (colorCode) {
    case 0:
      colorType = grayscale(trnsData && trnsData.length >= 2 ? readBeU16(trnsData, 0) : null);
      break;
    case 2:
      colorType = rgb(
        trnsData && trnsData.length >= 6
          ? { r: readBeU16(trnsData, 0), g: readBeU16(trnsData, 2), b: readBeU16(trnsData, 4) }
          : null,
      );
      break;
    case 3:
      colorType = indexed(paletteToRgba(paletteData, trnsData) ?? []);
      break;
    case 4:
      colorType = GRAYSCALE_ALPHA;
      break;
    case 6:
      colorType = RGBA;
      break;
    default:
      throw PngError.invalidData();
  }
  return {
    colorType,
    bitDepth: tryBitDepth(byteData[8]),
    width: readBeU32(byteData, 0),
    height: readBeU32(byteData, 4),
    interlaced: interlaced === 0 ? false : interlaced === 1 ? true : raiseInvalid(),
  };
}

function raiseInvalid(): never {
  throw PngError.invalidData();
}

function tryBitDepth(value: number): BitDepth {
  try {
    return bitDepthFromNumber(value);
  } catch {
    throw PngError.invalidData();
  }
}

function paletteToRgba(paletteData: Uint8Array | undefined, trnsData: Uint8Array | undefined): number[] | undefined {
  if (!paletteData) throw PngError.chunkMissing('PLTE');
  const count = Math.floor(paletteData.length / 3);
  const palette = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    palette[i] = rgba8(paletteData[i * 3], paletteData[i * 3 + 1], paletteData[i * 3 + 2], 255);
  }
  if (trnsData) {
    const n = Math.min(palette.length, trnsData.length);
    for (let i = 0; i < n; i++) palette[i] = rgba8(palette[i] >>> 24, (palette[i] >>> 16) & 0xff, (palette[i] >>> 8) & 0xff, trnsData[i]);
  }
  return palette;
}

/** Extract and decompress the ICC profile from an iCCP chunk. */
export function extractIcc(iccp: Chunk, maxSize: number | null | undefined): Uint8Array | null {
  const data = iccp.data;
  let i = 0;
  // Skip the (unused) profile name, terminated by a NUL byte.
  while (i < data.length) {
    const n = data[i++];
    if (n === 0) break;
  }
  if (i >= data.length) return null;
  const compressionMethod = data[i++];
  if (compressionMethod !== 0) return null;
  const compressed = data.subarray(i);
  let outSize = Math.max(compressed.length * 10, 1000);
  outSize = Math.min(outSize, maxSize ?? 1_000_000);
  try {
    return inflate(compressed, outSize);
  } catch {
    return null;
  }
}

/** Build an iCCP chunk by compressing the ICC profile. */
export function makeIccp(icc: Uint8Array, deflater: Deflater, maxSize: number | undefined): Chunk {
  const compressed = deflaterDeflate(deflater, icc, maxSize);
  const data = new Uint8Array(compressed.length + 5);
  data.set([0x69, 0x63, 0x63, 0x00, 0x00], 0); // "icc" + NUL separator + compression method 0
  data.set(compressed, 5);
  return { name: 'iCCP', data };
}

const KNOWN_SRGB_PROFILE_IDS: readonly string[] = [
  '\x29\xf8\x3d\xde\xaf\xf2\x55\xae\x78\x42\xfa\xe4\xca\x83\x39\x0d',
  '\xc9\x5b\xd6\x37\xe9\x5d\x8a\x3b\x0d\xf3\x8f\x99\xc1\x32\x03\x89',
  '\xfc\x66\x33\x78\x37\xe2\x88\x6b\xfd\x72\xe9\x83\x82\x28\xf1\xb8',
  '\x34\x56\x2a\xbf\x99\x4c\xcd\x06\x6d\x2c\x57\x21\xd0\xd6\x8c\x5d',
];

/** If the profile is sRGB, extract the rendering intent value from it. */
export function srgbRenderingIntent(iccData: Uint8Array): number | null {
  if (iccData.length <= 67) return null;
  const renderingIntent = iccData[67];
  const profileId = bytesToString(iccData.subarray(84, 100));
  if (KNOWN_SRGB_PROFILE_IDS.includes(profileId)) return renderingIntent;
  if (profileId === '\x00'.repeat(16)) {
    const crc = crc32(iccData);
    const len = iccData.length;
    if (
      (crc === 0x5d5129ce && len === 3024) ||
      (crc === 0x182ea552 && len === 3144) ||
      (crc === 0xf29e526d && len === 3144)
    ) {
      return renderingIntent;
    }
  }
  return null;
}

function bytesToString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Process aux chunks and potentially adjust options before optimizing. */
export function preprocessChunks(auxChunks: Chunk[], opts: Options, warn: (msg: string) => void): void {
  const hasSrgb = auxChunks.some((c) => c.name === 'sRGB');
  let allowGrayscale = !hasSrgb || opts.strip.mode !== 'none';

  const iccpIdx = auxChunks.findIndex((c) => c.name === 'iCCP');
  if (iccpIdx !== -1) {
    allowGrayscale = false;
    const mayReplaceIccp = opts.strip.mode !== 'none' && stripKeep(opts.strip, 'sRGB');
    if (mayReplaceIccp && hasSrgb) {
      auxChunks.splice(iccpIdx, 1);
      allowGrayscale = true;
    } else {
      const icc = extractIcc(auxChunks[iccpIdx], opts.maxDecompressedSize);
      if (icc) {
        const intent = mayReplaceIccp ? srgbRenderingIntent(icc) : null;
        if (intent !== null) {
          auxChunks[iccpIdx] = { name: 'sRGB', data: new Uint8Array([intent]) };
          allowGrayscale = true;
        } else if (opts.idatRecoding) {
          const curLen = auxChunks[iccpIdx].data.length;
          try {
            const iccp = makeIccp(icc, opts.deflater, curLen - 1);
            auxChunks[iccpIdx] = iccp;
          } catch {
            /* keep original */
          }
        }
      }
    }
  }

  if (!allowGrayscale && opts.grayscaleReduction) {
    opts.grayscaleReduction = false;
  }

  if (auxChunks.some((c) => c.name === 'acTL')) {
    warn('APNG detected, disabling all reductions');
    opts.interlace = null;
    opts.bitDepthReduction = false;
    opts.colorTypeReduction = false;
    opts.paletteReduction = false;
  } else if (opts.strip.mode === 'keep') {
    for (const name of REDUCTION_CONFLICTS) {
      if (opts.strip.names.has(name) && auxChunks.some((c) => c.name === name)) {
        warn(`${name} chunk explicitly kept, disabling all reductions`);
        opts.bitDepthReduction = false;
        opts.colorTypeReduction = false;
        opts.paletteReduction = false;
        break;
      }
    }
  }
}

/** Perform cleanup of certain aux chunks after optimization has been completed. */
export function postprocessChunks(
  auxChunks: Chunk[],
  ihdr: IhdrData,
  origIhdr: IhdrData,
  warn: (msg: string) => void,
): void {
  if (origIhdr.bitDepth !== ihdr.bitDepth || !colorTypeEqualsLoose(origIhdr.colorType, ihdr.colorType)) {
    for (let i = auxChunks.length - 1; i >= 0; i--) {
      if (REDUCTION_CONFLICTS.includes(auxChunks[i].name)) {
        warn(`Removing ${auxChunks[i].name} chunk as it no longer matches the image data`);
        auxChunks.splice(i, 1);
      }
    }
  }
  if (isGrayLoose(origIhdr.colorType) !== isGrayLoose(ihdr.colorType)) {
    for (let i = auxChunks.length - 1; i >= 0; i--) {
      if (auxChunks[i].name === 'sRGB' || auxChunks[i].name === 'iCCP') {
        auxChunks.splice(i, 1);
      }
    }
  }
}

// Local helpers to avoid importing the heavier equality helpers repeatedly.
function colorTypeEqualsLoose(a: ColorType, b: ColorType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'indexed' && b.kind === 'indexed') {
    if (a.palette.length !== b.palette.length) return false;
    for (let i = 0; i < a.palette.length; i++) if (a.palette[i] !== b.palette[i]) return false;
    return true;
  }
  if (a.kind === 'grayscale' && b.kind === 'grayscale') return a.transparentShade === b.transparentShade;
  if (a.kind === 'rgb' && b.kind === 'rgb') {
    const ac = a.transparentColor;
    const bc = b.transparentColor;
    if (ac === null || bc === null) return ac === bc;
    return ac.r === bc.r && ac.g === bc.g && ac.b === bc.b;
  }
  return true;
}

function isGrayLoose(ct: ColorType): boolean {
  return ct.kind === 'grayscale' || ct.kind === 'grayscaleAlpha';
}
