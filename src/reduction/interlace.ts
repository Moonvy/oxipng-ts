import { type ColorType } from '../colors.ts';
import { ihdrBpp, type IhdrData } from '../headers.ts';
import { PngImage } from '../png/index.ts';
import { expandedBitDepthTo8, reducedBitDepthForced } from './bitDepth.ts';

function cloneColorType(ct: ColorType): ColorType {
  if (ct.kind === 'indexed') return { kind: 'indexed', palette: [...ct.palette] };
  if (ct.kind === 'grayscale') return { kind: 'grayscale', transparentShade: ct.transparentShade };
  if (ct.kind === 'rgb') return { kind: 'rgb', transparentColor: ct.transparentColor ? { ...ct.transparentColor } : null };
  return { kind: ct.kind };
}

/** Enable or disable interlacing, returning the new image if it changed. */
export function changedInterlacing(png: PngImage, interlace: boolean): PngImage | null {
  if (interlace === png.ihdr.interlaced) return null;

  const origDepth = png.ihdr.bitDepth;
  const expanded = expandedBitDepthTo8(png);
  const src = expanded ?? png;
  const data = interlace ? interlaceBytes(src) : deinterlaceBytes(src);

  let next = new PngImage(
    { ...src.ihdr, colorType: cloneColorType(src.ihdr.colorType), interlaced: interlace } as IhdrData,
    data,
  );
  if (next.ihdr.bitDepth !== origDepth) next = reducedBitDepthForced(next, origDepth);
  return next;
}

function interlaceBytes(png: PngImage): Uint8Array {
  const bpp = ihdrBpp(png.ihdr) / 8;
  switch (bpp) {
    case 1:
      return interlaceBytesConst(png, 1);
    case 2:
      return interlaceBytesConst(png, 2);
    case 3:
      return interlaceBytesConst(png, 3);
    case 4:
      return interlaceBytesConst(png, 4);
    case 6:
      return interlaceBytesConst(png, 6);
    case 8:
      return interlaceBytesConst(png, 8);
    default:
      throw new Error('unreachable interlacing bpp');
  }
}

function interlaceBytesConst(png: PngImage, BPP: number): Uint8Array {
  const passes: number[][] = [[], [], [], [], [], [], []];
  let y = 0;
  for (const line of png.scanLines(false)) {
    const data = line.data;
    const nPixels = Math.floor(data.length / BPP);
    for (let x = 0; x < nPixels; x++) {
      const ym = y & 7;
      const xm = x & 7;
      let target: number[];
      if (ym === 0 && xm === 0) target = passes[0];
      else if (ym === 0 && xm === 4) target = passes[1];
      else if (ym === 4 && (xm === 0 || xm === 4)) target = passes[2];
      else if ((ym === 0 || ym === 4) && (xm === 2 || xm === 6)) target = passes[3];
      else if ((ym === 2 || ym === 6) && (x & 1) === 0) target = passes[4];
      else if ((y & 1) === 0) target = passes[5];
      else target = passes[6];
      const base = x * BPP;
      for (let k = 0; k < BPP; k++) target.push(data[base + k]);
    }
    y++;
  }
  let total = 0;
  for (const p of passes) total += p.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const pass of passes) {
    out.set(pass, p);
    p += pass.length;
  }
  return out;
}

function deinterlaceBytes(png: PngImage): Uint8Array {
  const bpp = ihdrBpp(png.ihdr) / 8;
  switch (bpp) {
    case 1:
      return deinterlaceBytesConst(png, 1);
    case 2:
      return deinterlaceBytesConst(png, 2);
    case 3:
      return deinterlaceBytesConst(png, 3);
    case 4:
      return deinterlaceBytesConst(png, 4);
    case 6:
      return deinterlaceBytesConst(png, 6);
    case 8:
      return deinterlaceBytesConst(png, 8);
    default:
      throw new Error('unreachable interlacing bpp');
  }
}

function deinterlaceBytesConst(png: PngImage, BPP: number): Uint8Array {
  const height = png.ihdr.height;
  const width = png.ihdr.width;
  const bytesPerLine = BPP * width;
  const data = new Uint8Array(bytesPerLine * height);
  let currentPass = 1;
  let constants = interlacedConstants(currentPass);
  let currentY = constants.yShift;
  for (const line of png.scanLines(false)) {
    const lineData = line.data;
    const nPixels = Math.floor(lineData.length / BPP);
    for (let i = 0; i < nPixels; i++) {
      const currentX = constants.xShift + i * constants.xStep;
      const index = currentY * bytesPerLine + currentX * BPP;
      const base = i * BPP;
      for (let k = 0; k < BPP; k++) data[index + k] = lineData[base + k];
    }
    currentY += constants.yStep;
    if (currentY >= height) {
      if (currentPass === 7) break;
      currentPass += 1;
      if (currentPass === 2 && width <= 4) currentPass += 1;
      if (currentPass === 3 && height <= 4) currentPass += 1;
      if (currentPass === 4 && width <= 2) currentPass += 1;
      if (currentPass === 5 && height <= 2) currentPass += 1;
      if (currentPass === 6 && width === 1) currentPass += 1;
      if (currentPass === 7 && height === 1) break;
      constants = interlacedConstants(currentPass);
      currentY = constants.yShift;
    }
  }
  return data;
}

interface InterlacedConstants {
  xShift: number;
  yShift: number;
  xStep: number;
  yStep: number;
}

function interlacedConstants(pass: number): InterlacedConstants {
  switch (pass) {
    case 1:
      return { xShift: 0, yShift: 0, xStep: 8, yStep: 8 };
    case 2:
      return { xShift: 4, yShift: 0, xStep: 8, yStep: 8 };
    case 3:
      return { xShift: 0, yShift: 4, xStep: 4, yStep: 8 };
    case 4:
      return { xShift: 2, yShift: 0, xStep: 4, yStep: 4 };
    case 5:
      return { xShift: 0, yShift: 2, xStep: 2, yStep: 4 };
    case 6:
      return { xShift: 1, yShift: 0, xStep: 2, yStep: 2 };
    case 7:
      return { xShift: 0, yShift: 1, xStep: 1, yStep: 2 };
    default:
      throw new Error('unreachable interlacing pass');
  }
}
