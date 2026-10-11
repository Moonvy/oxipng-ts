import { BitDepth, rgba8, rgba8A, rgba8B, rgba8G, rgba8R, type RGBA8 } from '../colors.js';
import { PngImage } from '../png/index.js';
import { NumberIndexSet } from '../util/numberSet.js';

const BLACK = rgba8(0, 0, 0, 255);

/** Attempt to reduce the number of colours in the palette. */
export function reducedPalette(png: PngImage, optimizeAlpha: boolean): PngImage | null {
  if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
  const ct = png.ihdr.colorType;
  if (ct.kind !== 'indexed') return null;
  const palette = ct.palette;

  const used = new Uint8Array(256);
  for (let i = 0; i < png.data.length; i++) used[png.data[i]] = 1;

  const condensed = new NumberIndexSet();
  const byteMap = new Uint8Array(256);
  let didChange = false;
  for (let i = 0; i < 256; i++) {
    if (!used[i]) continue;
    let color: number = palette[i] ?? BLACK;
    if (optimizeAlpha && rgba8A(color) === 0) color = rgba8(0, 0, 0, 0);
    const [idx] = condensed.insertFull(color);
    byteMap[i] = idx;
    if (idx !== i) didChange = true;
  }

  let data: Uint8Array;
  if (didChange) {
    data = new Uint8Array(png.data.length);
    for (let i = 0; i < png.data.length; i++) data[i] = byteMap[png.data[i]];
  } else if (condensed.size !== palette.length) {
    data = png.data.slice();
  } else {
    return null;
  }

  return new PngImage({ ...png.ihdr, colorType: { kind: 'indexed', palette: condensed.toArray() } }, data);
}

/** Attempt to sort the colours in the palette by luma. */
export function sortedPalette(png: PngImage): PngImage | null {
  if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
  const ct = png.ihdr.colorType;
  if (ct.kind !== 'indexed' || ct.palette.length <= 1) return null;
  const palette = ct.palette;

  const enumerated: Array<[number, number]> = palette.map((c, i) => [i, c]);
  const keepFirst = mostPopularEdgeColor(palette.length, png);
  const first = keepFirst === null ? null : enumerated.splice(keepFirst, 1)[0];

  enumerated.sort((a, b) => colorValue(a[1]) - colorValue(b[1]));
  if (first) enumerated.unshift(first);

  const remapping = enumerated.map((e) => e[0]);
  const newPalette = enumerated.map((e) => e[1]);
  if (remapping.every((v, i) => v === i)) return null;

  const byteMap = new Uint8Array(256);
  for (let i = 0; i < remapping.length; i++) byteMap[remapping[i]] = i;
  const data = new Uint8Array(png.data.length);
  for (let i = 0; i < png.data.length; i++) data[i] = byteMap[png.data[i]];

  return new PngImage({ ...png.ihdr, colorType: { kind: 'indexed', palette: newPalette } }, data);
}

/** Sort the palette using the ezeng technique. */
export function sortedPaletteEzeng(png: PngImage, matrix: CoOccurrenceMatrix, maxSwapDist: number): PngImage | null {
  const remapping = ezengReindex(matrix);
  pairwiseSwapSearch(remapping, matrix, maxSwapDist);
  applyMostPopularColor(remapping, matrix, Math.floor((png.data.length * 3) / 20));
  return applyPaletteReorder(png, remapping);
}

/** Sort the palette using the battiato technique. */
export function sortedPaletteBattiato(png: PngImage, matrix: CoOccurrenceMatrix): PngImage | null {
  const remapping = battiatoReindex(matrix);
  applyMostPopularColor(remapping, matrix, 0);
  return applyPaletteReorder(png, remapping);
}

function applyPaletteReorder(png: PngImage, remapping: number[]): PngImage | null {
  const ct = png.ihdr.colorType;
  if (ct.kind !== 'indexed') return null;
  const palette = ct.palette;
  if (remapping.every((v, i) => v === i)) return null;

  const newPalette: RGBA8[] = [];
  const byteMap = new Uint8Array(256);
  for (let i = 0; i < remapping.length; i++) {
    const v = remapping[i];
    newPalette.push(palette[v]);
    byteMap[v] = i;
  }
  const data = new Uint8Array(png.data.length);
  for (let i = 0; i < png.data.length; i++) data[i] = byteMap[png.data[i]];

  return new PngImage({ ...png.ihdr, colorType: { kind: 'indexed', palette: newPalette } }, data);
}

function colorValue(color: RGBA8): number {
  const a = rgba8A(color);
  return ((a & 0xfe) << 18) + (a & 0x01) - rgba8R(color) * 299 - rgba8G(color) * 587 - rgba8B(color) * 114;
}

/** Find the most popular colour on the image edges (pixels neighbouring filter bytes). */
function mostPopularEdgeColor(numColors: number, png: PngImage): number | null {
  const counts = new Uint32Array(256);
  for (const line of png.scanLines(false)) {
    const data = line.data;
    if (data.length >= 1) {
      counts[data[0]] += 1;
      counts[data[data.length - 1]] += 1;
    }
  }
  let bestIndex = 0;
  let bestCount = -1;
  for (let i = 0; i < numColors; i++) {
    if (counts[i] > bestCount) {
      bestCount = counts[i];
      bestIndex = i;
    }
  }
  let maxEqual = 0;
  for (let i = 0; i < 256; i++) if (counts[i] === bestCount) maxEqual++;
  if (maxEqual > 1) return null;
  return bestIndex;
}

/** Put the most popular colour first, if it meets the minimum threshold. */
function applyMostPopularColor(remapping: number[], matrix: CoOccurrenceMatrix, min: number): void {
  const [mostPopular, count] = matrix.mostPopularColor();
  if (count < min) return;
  const firstIdx = remapping.indexOf(mostPopular);
  if (firstIdx === -1) return;
  if (firstIdx >= Math.floor(remapping.length / 2)) {
    remapping.reverse();
    rotateRight(remapping, firstIdx + 1);
  } else {
    rotateLeft(remapping, firstIdx);
  }
}

function rotateLeft(arr: number[], n: number): void {
  const k = ((n % arr.length) + arr.length) % arr.length;
  if (k === 0) return;
  const head = arr.splice(0, k);
  arr.push(...head);
}

function rotateRight(arr: number[], n: number): void {
  const k = ((n % arr.length) + arr.length) % arr.length;
  if (k === 0) return;
  const tail = arr.splice(arr.length - k, k);
  arr.unshift(...tail);
}

/** Greedy index assignment using an enhanced version of Zeng's technique. */
function ezengReindex(matrix: CoOccurrenceMatrix): number[] {
  const edges = matrix.weightedEdges;
  const remapping = [edges[0][0], edges[0][1]];

  const sums: Array<[number, number]> = [];
  let bestSumPos = 0;
  let bestSum: [number, number] = [0, 0];
  for (let i = 0; i < matrix.numColors; i++) {
    const mRow = matrix.row(i);
    if (i === remapping[0] || i === remapping[1]) continue;
    const sum: [number, number] = [i, mRow[remapping[0]] + mRow[remapping[1]]];
    if (sum[1] > bestSum[1]) {
      bestSumPos = sums.length;
      bestSum = sum;
    }
    sums.push(sum);
  }

  while (sums.length > 0) {
    const bestIndex = bestSum[0];
    const m = remapping.length;
    let bestPos = 0;
    let bestCost = Number.MAX_SAFE_INTEGER;
    let crossCost = 0;
    const bestRow = matrix.row(bestIndex);
    for (let p = 0; p <= m; p++) {
      let newCost = 0;
      for (let k = 0; k < m; k++) {
        const dist = k < p ? p - k : k + 1 - p;
        newCost += bestRow[remapping[k]] * dist;
      }
      const total = newCost + crossCost;
      if (total < bestCost) {
        bestCost = total;
        bestPos = p;
      }
      if (p < m) {
        const rowP = matrix.row(remapping[p]);
        for (let bi = p + 1; bi < m; bi++) crossCost += rowP[remapping[bi]];
        for (let ai = 0; ai < p; ai++) crossCost -= rowP[remapping[ai]];
      }
    }
    remapping.splice(bestPos, 0, bestIndex);

    sums[bestSumPos] = sums[sums.length - 1];
    sums.pop();
    if (sums.length > 0) {
      bestSumPos = 0;
      bestSum = [0, 0];
      for (let i = 0; i < sums.length; i++) {
        const sum = sums[i];
        sum[1] += bestRow[sum[0]];
        if (sum[1] > bestSum[1]) {
          bestSumPos = i;
          bestSum = sum;
        }
      }
    }
  }

  return remapping;
}

/** Approximate TSP solution for colour re-indexing, from Battiato et al. */
function battiatoReindex(matrix: CoOccurrenceMatrix): number[] {
  const chains: number[][] = [];
  const vx: Array<[number, number]> = Array.from({ length: matrix.numColors }, () => [0, 0] as [number, number]);

  for (const [ei, ej] of matrix.weightedEdges) {
    const i = ei;
    const j = ej;
    const vi = vx[i];
    const vj = vx[j];
    if (vi[0] === 0 && vj[0] === 0) {
      vi[0] = 1;
      vi[1] = chains.length;
      vj[0] = 1;
      vj[1] = chains.length;
      chains.push([i, j]);
    } else if (vi[0] === 0 && vj[0] === 1) {
      vi[0] = 1;
      vi[1] = vj[1];
      vj[0] = 2;
      const chain = chains[vj[1]];
      if (chain[0] === j) chain.unshift(i);
      else chain.push(i);
    } else if (vi[0] === 1 && vj[0] === 0) {
      vj[0] = 1;
      vj[1] = vi[1];
      vi[0] = 2;
      const chain = chains[vi[1]];
      if (chain[0] === i) chain.unshift(j);
      else chain.push(j);
    } else if (vi[0] === 1 && vj[0] === 1 && vi[1] !== vj[1]) {
      vi[0] = 2;
      vj[0] = 2;
      const a = vi[1] < vj[1] ? i : j;
      const b = vi[1] < vj[1] ? j : i;
      const ca = vx[a][1];
      const cb = vx[b][1];
      const chainb = chains[cb];
      chains[cb] = [];
      for (const v of chainb) vx[v][1] = ca;
      const chaina = chains[ca];
      if (chaina[0] === a && chainb[0] === b) {
        for (const v of chainb) chaina.unshift(v);
      } else if (chaina[0] === a) {
        chaina.splice(0, 0, ...chainb);
      } else if (chainb[0] === b) {
        chaina.push(...chainb);
      } else {
        const pos = chaina.length;
        for (const v of chainb) chaina.splice(pos, 0, v);
      }
    }

    if (chains[0].length === matrix.numColors) break;
  }

  const result: number[] = [];
  for (const chain of chains) for (const v of chain) result.push(v);
  for (let i = 0; i < vx.length; i++) if (vx[i][0] === 0) result.push(i);
  return result;
}

/** Pairwise swap search: swap adjacent-ish pairs if it reduces cost. */
function pairwiseSwapSearch(remapping: number[], matrix: CoOccurrenceMatrix, maxDist: number): void {
  const numColors = remapping.length;
  const bLimit = maxDist + 1;

  let swaps = 2;
  while (swaps >= 2) {
    swaps = 0;
    for (let a = 0; a < numColors - 1; a++) {
      const end = Math.min(a + bLimit, numColors);
      for (let b = a + 1; b < end; b++) {
        const va = remapping[a];
        const vb = remapping[b];
        const rowA = matrix.row(va);
        const rowB = matrix.row(vb);
        let delta = 0;
        const dist = b - a;
        for (let i = 0; i < a; i++) {
          delta += (rowA[remapping[i]] - rowB[remapping[i]]) * dist;
        }
        for (let i = a + 1; i < b; i++) {
          delta += (rowA[remapping[i]] - rowB[remapping[i]]) * (a + b - 2 * i);
        }
        for (let i = b + 1; i < numColors; i++) {
          delta -= (rowA[remapping[i]] - rowB[remapping[i]]) * dist;
        }
        if (delta < 0) {
          const tmp = remapping[a];
          remapping[a] = remapping[b];
          remapping[b] = tmp;
          swaps++;
        }
      }
    }
  }
}

/** Records how often each colour is adjacent to every other colour. */
export class CoOccurrenceMatrix {
  readonly numColors: number;
  private readonly data: Uint32Array;
  readonly weightedEdges: Array<[number, number, number]>;

  private constructor(numColors: number, data: Uint32Array, weightedEdges: Array<[number, number, number]>) {
    this.numColors = numColors;
    this.data = data;
    this.weightedEdges = weightedEdges;
  }

  /** Construct a co-occurrence matrix from an image, or null if unsupported. */
  static from(png: PngImage): CoOccurrenceMatrix | null {
    if (png.ihdr.bitDepth !== BitDepth.Eight) return null;
    const ct = png.ihdr.colorType;
    if (ct.kind !== 'indexed' || ct.palette.length <= 2) return null;
    const numColors = ct.palette.length;
    const data = CoOccurrenceMatrix.build(numColors, png);
    const weightedEdges = CoOccurrenceMatrix.buildWeightedEdges(numColors, data);
    return new CoOccurrenceMatrix(numColors, data, weightedEdges);
  }

  private static build(numColors: number, png: PngImage): Uint32Array {
    const data = new Uint32Array(numColors * numColors);
    let prev: Uint8Array | null = null;
    for (const line of png.scanLines(false)) {
      const lineData = line.data;
      let prevVal = -1;
      for (let i = 0; i < lineData.length; i++) {
        const val = lineData[i];
        if (prevVal !== -1) data[prevVal * numColors + val] += 1;
        if (prev !== null && i < prev.length) data[prev[i] * numColors + val] += 1;
        prevVal = val;
      }
      prev = lineData;
    }
    for (let i = 0; i < numColors; i++) {
      const rowStart = i * numColors;
      for (let j = 0; j <= i; j++) {
        const opposite = j * numColors + i;
        data[rowStart + j] += data[opposite];
        data[opposite] = data[rowStart + j];
      }
    }
    return data;
  }

  private static buildWeightedEdges(numColors: number, data: Uint32Array): Array<[number, number, number]> {
    const edges: Array<[number, number, number]> = [];
    for (let i = 0; i < numColors; i++) {
      const rowStart = i * numColors;
      for (let j = 0; j < i; j++) {
        const val = data[rowStart + j];
        if (val > 0) edges.push([j, i, val]);
      }
    }
    edges.sort((a, b) => b[2] - a[2]);
    return edges;
  }

  row(row: number): Uint32Array {
    const start = row * this.numColors;
    return this.data.subarray(start, start + this.numColors);
  }

  mostPopularColor(): [number, number] {
    let best: [number, number] = [0, 0];
    for (let i = 0; i < this.numColors; i++) {
      const r = this.row(i);
      let sum = 0;
      for (let k = 0; k < r.length; k++) sum += r[k];
      if (sum > best[1]) best = [i, sum];
    }
    best[1] = Math.floor(best[1] / 4);
    return best;
  }
}
