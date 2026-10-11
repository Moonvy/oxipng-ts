import { PngError } from '../error.ts';

// Length and distance base values / extra-bit counts (RFC 1951 §3.2.5).
export const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163,
  195, 227, 258,
];
export const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
export const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
export const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

/** LSB-first bit reader over a byte buffer. */
class BitReader {
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;

  private readonly src: Uint8Array;
  constructor(src: Uint8Array) {
    this.src = src;
  }

  bit(): number {
    if (this.bitCnt === 0) {
      if (this.pos >= this.src.length) throw PngError.invalidData();
      this.bitBuf = this.src[this.pos++];
      this.bitCnt = 8;
    }
    const b = this.bitBuf & 1;
    this.bitBuf >>= 1;
    this.bitCnt--;
    return b;
  }

  bits(count: number): number {
    let v = 0;
    for (let i = 0; i < count; i++) v |= this.bit() << i;
    return v;
  }

  alignToByte(): void {
    this.bitCnt = 0;
  }

  byte(): number {
    if (this.bitCnt !== 0) throw PngError.invalidData();
    if (this.pos >= this.src.length) throw PngError.invalidData();
    return this.src[this.pos++];
  }
}

interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

/** Build a canonical Huffman decoder from code lengths. */
function buildHuffman(lengths: Uint8Array, n: number): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  let total = 0;
  for (let i = 1; i < 16; i++) {
    offs[i] = total;
    total += counts[i];
  }
  const symbols = new Uint16Array(total);
  const cursor = offs.slice();
  for (let s = 0; s < n; s++) {
    const l = lengths[s];
    if (l !== 0) symbols[cursor[l]++] = s;
  }
  return { counts, symbols };
}

function decodeSymbol(r: BitReader, h: Huffman): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len <= 15; len++) {
    code |= r.bit();
    const count = h.counts[len];
    if (code - first < count) return h.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw PngError.invalidData();
}

const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

let fixedLit: Huffman | null = null;
let fixedDist: Huffman | null = null;
function fixedTables(): [Huffman, Huffman] {
  if (!fixedLit || !fixedDist) {
    const lit = new Uint8Array(288);
    for (let i = 0; i < 144; i++) lit[i] = 8;
    for (let i = 144; i < 256; i++) lit[i] = 9;
    for (let i = 256; i < 280; i++) lit[i] = 7;
    for (let i = 280; i < 288; i++) lit[i] = 8;
    const dist = new Uint8Array(30).fill(5);
    fixedLit = buildHuffman(lit, 288);
    fixedDist = buildHuffman(dist, 30);
  }
  return [fixedLit, fixedDist];
}

/**
 * Decompress a raw DEFLATE stream into `out`, stopping at the end-of-stream
 * marker. `out` bounds the output; exceeding it raises `InflatedDataTooLong`.
 * Returns the number of bytes actually written.
 */
function inflateInto(r: BitReader, out: Uint8Array): number {
  let op = 0;
  const cap = out.length;

  for (;;) {
    const final = r.bit();
    const type = r.bits(2);
    if (type === 0) {
      // Stored block.
      r.alignToByte();
      const len = r.byte() | (r.byte() << 8);
      const nlen = r.byte() | (r.byte() << 8);
      if ((len ^ 0xffff) !== nlen) throw PngError.invalidData();
      if (op + len > cap) throw PngError.inflatedDataTooLong(cap);
      for (let i = 0; i < len; i++) out[op++] = r.byte();
    } else if (type === 1 || type === 2) {
      let litHuff: Huffman;
      let distHuff: Huffman;
      if (type === 1) {
        [litHuff, distHuff] = fixedTables();
      } else {
        const hlit = r.bits(5) + 257;
        const hdist = r.bits(5) + 1;
        const hclen = r.bits(4) + 4;
        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLengths[CL_ORDER[i]] = r.bits(3);
        const clHuff = buildHuffman(clLengths, 19);
        const lengths = new Uint8Array(hlit + hdist);
        let i = 0;
        while (i < hlit + hdist) {
          const sym = decodeSymbol(r, clHuff);
          if (sym < 16) {
            lengths[i++] = sym;
          } else if (sym === 16) {
            if (i === 0) throw PngError.invalidData();
            const prev = lengths[i - 1];
            let rep = r.bits(2) + 3;
            if (i + rep > hlit + hdist) throw PngError.invalidData();
            while (rep--) lengths[i++] = prev;
          } else if (sym === 17) {
            let rep = r.bits(3) + 3;
            if (i + rep > hlit + hdist) throw PngError.invalidData();
            while (rep--) lengths[i++] = 0;
          } else {
            let rep = r.bits(7) + 11;
            if (i + rep > hlit + hdist) throw PngError.invalidData();
            while (rep--) lengths[i++] = 0;
          }
        }
        litHuff = buildHuffman(lengths.subarray(0, hlit), hlit);
        distHuff = buildHuffman(lengths.subarray(hlit), hdist);
      }

      // Decode symbols.
      for (;;) {
        const sym = decodeSymbol(r, litHuff);
        if (sym === 256) break;
        if (sym < 256) {
          if (op >= cap) throw PngError.inflatedDataTooLong(cap);
          out[op++] = sym;
        } else {
          const li = sym - 257;
          if (li >= LENGTH_BASE.length) throw PngError.invalidData();
          const length = LENGTH_BASE[li] + (LENGTH_EXTRA[li] ? r.bits(LENGTH_EXTRA[li]) : 0);
          const dsym = decodeSymbol(r, distHuff);
          if (dsym >= DIST_BASE.length) throw PngError.invalidData();
          const dist = DIST_BASE[dsym] + (DIST_EXTRA[dsym] ? r.bits(DIST_EXTRA[dsym]) : 0);
          if (dist > op) throw PngError.invalidData();
          if (op + length > cap) throw PngError.inflatedDataTooLong(cap);
          const from = op - dist;
          for (let k = 0; k < length; k++) out[op++] = out[from + k];
        }
      }
    } else {
      throw PngError.invalidData();
    }
    if (final) break;
  }
  return op;
}

/** Decompress a raw DEFLATE stream, bounding the output at `out.length`. */
export function inflateRawInto(src: Uint8Array, out: Uint8Array): number {
  return inflateInto(new BitReader(src), out);
}

/** Decompress a zlib stream, bounding the output at `outSize`. */
export function inflateZlib(src: Uint8Array, outSize: number): Uint8Array {
  if (src.length < 2) throw PngError.invalidData();
  const cmf = src[0];
  const flg = src[1];
  if ((cmf & 0x0f) !== 8) throw PngError.invalidData(); // method must be deflate
  if (((cmf << 8) | flg) % 31 !== 0) throw PngError.invalidData();
  const out = new Uint8Array(outSize);
  const n = inflateRawInto(src.subarray(2), out);
  return out.subarray(0, n);
}
