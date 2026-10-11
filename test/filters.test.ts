import { describe, expect, it, vi } from 'vitest';
import * as compression from '../src/deflate/index.ts';
import {
  AVERAGE,
  BigEnt,
  Bigrams,
  Brute,
  Entropy,
  MinSum,
  NONE,
  Options,
  PAETH,
  SUB,
  UP,
  optimizeFromMemory,
  deflateRaw,
  strategyEvaluator,
  type FilterStrategy,
} from '../src/index.ts';
import { decodePng, headerInfo, readFixture } from './helpers.ts';
import cases from './filter-cases.json';

describe('Brute size-bound ranking', () => {
  it('preserves strict size ranking, reset, and rolling-window behavior', () => {
    const evaluator = strategyEvaluator(Brute(3, 5))!;
    const data = new Uint8Array(10000);
    let state = 123456789;
    for (let i = 0; i < data.length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[i] = state >>> 24;
    }
    for (const lineLen of [257, 4000]) {
      evaluator.reset(lineLen);
      let best = Infinity;
      for (const buf of [new Uint8Array(10000), data, data.subarray(17), new Uint8Array(10000), data]) {
        const start = Math.max(0, buf.length - 3 * lineLen);
        const size = deflateRaw(buf.subarray(start), 5).length;
        const expected = size < best;
        expect(evaluator.evaluate(buf, 0, buf.length)).toBe(expected);
        if (expected) best = size;
      }
    }
  });

  it('propagates failures other than output-size exhaustion', () => {
    const evaluator = strategyEvaluator(Brute(3, 5))!;
    evaluator.reset(32);
    const failure = new Error('encoder failed');
    const spy = vi.spyOn(compression, 'deflateRawSize').mockImplementationOnce(() => { throw failure; });
    try {
      expect(() => evaluator.evaluate(new Uint8Array(32), 0, 32)).toThrow(failure);
    } finally {
      spy.mockRestore();
    }
  });
});

interface FilterArg {
  kind: string;
  args: string | null;
}

interface Case {
  name: string;
  file: string;
  ctIn: number;
  depthIn: number;
  ctOut: number;
  depthOut: number;
  filter: FilterArg;
  interlace?: boolean;
}

function resolveFilter(f: FilterArg): FilterStrategy {
  switch (f.kind) {
    case 'NONE':
      return NONE;
    case 'SUB':
      return SUB;
    case 'UP':
      return UP;
    case 'AVERAGE':
      return AVERAGE;
    case 'PAETH':
      return PAETH;
    case 'MinSum':
      return MinSum;
    case 'Entropy':
      return Entropy;
    case 'Bigrams':
      return Bigrams;
    case 'BigEnt':
      return BigEnt;
    case 'Brute': {
      const numLines = Number(/num_lines:\s*(\d+)/.exec(f.args ?? '')?.[1] ?? 3);
      const level = Number(/level:\s*(\d+)/.exec(f.args ?? '')?.[1] ?? 1);
      return Brute(numLines, level);
    }
    default:
      throw new Error(`unknown filter ${f.kind}`);
  }
}

describe('filter strategies (mirrors tests/strategies.rs)', () => {
  for (const c of cases.strategies as Case[]) {
    it(c.name, () => {
      const input = readFixture(c.file);
      const opts = new Options();
      opts.force = true;
      opts.filters = [resolveFilter(c.filter)];

      expect({ colorType: headerInfo(input).colorType, bitDepth: headerInfo(input).bitDepth }).toEqual({
        colorType: c.ctIn,
        bitDepth: c.depthIn,
      });

      const output = optimizeFromMemory(input, opts);
      const out = headerInfo(output);
      expect({ colorType: out.colorType, bitDepth: out.bitDepth }).toEqual({ colorType: c.ctOut, bitDepth: c.depthOut });
      expect(() => decodePng(output)).not.toThrow();
    });
  }
});

describe('alpha optimization (mirrors tests/alpha.rs)', () => {
  for (const c of cases.alpha as Case[]) {
    it(c.name, () => {
      const input = readFixture(c.file);
      const opts = new Options();
      opts.force = true;
      opts.optimizeAlpha = true;
      opts.filters = [resolveFilter(c.filter)];

      expect({ colorType: headerInfo(input).colorType, bitDepth: headerInfo(input).bitDepth }).toEqual({
        colorType: c.ctIn,
        bitDepth: c.depthIn,
      });

      const output = optimizeFromMemory(input, opts);
      const out = headerInfo(output);
      expect({ colorType: out.colorType, bitDepth: out.bitDepth }).toEqual({ colorType: c.ctOut, bitDepth: c.depthOut });
      expect(() => decodePng(output)).not.toThrow();
    });
  }
});

describe('interlacing (mirrors tests/interlacing.rs)', () => {
  for (const c of cases.interlacing as Case[]) {
    it(c.name, () => {
      const input = readFixture(c.file);
      const opts = new Options();
      opts.force = true;
      opts.filters = [NONE];
      opts.interlace = c.interlace!;

      const inputHeader = headerInfo(input);
      expect({ colorType: inputHeader.colorType, bitDepth: inputHeader.bitDepth }).toEqual({
        colorType: c.ctIn,
        bitDepth: c.depthIn,
      });
      expect(inputHeader.interlaced).toBe(!c.interlace);

      const output = optimizeFromMemory(input, opts);
      const out = headerInfo(output);
      expect({ colorType: out.colorType, bitDepth: out.bitDepth }).toEqual({ colorType: c.ctOut, bitDepth: c.depthOut });
      expect(out.interlaced).toBe(c.interlace);
      expect(() => decodePng(output)).not.toThrow();
    });
  }
});
