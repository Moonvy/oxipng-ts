/** Huffman code construction for the DEFLATE encoder. */

// DEFLATE has at most 286 literal/length symbols (30 distance, 19 code-length),
// so all Huffman working buffers have a fixed upper bound and can be shared
// scratch (the encoder is synchronous, so this is safe).
const MAX_SYMBOLS = 286;
const hWeight = new Float64Array(2 * MAX_SYMBOLS);
const hParent = new Int32Array(2 * MAX_SYMBOLS);
const hHeap = new Int32Array(2 * MAX_SYMBOLS);
const hSyms = new Int32Array(MAX_SYMBOLS);
let hHeapSize = 0;

function hLess(a: number, b: number): boolean {
  return hWeight[a] < hWeight[b] || (hWeight[a] === hWeight[b] && a < b);
}

function hPush(x: number): void {
  let i = hHeapSize++;
  hHeap[i] = x;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!hLess(hHeap[i], hHeap[p])) break;
    const tmp = hHeap[i];
    hHeap[i] = hHeap[p];
    hHeap[p] = tmp;
    i = p;
  }
}

function hPop(): number {
  const top = hHeap[0];
  hHeapSize--;
  hHeap[0] = hHeap[hHeapSize];
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    if (l < hHeapSize && hLess(hHeap[l], hHeap[m])) m = l;
    if (r < hHeapSize && hLess(hHeap[r], hHeap[m])) m = r;
    if (m === i) break;
    const tmp = hHeap[i];
    hHeap[i] = hHeap[m];
    hHeap[m] = tmp;
    i = m;
  }
  return top;
}

/**
 * Optimal code lengths for the given frequencies (heap-based Huffman), with an
 * optional `add` constant folded into every nonzero frequency.
 */
export function optimalLengths(freq: Uint32Array, add: number): Uint8Array {
  const n = freq.length;
  const lens = new Uint8Array(n);

  let k = 0;
  for (let i = 0; i < n; i++) if (freq[i] > 0) hSyms[k++] = i;
  if (k === 0) return lens;
  if (k === 1) {
    lens[hSyms[0]] = 1;
    return lens;
  }

  const N = 2 * k;
  hParent.fill(-1, 0, N);
  for (let i = 0; i < k; i++) hWeight[i] = freq[hSyms[i]] + add;

  hHeapSize = 0;
  for (let i = 0; i < k; i++) hPush(i);
  let next = k;
  while (hHeapSize > 1) {
    const a = hPop();
    const b = hPop();
    const node = next++;
    hWeight[node] = hWeight[a] + hWeight[b];
    hParent[a] = node;
    hParent[b] = node;
    hPush(node);
  }

  for (let i = 0; i < k; i++) {
    let d = 0;
    let node = i;
    while (hParent[node] !== -1) {
      d++;
      node = hParent[node];
    }
    lens[hSyms[i]] = d;
  }
  return lens;
}

/** Code lengths bounded by `maxBits` (flattens frequencies as little as possible). */
export function limitedLengths(freq: Uint32Array, maxBits: number): Uint8Array {
  const direct = optimalLengths(freq, 0);
  let max = 0;
  for (let i = 0; i < direct.length; i++) if (direct[i] > max) max = direct[i];
  if (max <= maxBits) return direct;

  let total = 0;
  for (let i = 0; i < freq.length; i++) total += freq[i];
  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const lens = optimalLengths(freq, mid);
    let m = 0;
    for (let i = 0; i < lens.length; i++) if (lens[i] > m) m = lens[i];
    if (m <= maxBits) hi = mid;
    else lo = mid + 1;
  }
  return optimalLengths(freq, lo);
}

/** Make a length set a complete code (at least two codewords) so decoders accept it. */
export function makeComplete(lens: Uint8Array): void {
  let count = 0;
  let first = -1;
  for (let i = 0; i < lens.length; i++) {
    if (lens[i] !== 0) {
      count++;
      if (first < 0) first = i;
    }
  }
  if (count === 0) {
    lens[0] = 1;
    lens[1] = 1;
  } else if (count === 1) {
    for (let i = 0; i < lens.length; i++) {
      if (i !== first) {
        lens[i] = 1;
        break;
      }
    }
  }
}

export interface CodeSet {
  lengths: Uint8Array;
  /** Canonical codes, indexed by symbol (MSB-first numeric value). */
  codes: Uint16Array;
  /** `codes` with their bits reversed, ready for LSB-first writing. */
  rev: Uint16Array;
  maxLen: number;
}

// 8-bit bit-reversal table; a ≤15-bit reversal is two lookups plus a shift.
const REV8 = new Uint8Array(256);
for (let i = 1; i < 256; i++) REV8[i] = (REV8[i >> 1] >> 1) | ((i & 1) << 7);

function reverseBits(code: number, len: number): number {
  return ((REV8[code & 0xff] << 8) | REV8[(code >> 8) & 0xff]) >>> (16 - len);
}

// Shared scratch for buildCodes (max code length is 15).
const blCountS = new Uint16Array(16);
const nextCodeS = new Uint16Array(16);

/** Assign canonical codes for the given lengths. */
export function buildCodes(lengths: Uint8Array): CodeSet {
  let maxLen = 0;
  for (let i = 0; i < lengths.length; i++) if (lengths[i] > maxLen) maxLen = lengths[i];
  const blCount = blCountS.fill(0, 0, maxLen + 1);
  for (let i = 0; i < lengths.length; i++) blCount[lengths[i]]++;
  blCount[0] = 0;
  const nextCode = nextCodeS;
  let code = 0;
  for (let b = 1; b <= maxLen; b++) {
    code = (code + blCount[b - 1]) << 1;
    nextCode[b] = code;
  }
  const codes = new Uint16Array(lengths.length);
  const rev = new Uint16Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) {
    const l = lengths[s];
    if (l === 0) continue;
    const c = nextCode[l]++;
    codes[s] = c;
    rev[s] = reverseBits(c, l);
  }
  return { lengths, codes, rev, maxLen };
}
