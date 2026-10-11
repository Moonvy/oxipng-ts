import type { Deflater } from './deflate/index.ts';
import { deflaterEquals, libdeflater } from './deflate/index.ts';
import type { StripChunks } from './headers.ts';
import {
  BigEnt,
  Bigrams,
  Brute,
  Entropy,
  NONE,
  SUB,
  UP,
  AVERAGE,
  PAETH,
  MinSum,
  type FilterStrategy,
} from './filters/strategies.ts';
import { filterSetFrom } from './util/filterSet.ts';

/**
 * Options controlling the output of the {@link optimizeFromMemory} /
 * {@link oxipng} functions.
 */
export class Options {
  /** Attempt to fix errors when decoding the input file rather than returning an error. */
  fixErrors = false;
  /** Write to output even if there was no improvement in compression. */
  force = false;
  /** Which {@link FilterStrategy} values to try on the file. */
  filters: FilterStrategy[] = [NONE, SUB, Entropy, Bigrams];
  /** Whether to change the interlacing of the file (`null` keeps the current mode). */
  interlace: boolean | null = false;
  /** Whether to allow transparent pixels to be altered to improve compression. */
  optimizeAlpha = false;
  /** Whether to attempt bit depth reduction. */
  bitDepthReduction = true;
  /** Whether to attempt colour type reduction. */
  colorTypeReduction = true;
  /** Whether to attempt palette reduction. */
  paletteReduction = true;
  /** Whether to attempt grayscale reduction. */
  grayscaleReduction = true;
  /** Whether to perform recoding of IDAT and other compressed chunks. */
  idatRecoding = true;
  /** Whether to forcibly reduce 16-bit to 8-bit by scaling (lossy). */
  scale16 = false;
  /** Which chunks to strip from the PNG file, if any. */
  strip: StripChunks = { mode: 'none' };
  /** Which DEFLATE algorithm to use for the main trials. */
  deflater: Deflater = libdeflater(11);
  /** Whether to use fast evaluation to pick the best filter. */
  fastEvaluation = true;
  /** Maximum amount of time (in seconds) to spend on optimizations. */
  timeout: number | null = null;
  /** Maximum decompressed size of the input IDAT. */
  maxDecompressedSize: number | null = null;

  static default(): Options {
    return new Options();
  }

  clone(): Options {
    const o = new Options();
    o.fixErrors = this.fixErrors;
    o.force = this.force;
    o.filters = this.filters.map((f) => cloneFilter(f));
    o.interlace = this.interlace;
    o.optimizeAlpha = this.optimizeAlpha;
    o.bitDepthReduction = this.bitDepthReduction;
    o.colorTypeReduction = this.colorTypeReduction;
    o.paletteReduction = this.paletteReduction;
    o.grayscaleReduction = this.grayscaleReduction;
    o.idatRecoding = this.idatRecoding;
    o.scale16 = this.scale16;
    o.strip = cloneStrip(this.strip);
    o.deflater = this.deflater;
    o.fastEvaluation = this.fastEvaluation;
    o.timeout = this.timeout;
    o.maxDecompressedSize = this.maxDecompressedSize;
    return o;
  }

  static fromPreset(level: number): Options {
    switch (level) {
      case 0:
        return preset0();
      case 1:
        return preset1();
      case 2:
        return new Options();
      case 3:
        return preset3();
      case 4:
        return preset4();
      case 5:
        return preset5();
      case 6:
        return preset6();
      default:
        return preset6();
    }
  }

  static maxCompression(): Options {
    return Options.fromPreset(6);
  }
}

function cloneFilter(f: FilterStrategy): FilterStrategy {
  if (f.kind === 'predefined') return { kind: 'predefined', lines: [...f.lines] };
  if (f.kind === 'brute') return { kind: 'brute', numLines: f.numLines, level: f.level };
  return { ...f };
}

function cloneStrip(strip: StripChunks): StripChunks {
  if (strip.mode === 'strip' || strip.mode === 'keep') return { mode: strip.mode, names: new Set(strip.names) };
  return { ...strip };
}

function preset0(): Options {
  const o = new Options();
  o.filters = filterSetFrom([NONE, MinSum]);
  o.deflater = libdeflater(5);
  return o;
}

function preset1(): Options {
  const o = new Options();
  o.filters = filterSetFrom([NONE, Bigrams]);
  o.deflater = libdeflater(10);
  return o;
}

function preset3(): Options {
  const o = new Options();
  o.filters = filterSetFrom([NONE, SUB, Entropy, Bigrams, BigEnt, Brute(3, 1)]);
  return o;
}

function preset4(): Options {
  const o = new Options();
  o.filters = filterSetFrom([NONE, SUB, Entropy, Bigrams, BigEnt, Brute(4, 1)]);
  o.deflater = libdeflater(12);
  return o;
}

function preset5(): Options {
  const o = new Options();
  o.fastEvaluation = false;
  o.filters = filterSetFrom([NONE, SUB, Entropy, Bigrams, BigEnt, Brute(8, 1)]);
  o.deflater = libdeflater(12);
  return o;
}

function preset6(): Options {
  const o = new Options();
  o.fastEvaluation = false;
  o.filters = filterSetFrom([NONE, SUB, UP, AVERAGE, PAETH, MinSum, Entropy, Bigrams, BigEnt, Brute(8, 5)]);
  o.deflater = libdeflater(12);
  return o;
}

export { deflaterEquals };
