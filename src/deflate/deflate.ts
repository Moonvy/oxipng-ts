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
// Keep the stored-block fallback available even for incompressible inputs.
const OPT_BLOCK_SIZE = 0xffff;
const BLOCK_OBSERVATION = 8192;
const MIN_OPT_BLOCK_SIZE = 16384;

// Match-finder parameters for the stored/greedy/lazy parsers (levels 0–9).
// Levels 10–12 use the cost-based parser below.
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
  { chain: 32, lazy: true, nice: 96 },
  { chain: 64, lazy: true, nice: 128 },
  { chain: 128, lazy: true, nice: 160 },
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

  bitLength(): number {
    return this.bits;
  }
}

// Reusable scratch (deflate is synchronous, so this is safe).
const head = new Int32Array(HASH_SIZE);
const headEpoch = new Uint32Array(HASH_SIZE);
const head4 = new Int32Array(HASH_SIZE);
const head4Epoch = new Uint32Array(HASH_SIZE);
const head3 = new Int32Array(HASH_SIZE);
const head3Epoch = new Uint32Array(HASH_SIZE);
let wideMatches = false;
let foundShortDist = 0;
let foundNearLen = 0;
let foundNearDist = 0;
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
// High levels use a binary tree and a bounded list of increasing match
// lengths, rather than the fast encoder's eight-byte chain. Packed records
// store length and distance - 1, including the full 32768-byte distance.
const treeChildren = new Int32Array(WINDOW * 2);
const matchStarts = new Uint32Array(OPT_BLOCK_SIZE + 1);
const matchCache = new Uint32Array(OPT_BLOCK_SIZE * 8);
let cacheCount = 0;
const matchDist = new Uint16Array(OPT_BLOCK_SIZE);
const pathCost = new Uint32Array(OPT_BLOCK_SIZE + 1);
const pathLen = new Uint16Array(OPT_BLOCK_SIZE);
const bestLenTokens = new Uint16Array(OPT_BLOCK_SIZE);
const bestDistTokens = new Uint16Array(OPT_BLOCK_SIZE);
const lengthCosts = new Uint8Array(MAX_MATCH + 1);
const trialLiteralCosts = new Uint8Array(286);
const trialDistanceCosts = new Uint8Array(30);
const blockHistogram = new Uint32Array(256);
const observationHistogram = new Uint32Array(256);

/** Insert short prefixes and return the chain hash; caller guarantees four bytes. */
function hashAt(view: DataView, p: number): number {
  const h = view.getUint32(p, true);
  if (wideMatches) {
    const h3 = Math.imul(h & 0xffffff, 0x9e3779b1) >>> (32 - HASH_BITS);
    head3[h3] = p;
    head3Epoch[h3] = epoch;
    const h4 = Math.imul(h, 0x9e3779b1) >>> (32 - HASH_BITS);
    head4[h4] = p;
    head4Epoch[h4] = epoch;
    if (p + 8 <= view.byteLength) {
      return (Math.imul(h, 0x9e3779b1) ^ Math.imul(view.getUint32(p + 4, true), 0x85ebca6b)) >>> (32 - HASH_BITS);
    }
  }
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
            const diff = view.getUint32(pos + l, true) ^ view.getUint32(cand + l, true);
            if (diff !== 0) {
              // The lowest set bit identifies the first differing byte in
              // these little-endian words, including a difference at bit 31.
              l += (31 - Math.clz32(diff & -diff)) >>> 3;
              break;
            }
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

/** Compare a match after its four-byte prefix, using unaligned word loads. */
function extendMatch(data: Uint8Array, view: DataView, pos: number, cand: number, max: number): number {
  let len = 4;
  while (len + 4 <= max) {
    const diff = view.getUint32(pos + len, true) ^ view.getUint32(cand + len, true);
    if (diff !== 0) {
      len += (31 - Math.clz32(diff & -diff)) >>> 3;
      return len;
    }
    len += 4;
  }
  while (len < max && data[pos + len] === data[cand + len]) len++;
  return len;
}

/** Nearest short matches plus an eight-byte chain for longer matches. */
function findWideMatch(data: Uint8Array, view: DataView, end: number, pos: number, chain: number, nice: number): number {
  foundShortDist = 0;
  foundNearLen = 0;
  foundNearDist = 0;
  const remaining = end - pos;
  if (remaining < 3) return 0;
  const first = remaining >= 4 ? view.getUint32(pos, true) :
    data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16);
  const h3 = Math.imul(first & 0xffffff, 0x9e3779b1) >>> (32 - HASH_BITS);
  const short = head3Epoch[h3] === epoch ? head3[h3] : -1;
  let bestLen = 0;
  let bestDist = 0;
  if (short >= 0 && pos - short <= WINDOW && data[short] === data[pos] &&
      data[short + 1] === data[pos + 1] && data[short + 2] === data[pos + 2]) {
    bestLen = 3;
    bestDist = pos - short;
    foundShortDist = bestDist;
  }
  head3[h3] = pos;
  head3Epoch[h3] = epoch;
  if (remaining >= 4) {
    const max = Math.min(MAX_MATCH, remaining);
    const h4 = Math.imul(first, 0x9e3779b1) >>> (32 - HASH_BITS);
    const near = head4Epoch[h4] === epoch ? head4[h4] : -1;
    if (near >= 0 && pos - near <= WINDOW && view.getUint32(near, true) === first) {
      bestLen = extendMatch(data, view, pos, near, max);
      bestDist = pos - near;
      foundNearLen = bestLen;
      foundNearDist = bestDist;
    }
    head4[h4] = pos;
    head4Epoch[h4] = epoch;
    if (remaining >= 8) {
      const h8 = (Math.imul(first, 0x9e3779b1) ^ Math.imul(view.getUint32(pos + 4, true), 0x85ebca6b)) >>> (32 - HASH_BITS);
      let cand = headEpoch[h8] === epoch ? head[h8] : -1;
      let depth = chain;
      while (bestLen < nice && bestLen < max && cand >= 0 && pos - cand <= WINDOW && depth-- > 0) {
        if (data[cand + bestLen] === data[pos + bestLen] && view.getUint32(cand, true) === first) {
          const len = extendMatch(data, view, pos, cand, max);
          if (len > bestLen) {
            bestLen = len;
            bestDist = pos - cand;
          }
        }
        cand = prev[cand & WINDOW_MASK];
      }
      // Search before reusing this ring slot, including at distance 32768.
      prev[pos & WINDOW_MASK] = headEpoch[h8] === epoch ? head[h8] : -1;
      headEpoch[h8] = epoch;
      head[h8] = pos;
    }
  }
  return bestLen === 0 ? 0 : (bestLen << 16) | (bestDist - 1);
}

/** Cache progressively longer matches, preserving the nearer distances. */
function cacheMatches(
  data: Uint8Array, view: DataView, pos: number, end: number,
  depth: number, nice: number, record: boolean, knownDistance: number, knownLength: number,
): number {
  const remaining = end - pos;
  if (remaining < 3) return 0;
  const first = remaining >= 4 ? view.getUint32(pos, true) :
    data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16);
  const h3 = Math.imul(first & 0xffffff, 0x9e3779b1) >>> (32 - HASH_BITS);
  const short = head3Epoch[h3] === epoch ? head3[h3] : -1;
  let best = 2;
  if (short >= 0 && pos - short <= WINDOW && data[short] === data[pos] &&
      data[short + 1] === data[pos + 1] && data[short + 2] === data[pos + 2]) {
    best = 3;
    if (record) matchCache[cacheCount++] = (3 << 16) | (pos - short - 1);
  }
  head3[h3] = pos;
  head3Epoch[h3] = epoch;
  if (remaining < 4) return best;
  const hash = Math.imul(first, 0x9e3779b1) >>> (32 - HASH_BITS);
  let cand = headEpoch[hash] === epoch ? head[hash] : -1;
  headEpoch[hash] = epoch;
  head[hash] = pos;
  let left = (pos & WINDOW_MASK) * 2;
  let right = left + 1;
  let leftLength = 0;
  let rightLength = 0;
  // Order the tree using input bytes beyond the block boundary as well.
  // Only the recorded lengths are clipped to this block.
  const max = Math.min(MAX_MATCH, data.length - pos);
  while (cand >= 0 && pos - cand <= WINDOW && depth-- > 0) {
    let len = Math.min(leftLength, rightLength);
    // The previous match proves this suffix without rereading long runs.
    if (pos - cand === knownDistance && knownLength > len) len = knownLength;
    while (len + 4 <= max && view.getUint32(pos + len, true) === view.getUint32(cand + len, true)) len += 4;
    while (len < max && data[pos + len] === data[cand + len]) len++;
    const usable = Math.min(len, remaining);
    if (usable > best) {
      best = usable;
      if (record) matchCache[cacheCount++] = (usable << 16) | (pos - cand - 1);
    }
    const slot = (cand & WINDOW_MASK) * 2;
    // At the exact window distance, the candidate shares our ring slot.
    // Its children have expired; don't copy them into that same slot.
    if (pos - cand === WINDOW) break;
    if (len >= nice || len === max) {
      treeChildren[left] = treeChildren[slot];
      treeChildren[right] = treeChildren[slot + 1];
      return best;
    }
    if (data[cand + len] < data[pos + len]) {
      treeChildren[left] = cand;
      left = slot + 1;
      cand = treeChildren[left];
      leftLength = len;
    } else {
      treeChildren[right] = cand;
      right = slot;
      cand = treeChildren[right];
      rightLength = len;
    }
  }
  treeChildren[left] = -1;
  treeChildren[right] = -1;
  return best;
}

/** Reparse cached matches using Huffman costs, retaining the smallest trial. */
function optimalTokens(data: Uint8Array, start: number, end: number, passes: number, minImprovement: number): number {
  const size = end - start;
  let initialCount = 0;
  for (let i = 0; i < size;) {
    const first = matchStarts[i];
    const last = matchStarts[i + 1];
    const match = last > first ? matchCache[last - 1] : 0;
    const available = match === 0 ? 0 : Math.min(match >>> 16, size - i);
    const len = available >= MIN_MATCH ? available : 1;
    tLen[initialCount] = len === 1 ? data[start + i] : len;
    tDist[initialCount++] = len === 1 ? 0 : (match & 0xffff) + 1;
    i += len;
  }
  const initialCounter = new SizeCounter(Infinity);
  emitBlock(initialCounter, false, data, start, end, initialCount, true);
  // Seed the cost model from this block's actual symbols, and retain the
  // greedy parse if none of the subsequent Huffman-cost passes improves it.
  let literalCosts: Uint8Array = trialLiteralCosts;
  let distanceCosts: Uint8Array = trialDistanceCosts;
  let bestSize = initialCounter.bitLength();
  let bestCount = initialCount;
  bestLenTokens.set(tLen.subarray(0, initialCount));
  bestDistTokens.set(tDist.subarray(0, initialCount));
  for (let pass = 0; pass < passes; pass++) {
    for (let len = MIN_MATCH; len <= MAX_MATCH; len++) {
      lengthCosts[len] = (literalCosts[lenSym[len]] || 12) + lenExtraCnt[len];
    }
    pathCost[size] = 0;
    for (let i = size - 1; i >= 0; i--) {
      let cost = (literalCosts[data[start + i]] || 12) + pathCost[i + 1];
      let length = 1;
      let distance = 0;
      let minLength = MIN_MATCH;
      for (let m = matchStarts[i]; m < matchStarts[i + 1]; m++) {
        const match = matchCache[m];
        // A full cache can end the block earlier than the matcher expected.
        const max = Math.min(match >>> 16, size - i);
        const dist = (match & 0xffff) + 1;
        const distanceCost = (distanceCosts[distSym[dist]] || 12) + distExtraCnt[dist];
        for (let len = minLength; len <= max; len++) {
          const trial = lengthCosts[len] + distanceCost + pathCost[i + len];
          if (trial < cost) {
            cost = trial;
            length = len;
            distance = dist;
          }
        }
        minLength = max + 1;
      }
      pathCost[i] = cost;
      pathLen[i] = length;
      matchDist[i] = distance;
    }
    let count = 0;
    for (let i = 0; i < size;) {
      const len = pathLen[i];
      tLen[count] = len === 1 ? data[start + i] : len;
      tDist[count] = matchDist[i];
      count++;
      i += len;
    }
    const counter = new SizeCounter(Infinity);
    emitBlock(counter, false, data, start, end, count, true);
    const bits = counter.bitLength();
    const improvement = bestSize - bits;
    if (bits < bestSize) {
      bestSize = bits;
      bestCount = count;
      bestLenTokens.set(tLen.subarray(0, count));
      bestDistTokens.set(tDist.subarray(0, count));
    }
    if (pass > 0 && improvement < minImprovement) break;
    literalCosts = trialLiteralCosts;
    distanceCosts = trialDistanceCosts;
  }
  tLen.set(bestLenTokens.subarray(0, bestCount));
  tDist.set(bestDistTokens.subarray(0, bestCount));
  return bestCount;
}

/** Split when the byte distribution changes; otherwise amortize block headers. */
function optimalBlockEnd(data: Uint8Array, start: number): number {
  const limit = Math.min(start + OPT_BLOCK_SIZE, data.length);
  blockHistogram.fill(0);
  let total = 0;
  for (let pos = start; pos < limit; pos += BLOCK_OBSERVATION) {
    const end = Math.min(pos + BLOCK_OBSERVATION, limit);
    const observed = end - pos;
    observationHistogram.fill(0);
    for (let i = pos; i < end; i++) observationHistogram[data[i]]++;
    if (total >= MIN_OPT_BLOCK_SIZE && observed >= BLOCK_OBSERVATION / 2) {
      let difference = 0;
      for (let s = 0; s < 256; s++) {
        difference += Math.abs(observationHistogram[s] * total - blockHistogram[s] * observed);
      }
      // L1 distance > 0.4, measured without normalization or floating division.
      if (difference * 5 > total * observed * 2) return pos;
    }
    for (let s = 0; s < 256; s++) blockHistogram[s] += observationHistogram[s];
    total += observed;
  }
  return limit;
}

/** High levels cache matches once, then optimize the literal/match path. */
function deflateOptimal(bw: BitWriter | SizeCounter, data: Uint8Array, view: DataView, level: number): void {
  const depth = level >= 12 ? 128 : level >= 11 ? 64 : 32;
  const nice = level >= 12 ? MAX_MATCH : 128;
  const skipLength = level >= 12 ? 128 : 32;
  for (let start = 0; start < data.length;) {
    let end = optimalBlockEnd(data, start);
    cacheCount = 0;
    for (let pos = start; pos < end;) {
      // Reserve the worst-case 256 length records before inserting a position.
      if (cacheCount + MAX_MATCH >= matchCache.length) {
        end = pos;
        break;
      }
      matchStarts[pos - start] = cacheCount;
      const len = cacheMatches(data, view, pos, end, depth, nice, true, 0, 0);
      const next = len >= skipLength ? pos + len : pos + 1;
      const distance = cacheCount > matchStarts[pos - start] ? (matchCache[cacheCount - 1] & 0xffff) + 1 : 0;
      // Update every tree position while skipping long-match interiors in
      // the parse cache. The known suffix avoids comparing the same run again.
      for (let p = pos + 1; p < next; p++) {
        matchStarts[p - start] = cacheCount;
        cacheMatches(data, view, p, end, depth, nice, false, distance, next - p);
      }
      matchStarts[next - start] = cacheCount;
      pos = next;
    }
    matchStarts[end - start] = cacheCount;
    const count = optimalTokens(data, start, end, level >= 12 ? 4 : 3, level >= 12 ? 1 : level >= 11 ? 16 : 32);
    emitBlock(bw, end === data.length, data, start, end, count);
    start = end;
  }
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
  collectCosts = false,
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
  if (collectCosts) trialLiteralCosts.set(litLen);
  makeComplete(litLen.subarray(0, hlit));

  let hdist = 30;
  while (hdist > 1 && distFreq[hdist - 1] === 0) hdist--;
  if (hdist < 2) hdist = 2; // a valid Huffman code needs at least two symbols
  const distLen = limitedLengths(distFreq, 15);
  if (collectCosts) trialDistanceCosts.set(distLen);
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
    head3Epoch.fill(0);
    head4Epoch.fill(0);
    epoch = 1;
  }
  wideMatches = level >= 7;
  if (level >= 10 && n >= 4) {
    deflateOptimal(bw, data, view!, level);
    return;
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
        m = wideMatches ? findWideMatch(data, view!, n, pos, chain, nice) : findMatch(data, view!, n, pos, chain, nice, true);
      }
      let len = m >>> 16;
      let dist = (m & 0xffff) + 1;
      let insertedNext = false;
      if (lazy && len >= MIN_MATCH && len < nice && pos + 1 < n) {
        // Look ahead one position (inserting it into chains). If it yields a
        // longer match, emit the current byte as a literal and carry the
        // lookahead result.
        const m2 = wideMatches ? findWideMatch(data, view!, n, pos + 1, chain, nice) : findMatch(data, view!, n, pos + 1, chain, nice, true);
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
