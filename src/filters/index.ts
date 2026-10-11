import type { ByteBuffer } from '../util/byteBuffer.ts';

/** PNG delta filter types. */
export const RowFilter = {
  None: 0,
  Sub: 1,
  Up: 2,
  Average: 3,
  Paeth: 4,
} as const;
export type RowFilter = (typeof RowFilter)[keyof typeof RowFilter];

export const ROW_FILTER_ALL: readonly RowFilter[] = [0, 1, 2, 3, 4];
export const ROW_FILTER_NAMES: readonly string[] = ['None', 'Sub', 'Up', 'Average', 'Paeth'];

export function rowFilterName(filter: RowFilter): string {
  return ROW_FILTER_NAMES[filter];
}

export function rowFilterFromNumber(value: number): RowFilter {
  if (value < 0 || value > 4 || value !== Math.floor(value)) throw new Error('invalid row filter');
  return value as RowFilter;
}

export function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = p > a ? p - a : a - p;
  const pb = p > b ? p - b : b - p;
  const pc = p > c ? p - c : c - p;
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Apply `filter` to `data`, writing the filter byte followed by the filtered
 * bytes into `out`. `alphaBytes` enables transparent-pixel optimisation.
 *
 * Writes go straight into the buffer after a single `reserve`, avoiding a
 * function call per byte on this hot path.
 */
export function filterLine(
  filter: RowFilter,
  bpp: number,
  data: Uint8Array,
  prevLine: Uint8Array,
  out: ByteBuffer,
  alphaBytes: number,
): void {
  if (alphaBytes !== 0) {
    optimizeAlpha(filter, bpp, data, prevLine, bpp - alphaBytes);
  }

  const len = data.length;
  out.reserve(len + 1);
  const buf = out.buf;
  let p = out.len;
  buf[p++] = filter;
  switch (filter) {
    case RowFilter.None: {
      buf.set(data, p);
      p += len;
      break;
    }
    case RowFilter.Sub: {
      buf.set(data.subarray(0, bpp), p);
      p += bpp;
      for (let i = bpp; i < len; i++) buf[p++] = data[i] - data[i - bpp];
      break;
    }
    case RowFilter.Up: {
      for (let i = 0; i < len; i++) buf[p++] = data[i] - prevLine[i];
      break;
    }
    case RowFilter.Average: {
      for (let i = 0; i < bpp; i++) buf[p++] = data[i] - (prevLine[i] >> 1);
      for (let i = bpp; i < len; i++) buf[p++] = data[i] - ((data[i - bpp] + prevLine[i]) >> 1);
      break;
    }
    case RowFilter.Paeth: {
      for (let i = 0; i < bpp; i++) buf[p++] = data[i] - prevLine[i];
      for (let i = bpp; i < len; i++) {
        const a = data[i - bpp];
        const b = prevLine[i];
        const c = prevLine[i - bpp];
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        buf[p++] = data[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      break;
    }
  }
  out.len = p;
}

/**
 * Internal MinSum trial: filter and score together, stopping once it cannot win.
 * Only a score below `bestSize` guarantees a complete row appended to `out`.
 */
export function filterLineMinSum(
  filter: RowFilter,
  bpp: number,
  data: Uint8Array,
  prevLine: Uint8Array,
  out: ByteBuffer,
  alphaBytes: number,
  bestSize: number,
): number {
  // Alpha updates must finish even for a rejected trial: later filters see
  // these mutations, and the winning raw row is snapshotted by the caller.
  if (alphaBytes !== 0) optimizeAlpha(filter, bpp, data, prevLine, bpp - alphaBytes);
  const len = data.length;
  out.reserve(len + 1);
  const buf = out.buf;
  let p = out.len;
  buf[p++] = filter;
  let size = filter; // The filter byte participates in MinSum's score.
  if (size >= bestSize) return size;
  switch (filter) {
    case RowFilter.None: {
      for (let i = 0; i < len; i++) {
        const value = data[i];
        buf[p++] = value;
        size += Math.abs((value << 24) >> 24);
        if (size >= bestSize) return size;
      }
      break;
    }
    case RowFilter.Sub: {
      for (let i = 0; i < bpp; i++) {
        const value = data[i];
        buf[p++] = value;
        size += Math.abs((value << 24) >> 24);
        if (size >= bestSize) return size;
      }
      for (let i = bpp; i < len; i++) {
        const value = data[i] - data[i - bpp];
        buf[p++] = value;
        size += Math.abs((value << 24) >> 24);
        if (size >= bestSize) return size;
      }
      break;
    }
    case RowFilter.Up: {
      for (let i = 0; i < len; i++) {
        const value = data[i] - prevLine[i];
        buf[p++] = value;
        size += Math.abs((value << 24) >> 24);
        if (size >= bestSize) return size;
      }
      break;
    }
    case RowFilter.Average: {
      for (let i = 0; i < bpp; i++) {
        const value = data[i] - (prevLine[i] >> 1);
        buf[p++] = value;
        size += Math.abs((value << 24) >> 24);
        if (size >= bestSize) return size;
      }
      for (let i = bpp; i < len; i++) {
        const value = data[i] - ((data[i - bpp] + prevLine[i]) >> 1);
        buf[p++] = value;
        size += Math.abs((value << 24) >> 24);
        if (size >= bestSize) return size;
      }
      break;
    }
    case RowFilter.Paeth: {
      for (let i = 0; i < bpp; i++) {
        const value = data[i] - prevLine[i];
        buf[p++] = value;
        size += Math.abs((value << 24) >> 24);
        if (size >= bestSize) return size;
      }
      for (let i = bpp; i < len; i++) {
        const a = data[i - bpp];
        const b = prevLine[i];
        const c = prevLine[i - bpp];
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        const value = data[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        buf[p++] = value;
        size += Math.abs((value << 24) >> 24);
        if (size >= bestSize) return size;
      }
      break;
    }
  }
  out.len = p;
  return size;
}

/**
 * Optimise fully transparent pixels of a scanline so they zero out after filtering.
 * Mutates `data` in place.
 */
function optimizeAlpha(filter: RowFilter, bpp: number, data: Uint8Array, prevLine: Uint8Array, colorBytes: number): void {
  if (filter === RowFilter.None) return;
  const numPixels = Math.floor(data.length / bpp);

  for (let i = 0; i < numPixels; i++) {
    const base = i * bpp;
    let transparent = true;
    for (let j = colorBytes; j < bpp; j++) {
      if (data[base + j] !== 0) {
        transparent = false;
        break;
      }
    }
    if (!transparent) continue;

    let prev: number;
    if (i === 0) {
      prev = i;
      for (let k = 0; k < numPixels; k++) {
        const kb = k * bpp;
        let anyNonZero = false;
        for (let j = colorBytes; j < bpp; j++) {
          if (data[kb + j] !== 0) {
            anyNonZero = true;
            break;
          }
        }
        if (anyNonZero) {
          prev = k;
          break;
        }
      }
    } else {
      prev = i - 1;
    }

    switch (filter) {
      case RowFilter.Sub: {
        if (prev !== i) {
          const src = prev * bpp;
          for (let j = 0; j < colorBytes; j++) data[base + j] = data[src + j];
        }
        break;
      }
      case RowFilter.Up: {
        for (let j = 0; j < colorBytes; j++) data[base + j] = prevLine[base + j];
        break;
      }
      case RowFilter.Average: {
        for (let j = 0; j < colorBytes; j++) {
          data[base + j] =
            i === 0 ? prevLine[base + j] >> 1 : (data[base - bpp + j] + prevLine[base + j]) >> 1;
        }
        break;
      }
      case RowFilter.Paeth: {
        for (let j = 0; j < colorBytes; j++) {
          data[base + j] =
            i === 0
              ? Math.min(data[prev * bpp + j], prevLine[base + j])
              : paethPredictor(data[base - bpp + j], prevLine[base + j], prevLine[base - bpp + j]);
        }
        break;
      }
    }
  }
}

/** Reverse `filter` on `data`, appending the unfiltered bytes to `out`. */
export function unfilterLine(
  filter: RowFilter,
  bpp: number,
  data: Uint8Array,
  prevLine: Uint8Array,
  out: ByteBuffer,
): void {
  const len = data.length;
  const offset = out.len;
  out.reserve(len);
  const buf = out.buf;
  let p = offset;
  switch (filter) {
    case RowFilter.None: {
      buf.set(data, p);
      p += len;
      break;
    }
    case RowFilter.Sub: {
      buf.set(data.subarray(0, bpp), p);
      p += bpp;
      for (let i = bpp; i < len; i++) buf[p++] = data[i] + buf[offset + i - bpp];
      break;
    }
    case RowFilter.Up: {
      for (let i = 0; i < len; i++) buf[p++] = data[i] + prevLine[i];
      break;
    }
    case RowFilter.Average: {
      for (let i = 0; i < bpp; i++) buf[p++] = data[i] + (prevLine[i] >> 1);
      for (let i = bpp; i < len; i++) buf[p++] = data[i] + ((buf[offset + i - bpp] + prevLine[i]) >> 1);
      break;
    }
    case RowFilter.Paeth: {
      for (let i = 0; i < bpp; i++) buf[p++] = data[i] + prevLine[i];
      for (let i = bpp; i < len; i++) {
        const a = buf[offset + i - bpp];
        const b = prevLine[i];
        const c = prevLine[i - bpp];
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        buf[p++] = data[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      break;
    }
  }
  out.len = p;
}
