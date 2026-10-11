import { BitDepth, type ColorType } from '../colors.ts';
import { type IhdrData } from '../headers.ts';
import { PngImage } from '../png/index.ts';
import { ByteBuffer } from '../util/byteBuffer.ts';

function rotl8(value: number, bits: number): number {
  return ((value << bits) | (value >>> (8 - bits))) & 0xff;
}

/** Attempt to reduce a 16-bit image to 8-bit, returning the reduced image if successful. */
export function reducedBitDepth16To8(png: PngImage, forceScale: boolean): PngImage | null {
  if (png.ihdr.bitDepth !== BitDepth.Sixteen) return null;
  if (forceScale) return scaledBitDepth16To8(png);

  const data = png.data;
  for (let i = 0; i + 1 < data.length; i += 2) {
    if (data[i] !== data[i + 1]) return null;
  }
  const reduced = new Uint8Array(data.length >> 1);
  for (let i = 0; i < reduced.length; i++) reduced[i] = data[i * 2];
  return new PngImage(
    { ...png.ihdr, colorType: cloneColorType(png.ihdr.colorType), bitDepth: BitDepth.Eight } as IhdrData,
    reduced,
  );
}

/** Forcibly reduce a 16-bit image to 8-bit by scaling. */
export function scaledBitDepth16To8(png: PngImage): PngImage | null {
  if (png.ihdr.bitDepth !== BitDepth.Sixteen) return null;
  const data = png.data;
  const reduced = new Uint8Array(data.length >> 1);
  for (let i = 0; i < reduced.length; i++) {
    const hi = data[i * 2];
    const lo = data[i * 2 + 1];
    if (hi === lo) {
      reduced[i] = hi;
    } else {
      const value = (hi << 8) | lo;
      reduced[i] = Math.round(value * (255 / 65535));
    }
  }
  return new PngImage(
    { ...png.ihdr, colorType: cloneColorType(png.ihdr.colorType), bitDepth: BitDepth.Eight } as IhdrData,
    reduced,
  );
}

/** Attempt to reduce an 8-bit single-channel image to a lower bit depth. */
export function reducedBitDepth8OrLess(png: PngImage): PngImage | null {
  if (png.ihdr.bitDepth !== BitDepth.Eight || png.channelsPerPixel() !== 1) return null;

  const ct = png.ihdr.colorType;
  let bitDepth: BitDepth;
  if (ct.kind === 'indexed') {
    const n = ct.palette.length;
    if (n <= 2) bitDepth = BitDepth.One;
    else if (n <= 4) bitDepth = BitDepth.Two;
    else if (n <= 16) bitDepth = BitDepth.Four;
    else return null;
  } else {
    let minimumBits = 1;
    let mask = 1;
    let divCount = 7;
    for (let i = 0; i < png.data.length; i++) {
      const b = png.data[i];
      if (b === 0 || b === 255) continue;
      // Find the smallest depth whose repeated bit-divisions are all identical.
      tryDepth: for (;;) {
        let byte = rotl8(b, minimumBits);
        const compare = byte & mask;
        for (let d = 0; d < divCount; d++) {
          byte = rotl8(byte, minimumBits);
          if ((byte & mask) !== compare) {
            minimumBits <<= 1;
            if (minimumBits === 8) return null;
            mask = (1 << minimumBits) - 1;
            divCount = 8 / minimumBits - 1;
            continue tryDepth;
          }
        }
        break;
      }
    }
    bitDepth = minimumBits as BitDepth;
  }
  return reducedBitDepthForced(png, bitDepth);
}

/** Reduce bit depth from 8 to a lower depth known to be compatible. */
export function reducedBitDepthForced(png: PngImage, bitDepth: BitDepth): PngImage {
  const numBits = bitDepth;
  const mask = (1 << numBits) - 1;
  const perByte = 8 / numBits;
  const reduced = new ByteBuffer(Math.ceil(png.data.length / perByte) + 1);
  for (const line of png.scanLines(false)) {
    const data = line.data;
    for (let i = 0; i < data.length; i += perByte) {
      let newByte = 0;
      let shift = 8;
      const end = Math.min(i + perByte, data.length);
      for (let j = i; j < end; j++) {
        shift -= numBits;
        newByte |= (data[j] & mask) << shift;
      }
      reduced.push(newByte);
    }
  }

  let colorType = cloneColorType(png.ihdr.colorType);
  if (colorType.kind === 'grayscale' && colorType.transparentShade !== null) {
    const trans = colorType.transparentShade;
    const reducedTrans = (trans & 0xff) >> (8 - numBits);
    let check = reducedTrans;
    let bits = numBits;
    while (bits < 8) {
      check = (check << bits) | check;
      bits <<= 1;
    }
    colorType = { kind: 'grayscale', transparentShade: trans === check ? reducedTrans : null };
  }

  return new PngImage(
    { ...png.ihdr, colorType, bitDepth } as IhdrData,
    reduced.toUint8Array(),
  );
}

/** Expand a 1/2/4-bit image to 8-bit, returning the expanded image if successful. */
export function expandedBitDepthTo8(png: PngImage): PngImage | null {
  const bitDepth = png.ihdr.bitDepth;
  if (bitDepth >= 8) return null;
  const ppb = 8 / bitDepth;
  const isGray = png.ihdr.colorType.kind === 'grayscale';
  const mask = (1 << bitDepth) - 1;

  const reduced = new ByteBuffer(png.ihdr.width * png.ihdr.height + 1);
  let length = 0;
  for (const line of png.scanLines(false)) {
    for (let bi = 0; bi < line.data.length; bi++) {
      let byte = line.data[bi];
      for (let k = 0; k < ppb; k++) {
        byte = rotl8(byte, bitDepth);
        let val = byte & mask;
        if (isGray) {
          let bits = bitDepth;
          while (bits < 8) {
            val = (val << bits) | val;
            bits <<= 1;
          }
        }
        reduced.push(val);
      }
    }
    length += line.numPixels;
    reduced.truncate(length);
  }

  let colorType = cloneColorType(png.ihdr.colorType);
  if (colorType.kind === 'grayscale' && colorType.transparentShade !== null) {
    let trans = colorType.transparentShade;
    let bits = bitDepth;
    while (bits < 8) {
      trans = (trans << bits) | trans;
      bits <<= 1;
    }
    colorType = { kind: 'grayscale', transparentShade: trans };
  }

  return new PngImage(
    { ...png.ihdr, colorType, bitDepth: BitDepth.Eight } as IhdrData,
    reduced.toUint8Array(),
  );
}

function cloneColorType(ct: ColorType): ColorType {
  if (ct.kind === 'indexed') return { kind: 'indexed', palette: [...ct.palette] };
  if (ct.kind === 'grayscale') return { kind: 'grayscale', transparentShade: ct.transparentShade };
  if (ct.kind === 'rgb') {
    return {
      kind: 'rgb',
      transparentColor: ct.transparentColor ? { ...ct.transparentColor } : null,
    };
  }
  return { kind: ct.kind };
}
