import { ihdrBpp, type IhdrData } from '../headers.js';

export interface ScanLine {
  /** The filter type used to encode this scan line (0-4). */
  filter: number;
  /** The (filtered) byte data for this scan line. */
  data: Uint8Array;
  /** The Adam7 pass this line belongs to, or null for non-interlaced images. */
  pass: number | null;
  /** The number of pixels in this scan line. */
  numPixels: number;
}

export interface ScanLineRange {
  len: number;
  pass: number | null;
  numPixels: number;
}

/** An iterator over the scan line locations of a PNG image. */
export class ScanLineRanges {
  private pass: { p: number; row: number } | null;
  private bitsPerPixel: number;
  private width: number;
  private height: number;
  private left: number;
  private hasFilter: boolean;

  constructor(ihdr: IhdrData, dataLen: number, hasFilter: boolean) {
    this.bitsPerPixel = ihdrBpp(ihdr);
    this.width = ihdr.width;
    this.height = ihdr.height;
    this.left = dataLen;
    this.pass = ihdr.interlaced ? { p: 1, row: 0 } : null;
    this.hasFilter = hasFilter;
  }

  next(): ScanLineRange | null {
    if (this.left === 0) return null;
    let pixelsPerLine: number;
    let currentPass: number | null;
    const pass = this.pass;
    if (pass) {
      if (this.width < 5 && pass.p === 2) {
        pass.p = 3;
        pass.row = 4;
      }
      if (this.height < 5 && pass.p === 3) {
        pass.p = 4;
        pass.row = 0;
      }
      if (this.width < 3 && pass.p === 4) {
        pass.p = 5;
        pass.row = 2;
      }
      if (this.height < 3 && pass.p === 5) {
        pass.p = 6;
        pass.row = 0;
      }
      if (this.width === 1 && pass.p === 6) {
        pass.p = 7;
        pass.row = 1;
      }
      let pixelsFactor: number;
      let ySteps: number;
      switch (pass.p) {
        case 1:
        case 2:
          pixelsFactor = 8;
          ySteps = 8;
          break;
        case 3:
          pixelsFactor = 4;
          ySteps = 8;
          break;
        case 4:
          pixelsFactor = 4;
          ySteps = 4;
          break;
        case 5:
          pixelsFactor = 2;
          ySteps = 4;
          break;
        case 6:
          pixelsFactor = 2;
          ySteps = 2;
          break;
        case 7:
          pixelsFactor = 1;
          ySteps = 2;
          break;
        default:
          throw new Error('unreachable');
      }
      let ppl = Math.floor(this.width / pixelsFactor);
      const gap = this.width % pixelsFactor;
      switch (pass.p) {
        case 1:
        case 3:
        case 5:
          if (gap > 0) ppl += 1;
          break;
        case 2:
          if (gap >= 5) ppl += 1;
          break;
        case 4:
          if (gap >= 3) ppl += 1;
          break;
        case 6:
          if (gap >= 2) ppl += 1;
          break;
        default:
          break;
      }
      currentPass = pass.p;
      if (pass.row + ySteps >= this.height) {
        pass.p += 1;
        pass.row = pass.p === 3 ? 4 : pass.p === 5 ? 2 : pass.p === 7 ? 1 : 0;
      } else {
        pass.row += ySteps;
      }
      pixelsPerLine = ppl;
    } else {
      pixelsPerLine = this.width;
      currentPass = null;
    }
    const bitsPerLine = pixelsPerLine * this.bitsPerPixel;
    let len = Math.ceil(bitsPerLine / 8);
    if (this.hasFilter) len += 1;
    this.left -= len;
    if (this.left < 0) {
      this.left = 0;
      return null;
    }
    return { len, pass: currentPass, numPixels: pixelsPerLine };
  }
}

/** An iterator over the scan lines of a PNG image. */
export class ScanLines {
  private iter: ScanLineRanges;
  private data: Uint8Array;
  private pos = 0;
  private hasFilter: boolean;

  constructor(ihdr: IhdrData, data: Uint8Array, hasFilter: boolean) {
    this.iter = new ScanLineRanges(ihdr, data.length, hasFilter);
    this.data = data;
    this.hasFilter = hasFilter;
  }

  next(): ScanLine | null {
    const range = this.iter.next();
    if (!range) return null;
    const { len, pass, numPixels } = range;
    if (this.data.length - this.pos < len) return null;
    const start = this.pos;
    this.pos += len;
    let filter = 0;
    let dataStart = start;
    if (this.hasFilter) {
      filter = this.data[start];
      dataStart = start + 1;
    }
    return {
      filter,
      data: this.data.subarray(dataStart, start + len),
      pass,
      numPixels,
    };
  }

  [Symbol.iterator](): Iterator<ScanLine> {
    return {
      next: (): IteratorResult<ScanLine> => {
        const line = this.next();
        if (line === null) return { done: true, value: undefined };
        return { done: false, value: line };
      },
    };
  }
}
