import { Frame } from '../apng.ts';
import { channelsPerPixel, hasAlpha, type ColorType } from '../colors.ts';
import { inflate } from '../deflate/index.ts';
import { PngError } from '../error.ts';
import {
  fileHeaderIsValid,
  nameBytes,
  parseIhdrChunk,
  parseNextChunk,
  rawDataSize,
  stripKeep,
  type Chunk,
  type ChunkParseState,
  type IhdrData,
} from '../headers.ts';
import type { Options } from '../options.ts';
import { crc32, readBeU32, writeBeU16, writeBeU32 } from '../util/bytes.ts';
import { ByteBuffer } from '../util/byteBuffer.ts';
import {
  filterLine,
  filterLineMinSum,
  ROW_FILTER_ALL,
  rowFilterFromNumber,
  unfilterLine,
  RowFilter,
} from '../filters/index.ts';
import {
  Predefined,
  strategyEvaluator,
  type FilterStrategy,
} from '../filters/strategies.ts';
import { ScanLines } from './scanLines.ts';

const EMPTY = new Uint8Array(0);

/** An uncompressed, unfiltered PNG image. */
export class PngImage {
  ihdr: IhdrData;
  data: Uint8Array;

  constructor(ihdr: IhdrData, data: Uint8Array) {
    this.ihdr = ihdr;
    this.data = data;
  }

  /** Decode a filtered+compressed IDAT stream into an unfiltered image. */
  static new(ihdr: IhdrData, compressedData: Uint8Array): PngImage {
    const expected = rawDataSize(ihdr);
    const raw = inflate(compressedData, expected);
    if (raw.length !== expected) throw PngError.truncatedData();
    const image = new PngImage(ihdr, raw);
    image.data = image.unfilterImage();
    return image;
  }

  channelsPerPixel(): number {
    return channelsPerPixel(this.ihdr.colorType);
  }

  bytesPerChannel(): number {
    return this.ihdr.bitDepth === 16 ? 2 : 1;
  }

  /** Calculate the size of the PLTE and tRNS chunks. */
  keyChunksSize(): number {
    const ct = this.ihdr.colorType;
    if (ct.kind === 'indexed') {
      const plte = 12 + ct.palette.length * 3;
      let lastTrns = -1;
      for (let i = ct.palette.length - 1; i >= 0; i--) {
        if ((ct.palette[i] & 0xff) !== 255) {
          lastTrns = i;
          break;
        }
      }
      return lastTrns === -1 ? plte : plte + 12 + lastTrns + 1;
    }
    if (ct.kind === 'grayscale' && ct.transparentShade !== null) return 12 + 2;
    if (ct.kind === 'rgb' && ct.transparentColor !== null) return 12 + 6;
    return 0;
  }

  /** Estimate the output size to help evaluate very small data. */
  estimatedOutputSize(idatData: Uint8Array): number {
    return idatData.length + this.keyChunksSize();
  }

  scanLines(hasFilter: boolean): ScanLines {
    return new ScanLines(this.ihdr, this.data, hasFilter);
  }

  /** Reverse all filters, returning the unfiltered IDAT bytestream. */
  unfilterImage(): Uint8Array {
    const out = new ByteBuffer(this.data.length);
    const bpp = this.bytesPerChannel() * this.channelsPerPixel();
    let prevLine = EMPTY;
    let prevPass: number | null = null;
    for (const line of this.scanLines(true)) {
      if (prevPass !== line.pass || prevLine.length === 0) {
        prevLine = new Uint8Array(line.data.length);
        prevPass = line.pass;
      }
      const offset = out.len;
      const filter = rowFilterFromNumber(line.filter);
      unfilterLine(filter, bpp, line.data, prevLine, out);
      prevLine.set(out.buf.subarray(offset, out.len));
    }
    return out.toUint8Array();
  }

  /** Apply the specified filter strategy to all rows, returning the filtered stream. */
  filterImage(strategy: FilterStrategy, optimizeAlpha: boolean): [Uint8Array, FilterStrategy] {
    const out = new ByteBuffer(rawDataSize(this.ihdr));
    const bpp = this.bytesPerChannel() * this.channelsPerPixel();
    const alphaBytes = optimizeAlpha && hasAlpha(this.ihdr.colorType) ? this.bytesPerChannel() : 0;

    // Reusable scratch buffers (one set per pass; line length is constant within a pass).
    let cur: Uint8Array = EMPTY;
    let prev: Uint8Array = EMPTY;
    let best = new Uint8Array(0);
    let bestRaw: Uint8Array = EMPTY;
    let passLen = -1;
    let prevPass: number | null = null;

    const filtersUsed: RowFilter[] = [];
    const heuristic = strategyEvaluator(strategy);
    let index = 0;

    for (const line of this.scanLines(false)) {
      const lineLen = line.data.length;
      if (prevPass !== line.pass) {
        prevPass = line.pass;
        passLen = -1;
      }
      if (passLen !== lineLen) {
        passLen = lineLen;
        cur = alphaBytes !== 0 ? new Uint8Array(lineLen) : EMPTY;
        prev = new Uint8Array(lineLen); // zero-filled: first row of a pass has no "previous"
        best = heuristic !== null ? new Uint8Array(lineLen + 1) : EMPTY;
        bestRaw = alphaBytes !== 0 && heuristic !== null ? new Uint8Array(lineLen) : EMPTY;
      }
      // Filtering only mutates a row when transparent-pixel optimisation is enabled.
      if (alphaBytes !== 0) cur.set(line.data);
      else cur = line.data;

      if (strategy.kind === 'basic') {
        filterLine(strategy.filter, bpp, cur, prev, out, alphaBytes);
        const tmp = cur;
        cur = prev;
        prev = tmp;
        index++;
        continue;
      }
      if (strategy.kind === 'predefined') {
        const f = strategy.lines[index] ?? RowFilter.None;
        filterLine(f, bpp, cur, prev, out, alphaBytes);
        const tmp = cur;
        cur = prev;
        prev = tmp;
        index++;
        continue;
      }

      let bestFilter: RowFilter = RowFilter.None;
      let allZero = true;
      for (let k = 0; k < lineLen; k++) {
        if (cur[k] !== 0) {
          allZero = false;
          break;
        }
      }
      if (allZero) {
        filterLine(bestFilter, bpp, cur, prev, out, alphaBytes);
        const tmp = cur;
        cur = prev;
        prev = tmp;
        filtersUsed.push(bestFilter);
        index++;
        continue;
      }

      const offset = out.len;
      const evaluator = heuristic!;
      evaluator.reset(lineLen + 1);
      let bestSize = Number.MAX_SAFE_INTEGER;
      for (const f of ROW_FILTER_ALL) {
        let improved: boolean;
        if (strategy.kind === 'minSum') {
          const size = filterLineMinSum(f, bpp, cur, prev, out, alphaBytes, bestSize);
          improved = size < bestSize;
          if (improved) bestSize = size;
        } else {
          filterLine(f, bpp, cur, prev, out, alphaBytes);
          improved = evaluator.evaluate(out.buf, offset, out.len);
        }
        if (improved) {
          best.set(out.buf.subarray(offset, out.len));
          if (alphaBytes !== 0) bestRaw.set(cur);
          bestFilter = f;
        }
        out.truncate(offset);
      }
      out.extend(best);
      // `prev` becomes the snapshot of the line as it was for the chosen filter.
      if (alphaBytes !== 0) {
        const tmp = bestRaw;
        bestRaw = prev;
        prev = tmp;
      } else {
        prev = cur;
      }
      filtersUsed.push(bestFilter);
      index++;
    }

    // The output buffer is exclusively owned by this call; return its live view.
    const filtered = out.buf.subarray(0, out.len);
    if (filtersUsed.length === 0) return [filtered, strategy];
    return [filtered, Predefined(filtersUsed)];
  }
}

/** All data relevant to a PNG image. */
export class PngData {
  raw: PngImage;
  idatData: Uint8Array;
  auxChunks: Chunk[];
  frames: Frame[];

  constructor(raw: PngImage, idatData: Uint8Array, auxChunks: Chunk[], frames: Frame[]) {
    this.raw = raw;
    this.idatData = idatData;
    this.auxChunks = auxChunks;
    this.frames = frames;
  }

  /** Decode a PNG bytestream into raw image data. */
  static fromSlice(byteData: Uint8Array, opts: Options): PngData {
    if (byteData.length < 8 || !fileHeaderIsValid(byteData.subarray(0, 8))) {
      throw PngError.notPNG();
    }
    const state: ChunkParseState = { offset: 8 };

    const idatParts: Uint8Array[] = [];
    let idatLength = 0;
    let sawIdat = false;
    const keyChunks = new Map<string, Uint8Array>();
    const auxChunks: Chunk[] = [];
    const frames: Frame[] = [];
    let sequenceNumber = 0;

    for (;;) {
      const chunk = parseNextChunk(byteData, state, opts.fixErrors);
      if (chunk === null) break;
      const name = chunk.name;
      if (name === 'IDAT') {
        if (!sawIdat) {
          auxChunks.push({ name: 'IDAT', data: EMPTY });
          sawIdat = true;
        }
        idatParts.push(chunk.data);
        idatLength += chunk.data.length;
      } else if (name === 'IHDR' || name === 'PLTE' || name === 'tRNS') {
        keyChunks.set(name, chunk.data.slice());
      } else if (stripKeep(opts.strip, name)) {
        if (name === 'caBX' || name === 'iDOT') {
          if (opts.strip.mode === 'keep') {
            throw PngError.chunkPreventsChanges(nameBytes(name));
          }
          continue;
        }
        if (name === 'fcTL' || name === 'fdAT') {
          if (chunk.data.length < 4 || readBeU32(chunk.data, 0) !== sequenceNumber) {
            throw PngError.apngOutOfOrder();
          }
          sequenceNumber += 1;
          if (name === 'fcTL' && sawIdat) {
            frames.push(Frame.fromFctlData(chunk.data));
            continue;
          } else if (name === 'fdAT') {
            const last = frames[frames.length - 1];
            if (!last) throw PngError.apngOutOfOrder();
            const merged = new Uint8Array(last.data.length + chunk.data.length - 4);
            merged.set(last.data, 0);
            merged.set(chunk.data.subarray(4), last.data.length);
            last.data = merged;
            continue;
          }
        }
        auxChunks.push({ name, data: chunk.data.slice() });
      } else if (name === 'acTL') {
        // APNG animation data stripped; image becomes a standard PNG.
      }
    }

    if (!sawIdat || idatLength === 0) throw PngError.chunkMissing('IDAT');
    const idatData = new Uint8Array(idatLength);
    {
      let p = 0;
      for (const part of idatParts) {
        idatData.set(part, p);
        p += part.length;
      }
    }

    const ihdrChunk = keyChunks.get('IHDR');
    if (!ihdrChunk) throw PngError.chunkMissing('IHDR');
    const ihdr = parseIhdrChunk(ihdrChunk, keyChunks.get('PLTE'), keyChunks.get('tRNS'));
    if (opts.maxDecompressedSize !== null && rawDataSize(ihdr) > opts.maxDecompressedSize) {
      throw PngError.inflatedDataTooLong(opts.maxDecompressedSize);
    }

    const raw = PngImage.new(ihdr, idatData);
    return new PngData(raw, idatData, auxChunks, frames);
  }

  /** Format the PNG into a valid bytestream. */
  output(): Uint8Array {
    const out = new ByteBuffer();
    out.extend([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdr = this.raw.ihdr;
    const ihdrData = new Uint8Array(13);
    writeBeU32(ihdr.width, ihdrData, 0);
    writeBeU32(ihdr.height, ihdrData, 4);
    ihdrData[8] = ihdr.bitDepth;
    ihdrData[9] = pngCode(ihdr.colorType);
    ihdrData[10] = 0;
    ihdrData[11] = 0;
    ihdrData[12] = ihdr.interlaced ? 1 : 0;
    writePngBlock('IHDR', ihdrData, out);

    // Ancillary chunks are split around the IDAT position marker.
    let idatIndex = this.auxChunks.findIndex((c) => c.name === 'IDAT');
    if (idatIndex === -1) idatIndex = this.auxChunks.length;
    const auxPre = this.auxChunks.slice(0, idatIndex);
    const auxPost = this.auxChunks.slice(idatIndex + 1);

    const isLateChunk = (name: string) => name === 'bKGD' || name === 'hIST' || name === 'tRNS' || name === 'fcTL';
    for (const chunk of auxPre) {
      if (!isLateChunk(chunk.name)) writePngBlock(chunk.name, chunk.data, out);
    }

    const ct = ihdr.colorType;
    if (ct.kind === 'indexed') {
      const paletteData = new Uint8Array(ct.palette.length * 3);
      for (let i = 0; i < ct.palette.length; i++) {
        const c = ct.palette[i];
        paletteData[i * 3] = (c >>> 24) & 0xff;
        paletteData[i * 3 + 1] = (c >>> 16) & 0xff;
        paletteData[i * 3 + 2] = (c >>> 8) & 0xff;
      }
      writePngBlock('PLTE', paletteData, out);
      let lastTrns = -1;
      for (let i = ct.palette.length - 1; i >= 0; i--) {
        if ((ct.palette[i] & 0xff) !== 255) {
          lastTrns = i;
          break;
        }
      }
      if (lastTrns !== -1) {
        const trnsData = new Uint8Array(lastTrns + 1);
        for (let i = 0; i <= lastTrns; i++) trnsData[i] = ct.palette[i] & 0xff;
        writePngBlock('tRNS', trnsData, out);
      }
    } else if (ct.kind === 'grayscale' && ct.transparentShade !== null) {
      const trns = new Uint8Array(2);
      writeBeU16(ct.transparentShade, trns, 0);
      writePngBlock('tRNS', trns, out);
    } else if (ct.kind === 'rgb' && ct.transparentColor !== null) {
      const trns = new Uint8Array(6);
      writeBeU16(ct.transparentColor.r, trns, 0);
      writeBeU16(ct.transparentColor.g, trns, 2);
      writeBeU16(ct.transparentColor.b, trns, 4);
      writePngBlock('tRNS', trns, out);
    }

    let sequenceNumber = 0;
    for (const chunk of auxPre) {
      if (isLateChunk(chunk.name)) {
        writePngBlock(chunk.name, chunk.data, out);
        if (chunk.name === 'fcTL') sequenceNumber += 1;
      }
    }

    writePngBlock('IDAT', this.idatData, out);

    for (const frame of this.frames) {
      writePngBlock('fcTL', frame.fctlData(sequenceNumber), out);
      writePngBlock('fdAT', frame.fdatData(sequenceNumber + 1), out);
      sequenceNumber += 2;
    }

    for (const chunk of auxPost) writePngBlock(chunk.name, chunk.data, out);

    writePngBlock('IEND', EMPTY, out);
    return out.toUint8Array();
  }
}

function pngCode(ct: ColorType): number {
  switch (ct.kind) {
    case 'grayscale':
      return 0;
    case 'rgb':
      return 2;
    case 'indexed':
      return 3;
    case 'grayscaleAlpha':
      return 4;
    case 'rgba':
      return 6;
  }
}

/** Write a PNG chunk (length, name, data, CRC) into `output`. */
export function writePngBlock(name: string, chunk: Uint8Array, output: ByteBuffer): void {
  const length = chunk.length;
  output.reserve(12 + length);
  const header = new Uint8Array(8);
  writeBeU32(length, header, 0);
  header[4] = name.charCodeAt(0);
  header[5] = name.charCodeAt(1);
  header[6] = name.charCodeAt(2);
  header[7] = name.charCodeAt(3);
  output.extend(header);
  output.extend(chunk);
  output.reserve(4);
  const crcInput = new Uint8Array(4 + length);
  crcInput.set(header.subarray(4), 0);
  crcInput.set(chunk, 4);
  const crc = crc32(crcInput);
  const crcBytes = new Uint8Array(4);
  writeBeU32(crc, crcBytes, 0);
  output.extend(crcBytes);
}
