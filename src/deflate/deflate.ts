import { adler32 } from './adler32.js';
import { BitWriter, SizeLimitExceeded } from './bitwriter.js';
import { buildCodes, limitedLengths, makeComplete, type CodeSet } from './huffman.js';
import { DIST_BASE, DIST_EXTRA, LENGTH_BASE, LENGTH_EXTRA } from './inflate.js';

const WINDOW = 32768;
const WINDOW_MASK = WINDOW - 1;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const HASH_BITS = 15;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;
const BLOCK_SIZE = 1 << 18;

// Level → match-finder parameters. Level 0 means "stored".
interface LevelParams {
  chain: number;
  lazy: boolean;
  nice: number;
}
const LEVELS: LevelParams[] = [
  { chain: 0, lazy: false, nice: 0 }, // stored
  { chain: 4, lazy: false, nice: 16 },
  { chain: 8, lazy: false, nice: 24 },
  { chain: 16, lazy: false, nice: 32 },
  { chain: 24, lazy: true, nice: 32 },
  { chain: 32, lazy: true, nice: 48 },
  { chain: 48, lazy: true, nice: 64 },
  { chain: 64, lazy: true, nice: 96 },
  { chain: 96, lazy: true, nice: 128 },
  { chain: 128, lazy: true, nice: 160 },
  { chain: 192, lazy: true, nice: 200 },
  { chain: 256, lazy: true, nice: 258 },
  { chain: 512, lazy: true, nice: 258 },
];

// Symbol lookup tables (indexed by length 3..258 / distance 1..32768).
// Note: length symbols are 257..285, so this must be 16-bit.
const lenSym = new Uint16Array(MAX_MATCH + 1);
const lenExtraCnt = new Uint8Array(MAX_MATCH + 1);
const lenBase = new Uint16Array(MAX_MATCH + 1);
for (let s = 0; s < LENGTH_BASE.length; s++) {
  const base = LENGTH_BASE[s];
  const next = s + 1 < LENGTH_BASE.length ? LENGTH_BASE[s + 1] : MAX_MATCH + 1;
  for (let l = base; l < next && l <= MAX_MATCH; l++) {
    lenSym[l] = 257 + s;
    lenExtraCnt[l] = LENGTH_EXTRA[s];
    lenBase[l] = base;
  }
}
const distSym = new Uint8Array(WINDOW + 1);
const distExtraCnt = new Uint8Array(WINDOW + 1);
for (let s = 0; s < DIST_BASE.length; s++) {
  const base = DIST_BASE[s];
  const next = s + 1 < DIST_BASE.length ? DIST_BASE[s + 1] : WINDOW + 1;
  for (let d = base; d < next && d <= WINDOW; d++) {
    distSym[d] = s;
    distExtraCnt[d] = DIST_EXTRA[s];
  }
}
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const SIZE_REJECTED = new SizeLimitExceeded();

/** Exact byte count for filter trials, without allocating or writing a stream. */
class SizeCounter {
  private bits = 0;
  constructor(private readonly limit: number) {}

  addBits(bits: number): void {
    this.bits += bits;
    if (this.finish() > this.limit) throw SIZE_REJECTED;
  }

  addStored(bytes: number): void {
    // Three header bits, byte alignment, LEN/NLEN, then the stored bytes.
    this.bits = Math.ceil((this.bits + 3) / 8) * 8;
    this.addBits(32 + bytes * 8);
  }

  finish(): number {
    return Math.ceil(this.bits / 8);
  }
}

// Reusable scratch (deflate is synchronous, so this is safe).
const head = new Int32Array(HASH_SIZE);
const headEpoch = new Uint32Array(HASH_SIZE);
let epoch = 0;
// Chain entries are read only while their absolute positions are in the
// current window. Search before inserting the position that reuses a slot.
const prev = new Int32Array(WINDOW);
const tLen = new Uint16Array(BLOCK_SIZE + MAX_MATCH);
const tDist = new Uint16Array(BLOCK_SIZE + MAX_MATCH);
const litFreq = new Uint32Array(286);
const distFreq = new Uint32Array(30);
const clFreq = new Uint32Array(19);
const seqSym = new Int32Array(512);
const seqVal = new Int32Array(512);
const seqCnt = new Int32Array(512);

/** 4-byte hash of the input at `p` (caller guarantees `p + 4 <= n`). */
function hashAt(view: DataView, p: number): number {
  const h = view.getUint32(p, true);
  return (Math.imul(h, 0x9e3779b1) >>> (32 - HASH_BITS)) & HASH_MASK;
}

/** Longest match at `pos`, packed as `(len << 16) | (dist - 1)`. Optionally inserts `pos`. */
function findMatch(data: Uint8Array, view: DataView, n: number, pos: number, chain: number, nice: number, insert: boolean): number {
  let bestLen = 0;
  let bestDist = 0;
  const remaining = n - pos;
  // A 4-byte hash (and a match) needs at least four bytes left.
  if (remaining < 4) return 0;
  const maxLen = remaining < MAX_MATCH ? remaining : MAX_MATCH;
  {
    const firstWord = view.getUint32(pos, true);
    const h = (Math.imul(firstWord, 0x9e3779b1) >>> (32 - HASH_BITS)) & HASH_MASK;
    let cand = headEpoch[h] === epoch ? head[h] : -1;
    let depth = chain;
    let bestWord = 0;
    let bestByte = data[pos];
    while (cand >= 0 && depth-- > 0 && pos - cand <= WINDOW) {
      if (data[cand + bestLen] === bestByte) {
        let l = 0;
        if (view.getUint32(cand, true) === firstWord) {
          // A candidate must match through bestLen to improve the current
          // result. Check that suffix before rescanning its middle.
          if (bestLen > 3 && view.getUint32(cand + bestLen - 3, true) !== bestWord) {
            cand = prev[cand & WINDOW_MASK];
            continue;
          }
          l = 4;
          while (l + 4 <= maxLen) {
            if (view.getUint32(pos + l, true) !== view.getUint32(cand + l, true)) break;
            l += 4;
          }
        } else if (bestLen >= 3) {
          cand = prev[cand & WINDOW_MASK];
          continue;
        }
        // A four-byte hash collision can still yield a three-byte match.
        while (l < maxLen && data[cand + l] === data[pos + l]) l++;
        if (l > bestLen) {
          bestLen = l;
          bestDist = pos - cand;
          if (l >= nice || l >= maxLen) break;
          bestByte = data[pos + l];
          if (l > 3) bestWord = view.getUint32(pos + l - 3, true);
        }
      }
      cand = prev[cand & WINDOW_MASK];
    }
    if (insert) {
      prev[pos & WINDOW_MASK] = headEpoch[h] === epoch ? head[h] : -1;
      headEpoch[h] = epoch;
      head[h] = pos;
    }
  }
  // dist - 1 keeps the low 16 bits free of collisions with the length
  // (dist can be WINDOW = 32768, which would otherwise alias bit 16 of len).
  return bestLen === 0 ? 0 : (bestLen << 16) | (bestDist - 1);
}

function buildCLSequence(hlit: number, hdist: number, litLen: Uint8Array, distLen: Uint8Array): number {
  let i = 0;
  let out = 0;
  const total = hlit + hdist;
  while (i < total) {
    const v = i < hlit ? litLen[i] : distLen[i - hlit];
    let run = 1;
    while (i + run < total) {
      const w = i + run < hlit ? litLen[i + run] : distLen[i + run - hlit];
      if (w !== v) break;
      run++;
    }
    if (v === 0) {
      let r = run;
      while (r >= 11) {
        const t = r < 138 ? r : 138;
        seqSym[out] = 18;
        seqVal[out] = t - 11;
        seqCnt[out] = 7;
        out++;
        r -= t;
      }
      while (r >= 3) {
        const t = r < 10 ? r : 10;
        seqSym[out] = 17;
        seqVal[out] = t - 3;
        seqCnt[out] = 3;
        out++;
        r -= t;
      }
      while (r > 0) {
        seqSym[out] = 0;
        seqVal[out] = 0;
        seqCnt[out] = 0;
        out++;
        r--;
      }
    } else {
      seqSym[out] = v;
      seqVal[out] = 0;
      seqCnt[out] = 0;
      out++;
      let r = run - 1;
      while (r >= 3) {
        const t = r < 6 ? r : 6;
        seqSym[out] = 16;
        seqVal[out] = t - 3;
        seqCnt[out] = 2;
        out++;
        r -= t;
      }
      while (r > 0) {
        seqSym[out] = v;
        seqVal[out] = 0;
        seqCnt[out] = 0;
        out++;
        r--;
      }
    }
    i += run;
  }
  return out;
}

function emitStored(bw: BitWriter | SizeCounter, final: boolean, data: Uint8Array, start: number, end: number): void {
  const len = end - start;
  if (bw instanceof SizeCounter) {
    bw.addStored(len);
    return;
  }
  bw.writeBits(final ? 1 : 0, 1);
  bw.writeBits(0, 2);
  bw.alignToByte();
  bw.writeBits(len & 0xff, 8);
  bw.writeBits((len >>> 8) & 0xff, 8);
  bw.writeBits(~len & 0xff, 8);
  bw.writeBits((~len >>> 8) & 0xff, 8);
  bw.pushBytes(data.subarray(start, end));
} // emitStored

// Fixed-Huffman code lengths (RFC 1951 §3.2.6).
const FIXED_LIT_LEN = new Uint8Array(288);
for (let i = 0; i < 144; i++) FIXED_LIT_LEN[i] = 8;
for (let i = 144; i < 256; i++) FIXED_LIT_LEN[i] = 9;
for (let i = 256; i < 280; i++) FIXED_LIT_LEN[i] = 7;
for (let i = 280; i < 288; i++) FIXED_LIT_LEN[i] = 8;

let fixedCodes: { lit: CodeSet; dist: CodeSet } | null = null;
function getFixedCodes(): { lit: CodeSet; dist: CodeSet } {
  if (!fixedCodes) {
    const dist = new Uint8Array(30).fill(5);
    fixedCodes = { lit: buildCodes(FIXED_LIT_LEN), dist: buildCodes(dist) };
  }
  return fixedCodes;
}

/** Write the block's tokens with the given literal/length and distance codes. */
function writeTokens(bw: BitWriter, litCodes: CodeSet, distCodes: CodeSet, count: number): void {
  const lrev = litCodes.rev;
  const llen = litCodes.lengths;
  const drev = distCodes.rev;
  const dlen = distCodes.lengths;
  for (let i = 0; i < count; i++) {
    const d = tDist[i];
    if (d === 0) {
      const b = tLen[i];
      bw.writeBits(lrev[b], llen[b]);
    } else {
      const L = tLen[i];
      const ls = lenSym[L];
      const lc = llen[ls];
      // Fuse the Huffman code and the extra bits into a single write
      // (≤ 15 + 5 bits for lengths, ≤ 15 + 13 bits for distances).
      bw.writeBits(lrev[ls] | ((L - lenBase[L]) << lc), lc + lenExtraCnt[L]);
      const ds = distSym[d];
      const dc = dlen[ds];
      bw.writeBits(drev[ds] | ((d - DIST_BASE[ds]) << dc), dc + distExtraCnt[d]);
    }
  }
  bw.writeBits(lrev[256], llen[256]);
}

function emitBlock(
  bw: BitWriter | SizeCounter,
  final: boolean,
  data: Uint8Array,
  start: number,
  end: number,
  count: number,
): void {
  const blockBytes = end - start;
  litFreq.fill(0);
  distFreq.fill(0);
  let extraBits = 0;
  for (let i = 0; i < count; i++) {
    const d = tDist[i];
    if (d === 0) {
      litFreq[tLen[i]]++;
    } else {
      const L = tLen[i];
      litFreq[lenSym[L]]++;
      distFreq[distSym[d]]++;
      extraBits += lenExtraCnt[L] + distExtraCnt[d];
    }
  }
  litFreq[256]++;

  // Cost of a stored block (needs byte alignment; ≤ 65535 bytes).
  const storedBits = blockBytes <= 0xffff ? 3 + 5 + 32 + blockBytes * 8 : Infinity;

  // Cost of a fixed-Huffman block.
  let fixedBits = 3 + extraBits;
  for (let s = 0; s < 286; s++) if (litFreq[s] !== 0) fixedBits += litFreq[s] * FIXED_LIT_LEN[s];
  for (let s = 0; s < 30; s++) if (distFreq[s] !== 0) fixedBits += distFreq[s] * 5;

  const cheap = storedBits < fixedBits ? storedBits : fixedBits;

  let hlit = 286;
  while (hlit > 257 && litFreq[hlit - 1] === 0) hlit--;
  const litLen = limitedLengths(litFreq, 15);
  makeComplete(litLen.subarray(0, hlit));

  let hdist = 30;
  while (hdist > 1 && distFreq[hdist - 1] === 0) hdist--;
  if (hdist < 2) hdist = 2; // a valid Huffman code needs at least two symbols
  const distLen = limitedLengths(distFreq, 15);
  makeComplete(distLen.subarray(0, hdist));

  const seqCount = buildCLSequence(hlit, hdist, litLen, distLen);
  clFreq.fill(0);
  for (let i = 0; i < seqCount; i++) clFreq[seqSym[i]]++;
  const clLen = limitedLengths(clFreq, 7);
  makeComplete(clLen);
  let hclen = 19;
  while (hclen > 4 && clLen[CL_ORDER[hclen - 1]] === 0) hclen--;

  // Cost of a dynamic-Huffman block, computed from the frequency tables
  // (litFreq[256] = 1 accounts for the end-of-block code; extraBits was
  // accumulated during the frequency pass).
  let dynBits = 3 + 5 + 5 + 4 + 3 * hclen + extraBits;
  for (let i = 0; i < seqCount; i++) dynBits += clLen[seqSym[i]] + seqCnt[i];
  for (let s = 0; s < 286; s++) {
    const f = litFreq[s];
    if (f !== 0) dynBits += f * litLen[s];
  }
  for (let s = 0; s < 30; s++) {
    const f = distFreq[s];
    if (f !== 0) dynBits += f * distLen[s];
  }

  if (bw instanceof SizeCounter) {
    if (cheap < dynBits && storedBits <= fixedBits) bw.addStored(blockBytes);
    else bw.addBits(cheap < dynBits ? fixedBits : dynBits);
    return;
  }

  // Pick the cheapest of stored / fixed / dynamic.
  if (cheap < dynBits) {
    if (storedBits <= fixedBits) {
      emitStored(bw, final, data, start, end);
      return;
    }
    const { lit, dist } = getFixedCodes();
    bw.writeBits(final ? 1 : 0, 1);
    bw.writeBits(1, 2);
    writeTokens(bw, lit, dist, count);
    return;
  }

  bw.writeBits(final ? 1 : 0, 1);
  bw.writeBits(2, 2);
  bw.writeBits(hlit - 257, 5);
  bw.writeBits(hdist - 1, 5);
  bw.writeBits(hclen - 4, 4);
  for (let i = 0; i < hclen; i++) bw.writeBits(clLen[CL_ORDER[i]], 3);

  const clCodes = buildCodes(clLen);
  for (let i = 0; i < seqCount; i++) {
    const s = seqSym[i];
    bw.writeBits(clCodes.rev[s], clCodes.lengths[s]);
    if (seqCnt[i] !== 0) bw.writeBits(seqVal[i], seqCnt[i]);
  }

  writeTokens(bw, buildCodes(litLen), buildCodes(distLen), count);
}

/** Compress `data` into `bw` as a raw DEFLATE stream at the given level (0-12). */
function deflateInto(bw: BitWriter | SizeCounter, data: Uint8Array, level: number): void {
  const n = data.length;

  // Fast 4-byte match comparisons (DataView handles unaligned loads).
  const view = n >= 4 ? new DataView(data.buffer, data.byteOffset, n) : null;

  if (n === 0) {
    emitStored(bw, true, data, 0, 0);
    return;
  }

  if (level <= 0) {
    let pos = 0;
    while (pos < n) {
      const end = Math.min(pos + 0xffff, n);
      emitStored(bw, end >= n, data, pos, end);
      pos = end;
    }
    return;
  }

  const params = LEVELS[level < LEVELS.length ? level : LEVELS.length - 1];
  epoch = (epoch + 1) >>> 0;
  if (epoch === 0) {
    headEpoch.fill(0);
    epoch = 1;
  }
  const chain = params.chain;
  const nice = params.nice;
  const lazy = params.lazy;

  let pos = 0;
  let blockStart = 0;
  // A lookahead result carried over from the previous iteration: `pos` has
  // already been inserted into the hash chains and its match is known.
  let cached = -1;
  while (pos < n) {
    const nominalEnd = blockStart + BLOCK_SIZE < n ? blockStart + BLOCK_SIZE : n;
    let count = 0;
    while (pos < nominalEnd) {
      let m: number;
      if (cached >= 0) {
        m = cached;
        cached = -1;
      } else {
        m = findMatch(data, view!, n, pos, chain, nice, true);
      }
      let len = m >>> 16;
      let dist = (m & 0xffff) + 1;
      let insertedNext = false;
      if (lazy && len >= MIN_MATCH && len < nice && pos + 1 < n) {
        // Look ahead one position (inserting it into chains). If it yields a
        // longer match, emit the current byte as a literal and carry the
        // lookahead result.
        const m2 = findMatch(data, view!, n, pos + 1, chain, nice, true);
        insertedNext = true;
        if (m2 >>> 16 > len) {
          tLen[count] = data[pos];
          tDist[count] = 0;
          count++;
          pos++;
          cached = m2;
          continue;
        }
      }
      if (len >= MIN_MATCH) {
        tLen[count] = len;
        tDist[count] = dist;
        count++;
        const end = pos + len;
        const insLimit = end < n - 3 ? end : n - 3; // insert while p + 4 <= n
        for (let p = pos + (insertedNext ? 2 : 1); p < insLimit; p++) {
          const h = hashAt(view!, p);
          prev[p & WINDOW_MASK] = headEpoch[h] === epoch ? head[h] : -1;
          headEpoch[h] = epoch;
          head[h] = p;
        }
        pos = end;
      } else {
        tLen[count] = data[pos];
        tDist[count] = 0;
        count++;
        pos++;
      }
    }
    emitBlock(bw, pos >= n, data, blockStart, pos, count);
    blockStart = pos;
  }
}

/** Internal size-only raw DEFLATE trial, with the same parser and block choices. */
export function deflateRawSize(data: Uint8Array, level: number, maxSize = Infinity): number {
  const counter = new SizeCounter(maxSize);
  deflateInto(counter, data, level);
  return counter.finish();
}

/** Compress `data` as a raw DEFLATE stream at the given level (0-12). */
export function deflateRaw(data: Uint8Array, level: number, maxSize?: number): Uint8Array {
  const bw = new BitWriter(Math.max(64, data.length >>> 1), maxSize ?? Infinity);
  deflateInto(bw, data, level);
  return bw.finish();
}

/** Compress `data` as a zlib stream at the given libdeflate-style level (0-12). */
export function zlibCompress(data: Uint8Array, level: number, maxSize?: number): Uint8Array {
  const bw = new BitWriter(Math.max(64, data.length >>> 1), maxSize ?? Infinity);
  bw.skip(2); // zlib header, written at the end
  deflateInto(bw, data, level);
  const adler = adler32(data);
  const tail = new Uint8Array(4);
  tail[0] = (adler >>> 24) & 0xff;
  tail[1] = (adler >>> 16) & 0xff;
  tail[2] = (adler >>> 8) & 0xff;
  tail[3] = adler & 0xff;
  bw.pushBytes(tail);
  const out = bw.finish();
  out[0] = 0x78; // CM=8 (deflate), CINFO=7 (32K window)
  out[1] = 0x01; // FCHECK such that (0x78 << 8 | 0x01) % 31 === 0, no dict, FLEVEL=0
  return out;
}
