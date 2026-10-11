import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { channelsPerPixel, grayscale, GRAYSCALE_ALPHA, indexed, rgb, RGBA, type BitDepth, type ColorType } from '../src/colors.js';
import { filterLine, filterLineMinSum, ROW_FILTER_ALL } from '../src/filters/index.js';
import { MinSum } from '../src/filters/strategies.js';
import { rawDataSize, type IhdrData } from '../src/headers.js';
import { PngImage } from '../src/png/index.js';
import { ScanLines } from '../src/png/scanLines.js';
import { ByteBuffer } from '../src/util/byteBuffer.js';

const formats: [string, ColorType, BitDepth][] = [
  ...([1, 2, 4, 8, 16] as const).map((depth): [string, ColorType, BitDepth] => [`gray${depth}`, grayscale(null), depth]),
  ['indexed1', indexed([0x000000ff, 0xffffffff]), 1],
  ['indexed2', indexed([0x000000ff, 0xffffffff]), 2],
  ['indexed4', indexed([0x000000ff, 0xffffffff]), 4],
  ['rgb8', rgb(null), 8], ['rgb16', rgb(null), 16],
  ['ga8', GRAYSCALE_ALPHA, 8], ['ga16', GRAYSCALE_ALPHA, 16],
  ['rgba8', RGBA, 8], ['rgba16', RGBA, 16],
];

function input(ihdr: IhdrData, pattern: number): { data: Uint8Array; backing: Uint8Array } {
  const size = rawDataSize(ihdr);
  let rows = 0;
  for (const _ of new ScanLines(ihdr, new Uint8Array(size), true)) rows++;
  const backing = new Uint8Array(size - rows + 19).fill(0x9b);
  const data = backing.subarray(7, backing.length - 12);
  const bpp = channelsPerPixel(ihdr.colorType) * (ihdr.bitDepth === 16 ? 2 : 1);
  let state = 0x12345678;
  for (let i = 0; i < data.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    data[i] = pattern === 0 ? 0 : pattern === 1 ? state >>> 24 : ((i * 3) ^ (i >>> 5)) & 255;
  }
  if (pattern !== 0 && (ihdr.colorType.kind === 'rgba' || ihdr.colorType.kind === 'grayscaleAlpha')) {
    const alphaBytes = ihdr.bitDepth === 16 ? 2 : 1;
    let pixel = 0;
    for (const row of new ScanLines(ihdr, data, false)) {
      for (let i = 0; i < row.data.length; i += bpp, pixel++) {
        for (let j = bpp - alphaBytes; j < bpp; j++) row.data[i + j] = pixel % 3 === 0 ? 0 : 255;
      }
    }
  }
  return { data, backing };
}

// Recorded from the reference filter implementation, before fused scoring.
// Each digest includes both the output stream and returned filter strategy.
const expected: Record<string, string> = {
  gray1: '81239bdeb0280be0d51a11a07a04857ecb371d8b2288dad5366bd76edf09a06d',
  gray2: '39c78940c1bccc1ac2df807d409ffec68870ef9161d53d3fa4284856de22d6a1',
  gray4: '913b050939e10b0a1ac1bcf9be785a1430a83901ad7629170ba6cec2f29aa816',
  gray8: '86df3311982cc3529e1772bd04fbbf6b4a1578e91dc8993f76a07b82f4f203a1',
  gray16: '2fec767865220f052c8c8d2676b155beca4e2b3dc7d8ca49e5dc53ad297c813f',
  indexed1: '81239bdeb0280be0d51a11a07a04857ecb371d8b2288dad5366bd76edf09a06d',
  indexed2: '39c78940c1bccc1ac2df807d409ffec68870ef9161d53d3fa4284856de22d6a1',
  indexed4: '913b050939e10b0a1ac1bcf9be785a1430a83901ad7629170ba6cec2f29aa816',
  rgb8: '517fcfe6d547436b17222268f7ce6bc88cd31c7d91c5ed9b34e193f83a21df16',
  rgb16: '7298b61954077baa4da49344a9b38a3723df4a3685fa89e580b5cf95bc6b06f3',
  ga8: '60ca2e861d6dc5963e0cd41c8ec3d21fa8f8ecb76f3b6e46ce637bd1acc03d44',
  ga16: '0bd84c7322ca86d0ecf9de78065ebd447181f3b6b29c05d5c3dda13c52832d60',
  rgba8: '399a89c3da2e7758525481784961f2c2f48b5faf97e3f6f3453e9d275863bae3',
  rgba16: '697fd57975fd4a5a8b6dadbc03ca43876caa261b39a92c80ecdf4628ccfe090f',
};

describe('MinSum stream compatibility', () => {
  for (const [name, colorType, bitDepth] of formats) {
    it(`preserves baseline bytes and selected filters for ${name}`, () => {
      const hash = createHash('sha256');
      for (const width of [1, 5, 23]) {
        for (const interlaced of [false, true]) {
          for (const pattern of [0, 1, 2]) {
            const ihdr: IhdrData = { width, height: 9, colorType, bitDepth, interlaced };
            const { data, backing } = input(ihdr, pattern);
            const before = backing.slice();
            const image = new PngImage(ihdr, data);
            for (const alpha of [false, true]) {
              const [filtered, used] = image.filterImage(MinSum, alpha);
              hash.update(filtered).update(JSON.stringify(used));
              expect(backing).toEqual(before);
            }
          }
        }
      }
      expect(hash.digest('hex')).toBe(expected[name]);
    });
  }
});

it('scores signed bytes and filter prefixes while completing alpha updates on rejected trials', () => {
  for (const bpp of [1, 2, 3, 4, 6, 8]) {
    for (const alphaBytes of [0, ...(bpp === 2 || bpp === 4 ? [1] : bpp === 8 ? [2] : [])]) {
      const data = Uint8Array.from({ length: bpp * 5 }, (_, i) => [0, 1, 127, 128, 129, 255][i % 6]);
      const prev = Uint8Array.from(data, (value) => value ^ 0x81);
      if (alphaBytes) {
        for (const pixel of [0, 2, 4]) data.fill(0, pixel * bpp + bpp - alphaBytes, (pixel + 1) * bpp);
      }
      for (const filter of ROW_FILTER_ALL) {
        const baselineRaw = data.slice();
        const baselineOut = ByteBuffer.from(new Uint8Array([87, 65, 43]));
        filterLine(filter, bpp, baselineRaw, prev, baselineOut, alphaBytes);
        const bytes = baselineOut.buf.subarray(3, baselineOut.len);
        const exactScore = bytes.reduce((sum, byte) => sum + Math.abs(byte < 128 ? byte : byte - 256), 0);
        for (const bound of [0, 1, exactScore, exactScore + 1, Number.MAX_SAFE_INTEGER]) {
          const raw = data.slice();
          const out = ByteBuffer.from(new Uint8Array([87, 65, 43]));
          const score = filterLineMinSum(filter, bpp, raw, prev, out, alphaBytes, bound);
          expect(raw).toEqual(baselineRaw);
          expect(score < bound).toBe(exactScore < bound);
          expect(out.buf.subarray(0, 3)).toEqual(new Uint8Array([87, 65, 43]));
          if (score < bound) {
            expect(score).toBe(exactScore);
            expect(out.buf.subarray(0, out.len)).toEqual(baselineOut.buf.subarray(0, baselineOut.len));
          }
        }
      }
    }
  }
});
