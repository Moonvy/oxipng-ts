import { BitDepth, hasAlpha, type ColorType } from '../colors.ts';
import { type IhdrData } from '../headers.ts';
import { PngImage } from '../png/index.ts';
import { ByteBuffer } from '../util/byteBuffer.ts';

function cloneIhdr(ihdr: IhdrData): IhdrData {
  return { ...ihdr };
}

/** Set the colour of all fully transparent pixels to black. */
export function cleanedAlphaChannel(png: PngImage): PngImage | null {
  if (!hasAlpha(png.ihdr.colorType)) return null;
  const byteDepth = png.bytesPerChannel();
  const bpp = png.channelsPerPixel() * byteDepth;
  const coloredBytes = bpp - byteDepth;

  const data = png.data;
  const reduced = new ByteBuffer(data.length);
  for (let i = 0; i < data.length; i += bpp) {
    let transparent = true;
    for (let j = i + coloredBytes; j < i + bpp; j++) {
      if (data[j] !== 0) {
        transparent = false;
        break;
      }
    }
    if (transparent) reduced.extendZeros(bpp);
    else reduced.extend(data.subarray(i, i + bpp));
  }
  return new PngImage(cloneIhdr(png.ihdr), reduced.toUint8Array());
}

/** Attempt to remove the alpha channel, adding a transparency pixel if necessary. */
export function reducedAlphaChannel(png: PngImage, optimizeAlpha: boolean): PngImage | null {
  const ct = png.ihdr.colorType;
  const bd = png.ihdr.bitDepth;
  if (ct.kind === 'grayscaleAlpha' && bd === BitDepth.Eight) return reducedAlphaChannelConst(png, optimizeAlpha, 2, 1);
  if (ct.kind === 'grayscaleAlpha' && bd === BitDepth.Sixteen) return reducedAlphaChannelConst(png, optimizeAlpha, 4, 2);
  if (ct.kind === 'rgba' && bd === BitDepth.Eight) return reducedAlphaChannelConst(png, optimizeAlpha, 4, 3);
  if (ct.kind === 'rgba' && bd === BitDepth.Sixteen) return reducedAlphaChannelConst(png, optimizeAlpha, 8, 6);
  return null;
}

function reducedAlphaChannelConst(
  png: PngImage,
  optimizeAlpha: boolean,
  bpp: number,
  coloredBytes: number,
): PngImage | null {
  const data = png.data;
  const nPixels = Math.floor(data.length / bpp);
  let hasTransparency = false;
  const usedColors = new Uint8Array(256);

  for (let p = 0; p < nPixels; p++) {
    const base = p * bpp;
    let allAlphaZero = true;
    let anyAlphaNot255 = false;
    for (let j = coloredBytes; j < bpp; j++) {
      const a = data[base + j];
      if (a !== 0) allAlphaZero = false;
      if (a !== 255) anyAlphaNot255 = true;
    }
    if (optimizeAlpha && allAlphaZero) {
      hasTransparency = true;
    } else if (anyAlphaNot255) {
      return null;
    } else if (optimizeAlpha) {
      let allSame = true;
      for (let j = 1; j < coloredBytes; j++) {
        if (data[base + j] !== data[base]) {
          allSame = false;
          break;
        }
      }
      if (allSame) usedColors[data[base]] = 1;
    }
  }

  let transparencyPixel: number | null = null;
  if (hasTransparency) {
    if (png.ihdr.colorType.kind === 'grayscaleAlpha') {
      for (const v of [0x00, 0xff, 0x55, 0xaa]) {
        if (!usedColors[v]) {
          transparencyPixel = v;
          break;
        }
      }
    }
    if (transparencyPixel === null) {
      let found = -1;
      for (let v = 0; v < 256; v++) {
        if (!usedColors[v]) {
          found = v;
          break;
        }
      }
      if (found === -1) return null;
      transparencyPixel = found;
    }
  }

  const rawData = new ByteBuffer(png.data.length);
  for (let p = 0; p < nPixels; p++) {
    const base = p * bpp;
    let allAlphaZero = true;
    for (let j = coloredBytes; j < bpp; j++) {
      if (data[base + j] !== 0) {
        allAlphaZero = false;
        break;
      }
    }
    if (transparencyPixel !== null && allAlphaZero) {
      rawData.extendFill(transparencyPixel, coloredBytes);
    } else {
      rawData.extend(data.subarray(base, base + coloredBytes));
    }
  }

  const transparent =
    transparencyPixel === null
      ? null
      : png.ihdr.bitDepth === BitDepth.Sixteen
        ? (transparencyPixel << 8) | transparencyPixel
        : transparencyPixel;

  let colorType: ColorType;
  if (png.ihdr.colorType.kind === 'grayscaleAlpha') {
    colorType = { kind: 'grayscale', transparentShade: transparent };
  } else {
    colorType = {
      kind: 'rgb',
      transparentColor: transparent === null ? null : { r: transparent, g: transparent, b: transparent },
    };
  }

  return new PngImage({ ...cloneIhdr(png.ihdr), colorType }, rawData.toUint8Array());
}
