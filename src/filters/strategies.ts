import { deflateRawSize } from '../deflate/index.js';
import { RowFilter, rowFilterName, type RowFilter as RowFilterType } from './index.js';

/** Filtering strategy for use in {@link Options}. */
export type FilterStrategy =
  | { kind: 'basic'; filter: RowFilterType }
  | { kind: 'minSum' }
  | { kind: 'entropy' }
  | { kind: 'bigrams' }
  | { kind: 'bigEnt' }
  | { kind: 'brute'; numLines: number; level: number }
  | { kind: 'predefined'; lines: RowFilterType[] };

export const basic = (filter: RowFilterType): FilterStrategy => ({ kind: 'basic', filter });
export const NONE = /* @__PURE__ */ basic(RowFilter.None);
export const SUB = /* @__PURE__ */ basic(RowFilter.Sub);
export const UP = /* @__PURE__ */ basic(RowFilter.Up);
export const AVERAGE = /* @__PURE__ */ basic(RowFilter.Average);
export const PAETH = /* @__PURE__ */ basic(RowFilter.Paeth);
export const MinSum: FilterStrategy = { kind: 'minSum' };
export const Entropy: FilterStrategy = { kind: 'entropy' };
export const Bigrams: FilterStrategy = { kind: 'bigrams' };
export const BigEnt: FilterStrategy = { kind: 'bigEnt' };
export const Brute = (numLines: number, level: number): FilterStrategy => ({ kind: 'brute', numLines, level });
export const Predefined = (lines: RowFilterType[]): FilterStrategy => ({ kind: 'predefined', lines });

export function filterStrategyKey(fs: FilterStrategy): string {
  switch (fs.kind) {
    case 'basic':
      return `b${fs.filter}`;
    case 'brute':
      return `brute:${fs.numLines}:${fs.level}`;
    case 'predefined':
      return `p:${fs.lines.join(',')}`;
    default:
      return fs.kind;
  }
}

function kindOrder(fs: FilterStrategy): number {
  switch (fs.kind) {
    case 'basic':
      return 0;
    case 'minSum':
      return 1;
    case 'entropy':
      return 2;
    case 'bigrams':
      return 3;
    case 'bigEnt':
      return 4;
    case 'brute':
      return 5;
    case 'predefined':
      return 6;
  }
}

export function filterStrategyCompare(a: FilterStrategy, b: FilterStrategy): number {
  const ka = kindOrder(a);
  const kb = kindOrder(b);
  if (ka !== kb) return ka - kb;
  if (a.kind === 'basic' && b.kind === 'basic') return a.filter - b.filter;
  if (a.kind === 'brute' && b.kind === 'brute') {
    if (a.numLines !== b.numLines) return a.numLines - b.numLines;
    return a.level - b.level;
  }
  if (a.kind === 'predefined' && b.kind === 'predefined') {
    const n = Math.min(a.lines.length, b.lines.length);
    for (let i = 0; i < n; i++) if (a.lines[i] !== b.lines[i]) return a.lines[i] - b.lines[i];
    return a.lines.length - b.lines.length;
  }
  return 0;
}

export function filterStrategyEquals(a: FilterStrategy, b: FilterStrategy): boolean {
  return filterStrategyKey(a) === filterStrategyKey(b);
}

export function filterStrategyToString(fs: FilterStrategy): string {
  switch (fs.kind) {
    case 'basic':
      return rowFilterName(fs.filter);
    case 'minSum':
      return 'MinSum';
    case 'entropy':
      return 'Entropy';
    case 'bigrams':
      return 'Bigrams';
    case 'bigEnt':
      return 'BigEnt';
    case 'brute':
      return 'Brute';
    case 'predefined':
      return 'Predefined';
  }
}

export interface StrategyEvaluator {
  /** Reset any per-line state. */
  reset(lineLen: number): void;
  /** Evaluate a filter attempt, returning true if it is the best so far. */
  evaluate(buf: Uint8Array, offset: number, end: number): boolean;
}

/** For heuristic strategies, get an evaluator to pick the best filter per row. */
export function strategyEvaluator(fs: FilterStrategy): StrategyEvaluator | null {
  switch (fs.kind) {
    case 'minSum':
      return new MinSumEvaluator();
    case 'entropy':
      return new EntropyEvaluator();
    case 'bigrams':
      return new BigramsEvaluator();
    case 'bigEnt':
      return new BigEntEvaluator();
    case 'brute':
      return new BruteEvaluator(fs.numLines, fs.level);
    default:
      return null;
  }
}

/** Integer approximation of `i * log2(i)`, matching oxipng's fast version. */
function ilog2i(i: number): number {
  const log = 31 - Math.clz32(i);
  return i * log + ((i - (1 << log)) << 1);
}

class MinSumEvaluator implements StrategyEvaluator {
  private bestSize = Number.MAX_SAFE_INTEGER;
  reset(): void {
    this.bestSize = Number.MAX_SAFE_INTEGER;
  }
  evaluate(buf: Uint8Array, offset: number, end: number): boolean {
    let size = 0;
    for (let i = offset; i < end; i++) {
      const signed = (buf[i] << 24) >> 24;
      size += Math.abs(signed);
    }
    if (size < this.bestSize) {
      this.bestSize = size;
      return true;
    }
    return false;
  }
}

class EntropyEvaluator implements StrategyEvaluator {
  private readonly hist = new Uint32Array(256);
  private bestSize = -0x80000000;
  reset(): void {
    this.bestSize = -0x80000000;
  }
  evaluate(buf: Uint8Array, offset: number, end: number): boolean {
    const hist = this.hist;
    hist.fill(0);
    let i = offset;
    for (; i + 4 <= end; i += 4) {
      hist[buf[i]]++;
      hist[buf[i + 1]]++;
      hist[buf[i + 2]]++;
      hist[buf[i + 3]]++;
    }
    for (; i < end; i++) hist[buf[i]]++;
    let size = 0;
    for (let k = 0; k < 256; k++) {
      const x = hist[k];
      if (x !== 0) size += ilog2i(x);
    }
    if (size > this.bestSize) {
      this.bestSize = size;
      return true;
    }
    return false;
  }
}

class BigramsEvaluator implements StrategyEvaluator {
  private seen = new Uint8Array(0x10000);
  private touched: number[] = [];
  private bestSize = Number.MAX_SAFE_INTEGER;
  reset(): void {
    this.bestSize = Number.MAX_SAFE_INTEGER;
  }
  evaluate(buf: Uint8Array, offset: number, end: number): boolean {
    for (let i = 0; i < this.touched.length; i++) this.seen[this.touched[i]] = 0;
    this.touched.length = 0;
    let count = 0;
    for (let i = offset; i + 1 < end; i++) {
      const bigram = (buf[i] << 8) | buf[i + 1];
      if (this.seen[bigram] === 0) {
        count++;
        if (count >= this.bestSize) return false;
        this.seen[bigram] = 1;
        this.touched.push(bigram);
      }
    }
    this.bestSize = count;
    return true;
  }
}

class BigEntEvaluator implements StrategyEvaluator {
  private seen = new Uint32Array(0x10000);
  private touched: number[] = [];
  private bestSize = -0x80000000;
  reset(): void {
    this.bestSize = -0x80000000;
  }
  evaluate(buf: Uint8Array, offset: number, end: number): boolean {
    for (let i = offset; i + 1 < end; i++) {
      const bigram = (buf[i] << 8) | buf[i + 1];
      if (this.seen[bigram] === 0) this.touched.push(bigram);
      this.seen[bigram]++;
    }
    let size = 0;
    for (let i = 0; i < this.touched.length; i++) {
      const idx = this.touched[i];
      size += ilog2i(this.seen[idx]);
      this.seen[idx] = 0;
    }
    this.touched.length = 0;
    if (size > this.bestSize) {
      this.bestSize = size;
      return true;
    }
    return false;
  }
}

class BruteEvaluator implements StrategyEvaluator {
  private limit = 0;
  private bufferSize = Number.MAX_SAFE_INTEGER;
  constructor(
    private numLines: number,
    private level: number,
  ) {}
  reset(lineLen: number): void {
    this.limit = lineLen * this.numLines;
    this.bufferSize = Number.MAX_SAFE_INTEGER;
  }
  evaluate(buf: Uint8Array, _offset: number, end: number): boolean {
    const start = Math.max(0, end - this.limit);
    const size = deflateRawSize(buf.subarray(start, end), this.level, this.bufferSize);
    if (size === null) return false;
    this.bufferSize = size - 1;
    return true;
  }
}
