import { colorTypeToString } from './colors.ts';
import type { Deadline } from './deadline.ts';
import { AtomicMin } from './deadline.ts';
import { deflaterDeflate, deflaterDeflateSize, type Deflater } from './deflate/index.ts';
import { PngError } from './error.ts';
import { filterStrategyCompare, type FilterStrategy } from './filters/strategies.ts';
import type { PngImage } from './png/index.ts';

export interface Candidate {
  image: PngImage;
  idatData: Uint8Array | null;
  estimatedOutputSize: number;
  /** The input filter, retained for printing and APNG frames. */
  filter: FilterStrategy;
  /** The filter returned by the filtering function (may be Predefined). */
  filterUsed: FilterStrategy;
  nth: number;
  /** Retain only the winning filtered stream for the final compression round. */
  filteredData?: Uint8Array;
  filteredOptimizeAlpha?: boolean;
}

function cmpKey(c: Candidate): [number, number, FilterStrategy, number] {
  return [c.estimatedOutputSize, c.image.data.length, c.filter, Number.MAX_SAFE_INTEGER - c.nth];
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const ka = cmpKey(a);
  const kb = cmpKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  const fc = filterStrategyCompare(ka[2], kb[2]);
  if (fc !== 0) return fc;
  return ka[3] - kb[3];
}

/** Collects image versions and picks the one that compresses best. */
export class Evaluator {
  private nth = 0;
  private readonly bestCandidateSize: AtomicMin;
  private best: Candidate | null = null;

  private readonly deadline: Deadline;
  private readonly filters: FilterStrategy[];
  private readonly deflater: Deflater;
  private readonly optimizeAlpha: boolean;
  private readonly finalRound: boolean;
  private readonly trace: (msg: string) => void;
  constructor(
    deadline: Deadline,
    filters: FilterStrategy[],
    deflater: Deflater,
    optimizeAlpha: boolean,
    finalRound: boolean,
    trace: (msg: string) => void = () => {},
  ) {
    this.deadline = deadline;
    this.filters = filters;
    this.deflater = deflater;
    this.optimizeAlpha = optimizeAlpha;
    this.finalRound = finalRound;
    this.trace = trace;
    this.bestCandidateSize = new AtomicMin(null);
  }

  /** Set the best size if known in advance. */
  setBestSize(size: number): void {
    this.bestCandidateSize.setMin(size);
  }

  /** Check if the image is smaller than others. */
  tryImage(image: PngImage): void {
    this.tryImageWithDescription(image, colorTypeToString(image.ihdr.colorType));
  }

  /** Check if the image is smaller than others, with a description for verbose mode. */
  tryImageWithDescription(image: PngImage, description: string): void {
    const nth = this.nth++;
    const keyChunksSize = image.keyChunksSize();
    for (const filter of this.filters) {
      if (this.deadline.passed()) return;
      const [filtered, filterUsed] = image.filterImage(filter, this.optimizeAlpha);
      let idatData: Uint8Array | null = null;
      let idatSize: number;
      try {
        const bestSize = this.bestCandidateSize.get();
        const limit = bestSize === null ? undefined : bestSize - keyChunksSize;
        if (limit !== undefined && limit < 0) continue;
        if (this.finalRound) {
          idatData = deflaterDeflate(this.deflater, filtered, limit);
          idatSize = idatData.length;
        } else {
          idatSize = deflaterDeflateSize(this.deflater, filtered, limit);
        }
      } catch (err) {
        if (err instanceof PngError && err.kind === 'DeflatedDataTooLong') {
          this.trace(`Eval: ${image.ihdr.bitDepth}-bit ${description} >${err.size} bytes`);
        }
        continue;
      }
      const estimatedOutputSize = idatSize + keyChunksSize;
      this.trace(`Eval: ${image.ihdr.bitDepth}-bit ${description} ${estimatedOutputSize} bytes`);

      const bestSize = this.bestCandidateSize.get();
      if (bestSize !== null && estimatedOutputSize > bestSize) continue;

      const candidate: Candidate = {
        image,
        idatData,
        estimatedOutputSize,
        filter,
        filterUsed,
        nth,
        filteredData: this.finalRound ? undefined : filtered,
        filteredOptimizeAlpha: this.optimizeAlpha,
      };
      this.bestCandidateSize.setMin(estimatedOutputSize);
      if (this.best === null || compareCandidates(this.best, candidate) >= 0) {
        this.best = candidate;
      }
    }
  }

  /** Return the smallest candidate found, or null. */
  getBestCandidate(): Candidate | null {
    return this.best;
  }
}
