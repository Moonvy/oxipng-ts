/** A 16-bit-per-channel RGB colour, used for the `tRNS` chunk of truecolor images. */
export interface RGB16 {
  r: number;
  g: number;
  b: number;
}

/**
 * An 8-bit-per-channel RGBA colour stored as a packed big-endian integer
 * (`0xRRGGBBAA`). Packing keeps palettes cheap to hash and compare.
 */
export type RGBA8 = number;

export function rgba8(r: number, g: number, b: number, a: number): RGBA8 {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}
export function rgba8R(c: RGBA8): number {
  return (c >>> 24) & 0xff;
}
export function rgba8G(c: RGBA8): number {
  return (c >>> 16) & 0xff;
}
export function rgba8B(c: RGBA8): number {
  return (c >>> 8) & 0xff;
}
export function rgba8A(c: RGBA8): number {
  return c & 0xff;
}

export type GrayscaleColorType = { kind: 'grayscale'; transparentShade: number | null };
export type RGBColorType = { kind: 'rgb'; transparentColor: RGB16 | null };
export type IndexedColorType = { kind: 'indexed'; palette: RGBA8[] };
export type GrayscaleAlphaColorType = { kind: 'grayscaleAlpha' };
export type RGBAColorType = { kind: 'rgba' };

/** The colour type used to represent an image. */
export type ColorType =
  | GrayscaleColorType
  | RGBColorType
  | IndexedColorType
  | GrayscaleAlphaColorType
  | RGBAColorType;

export function grayscale(transparentShade: number | null = null): GrayscaleColorType {
  return { kind: 'grayscale', transparentShade };
}
export function rgb(transparentColor: RGB16 | null = null): RGBColorType {
  return { kind: 'rgb', transparentColor };
}
export function indexed(palette: RGBA8[]): IndexedColorType {
  return { kind: 'indexed', palette };
}
export const GRAYSCALE_ALPHA: GrayscaleAlphaColorType = { kind: 'grayscaleAlpha' };
export const RGBA: RGBAColorType = { kind: 'rgba' };

/** The colour type code used by the PNG specification. */
export function pngHeaderCode(ct: ColorType): 0 | 2 | 3 | 4 | 6 {
  switch (ct.kind) {
    case 'grayscale':
      return 0;
    case 'rgb':
      return 2;
    case 'indexed':
      return 3;
    case 'grayscaleAlpha':
      return 4;
    case 'rgba':
      return 6;
  }
}

export function channelsPerPixel(ct: ColorType): number {
  switch (ct.kind) {
    case 'grayscale':
    case 'indexed':
      return 1;
    case 'grayscaleAlpha':
      return 2;
    case 'rgb':
      return 3;
    case 'rgba':
      return 4;
  }
}

export function isRgb(ct: ColorType): boolean {
  return ct.kind === 'rgb' || ct.kind === 'rgba';
}
export function isGray(ct: ColorType): boolean {
  return ct.kind === 'grayscale' || ct.kind === 'grayscaleAlpha';
}
export function hasAlpha(ct: ColorType): boolean {
  return ct.kind === 'grayscaleAlpha' || ct.kind === 'rgba';
}
export function hasTrns(ct: ColorType): boolean {
  if (ct.kind === 'grayscale') return ct.transparentShade !== null;
  if (ct.kind === 'rgb') return ct.transparentColor !== null;
  return false;
}

export function colorTypeEquals(a: ColorType, b: ColorType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'grayscale':
      return a.transparentShade === (b as GrayscaleColorType).transparentShade;
    case 'rgb': {
      const bc = (b as RGBColorType).transparentColor;
      const ac = a.transparentColor;
      if (ac === null || bc === null) return ac === bc;
      return ac.r === bc.r && ac.g === bc.g && ac.b === bc.b;
    }
    case 'indexed': {
      const bp = (b as IndexedColorType).palette;
      if (a.palette.length !== bp.length) return false;
      for (let i = 0; i < a.palette.length; i++) if (a.palette[i] !== bp[i]) return false;
      return true;
    }
    default:
      return true;
  }
}

/** Compact, human readable description used in verbose/debug output. */
export function colorTypeToString(ct: ColorType): string {
  switch (ct.kind) {
    case 'grayscale':
      return 'Grayscale';
    case 'rgb':
      return 'RGB';
    case 'indexed':
      return `Indexed (${ct.palette.length} colors)`;
    case 'grayscaleAlpha':
      return 'Grayscale + Alpha';
    case 'rgba':
      return 'RGB + Alpha';
  }
}

/** The number of bits used per channel per pixel. */
export const BitDepth = {
  One: 1,
  Two: 2,
  Four: 4,
  Eight: 8,
  Sixteen: 16,
} as const;
export type BitDepth = (typeof BitDepth)[keyof typeof BitDepth];

export function bitDepthFromNumber(value: number): BitDepth {
  switch (value) {
    case 1:
    case 2:
    case 4:
    case 8:
    case 16:
      return value;
    default:
      throw new Error('invalid bit depth');
  }
}
