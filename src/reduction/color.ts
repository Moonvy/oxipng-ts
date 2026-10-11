import {
  BitDepth,
  channelsPerPixel,
  isGray,
  isRgb,
  indexed as indexedCt,
  rgba8,
  rgba8A,
  rgba8B,
  rgba8G,
  rgba8R,
  type ColorType,
} from '../colors.js';
import { PngImage } from '../png/index.js';
import { ByteBuffer } from '../util/byteBuffer.js';
import { NumberIndexSet } from '../util/numberSet.js';

/** Maximum size difference between indexed and channels to consider evaluating. */
export const INDEXED_MAX_DIFF = 20000;

const BLACK = rgba8(0, 0, 0, 255);

/** Attempt to convert an image to indexed, returning the result if successful. */
export function reducedToIndexed(png: PngImage, allowGrayscale: boolean): PngImage | null {
  if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
  const ct = png.ihdr.colorType;
  if (ct.kind === 'indexed') return null;
  if (!allowGrayscale && isGray(ct)) return null;

  const data = png.data;
  const channels = channelsPerPixel(ct);
  const nPixels = Math.floor(data.length / channels);
  const indices = new Uint8Array(nPixels);
  const set = new NumberIndexSet();

  for (let i = 0; i < nPixels; i++) {
    let key: number;
    switch (ct.kind) {
      case 'grayscale':
        key = data[i];
        break;
      case 'rgb':
        key = (data[i * 3] << 16) | (data[i * 3 + 1] << 8) | data[i * 3 + 2];
        break;
      case 'grayscaleAlpha':
        key = (data[i * 2] << 8) | data[i * 2 + 1];
        break;
      case 'rgba':
        key = (((data[i * 4] << 24) | (data[i * 4 + 1] << 16) | (data[i * 4 + 2] << 8) | data[i * 4 + 3]) >>> 0);
        break;
      default:
        return null;
    }
    const [idx] = set.insertFull(key);
    if (idx === 256) return null;
    indices[i] = idx;
  }

  const keys = set.toArray();
  const palette = keys.map((key) => decodePixel(key, ct));

  return new PngImage({ ...png.ihdr, colorType: indexedCt(palette) }, indices);
}

function decodePixel(key: number, ct: ColorType): number {
  switch (ct.kind) {
    case 'grayscale': {
      const transparency = ct.transparentShade === null ? -1 : ct.transparentShade & 0xff;
      return rgba8(key, key, key, key === transparency ? 0 : 255);
    }
    case 'rgb': {
      const trns = ct.transparentColor;
      const transparency =
        trns === null ? -1 : ((trns.r & 0xff) << 16) | ((trns.g & 0xff) << 8) | (trns.b & 0xff);
      return rgba8((key >>> 16) & 0xff, (key >>> 8) & 0xff, key & 0xff, key === transparency ? 0 : 255);
    }
    case 'grayscaleAlpha':
      return rgba8((key >>> 8) & 0xff, (key >>> 8) & 0xff, (key >>> 8) & 0xff, key & 0xff);
    case 'rgba':
      return key >>> 0;
    default:
      return BLACK;
  }
}

/** Attempt to reduce RGB(A) to grayscale (with or without alpha). */
export function reducedRgbToGrayscale(png: PngImage): PngImage | null {
  const ct = png.ihdr.colorType;
  if (!isRgb(ct)) return null;

  const byteDepth = png.bytesPerChannel();
  const bpp = png.channelsPerPixel() * byteDepth;
  const lastColor = 2 * byteDepth;
  const data = png.data;
  const reduced = new ByteBuffer(data.length);

  for (let i = 0; i < data.length; i += bpp) {
    if (byteDepth === 1) {
      if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) return null;
    } else if (
      data[i] !== data[i + 2] ||
      data[i + 1] !== data[i + 3] ||
      data[i + 2] !== data[i + 4] ||
      data[i + 3] !== data[i + 5]
    ) {
      return null;
    }
    reduced.extend(data.subarray(i + lastColor, i + bpp));
  }

  let colorType: ColorType;
  if (ct.kind === 'rgb') {
    const trns = ct.transparentColor;
    const shade = trns && trns.r === trns.g && trns.g === trns.b ? trns.r : null;
    colorType = { kind: 'grayscale', transparentShade: shade };
  } else {
    colorType = { kind: 'grayscaleAlpha' };
  }

  return new PngImage({ ...png.ihdr, colorType }, reduced.toUint8Array());
}

/** Attempt to convert indexed to a different colour type. */
export function indexedToChannels(
  png: PngImage,
  allowGrayscale: boolean,
  optimizeAlpha: boolean,
): PngImage | null {
  if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
  if (png.ihdr.colorType.kind !== 'indexed') return null;
  const palette = [...png.ihdr.colorType.palette];

  if (optimizeAlpha) {
    for (let i = 0; i < palette.length; i++) {
      if (rgba8A(palette[i]) === 0) palette[i] = rgba8(0, 0, 0, 0);
    }
  }

  const isGrayPalette = allowGrayscale && palette.every((c) => rgba8R(c) === rgba8G(c) && rgba8G(c) === rgba8B(c));
  const hasAlphaPalette = palette.some((c) => rgba8A(c) !== 255);
  let colorType: ColorType;
  if (!isGrayPalette && hasAlphaPalette) colorType = { kind: 'rgba' };
  else if (!isGrayPalette && !hasAlphaPalette) colorType = { kind: 'rgb', transparentColor: null };
  else if (isGrayPalette && hasAlphaPalette) colorType = { kind: 'grayscaleAlpha' };
  else colorType = { kind: 'grayscale', transparentShade: null };

  const outSize = channelsPerPixel(colorType) * png.data.length;
  if (outSize - png.data.length > INDEXED_MAX_DIFF) return null;

  const chStart = isGrayPalette ? 2 : 0;
  const chEnd = hasAlphaPalette ? 3 : 2;
  const data = new ByteBuffer(outSize);
  for (let i = 0; i < png.data.length; i++) {
    const color = palette[png.data[i]] ?? BLACK;
    const r = rgba8R(color);
    const g = rgba8G(color);
    const b = rgba8B(color);
    const a = rgba8A(color);
    const channels = [r, g, b, a];
    for (let c = chStart; c <= chEnd; c++) data.push(channels[c]);
  }

  return new PngImage({ ...png.ihdr, colorType }, data.toUint8Array());
}
