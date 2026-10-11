import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { deflateRaw, deflateRawSize } from '../src/deflate/deflate.js';
import { SizeLimitExceeded } from '../src/deflate/bitwriter.js';

function inputs(): Array<[string, Uint8Array]> {
  const cases: Array<[string, Uint8Array]> = [];
  const randomBytes = (length: number) => {
    const backing = new Uint8Array(length + 17);
    const data = backing.subarray(7, 7 + length);
    let state = 192731;
    for (let i = 0; i < length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[i] = (state >>> 24) % 97;
    }
    return data;
  };
  for (const word of [1, 2, 4, 16, 32, 63]) {
    for (let byte = 0; byte < 4; byte++) for (const mask of [1, 128]) {
      const data = randomBytes(1400);
      data.set(data.subarray(0, 280), 600);
      data[600 + word * 4 + byte] ^= mask;
      cases.push([`word ${word}, byte ${byte}, mask ${mask}`, data]);
    }
  }
  for (const tail of [4, 5, 6, 7, 8, 9, 15, 16, 17, 255, 256, 257, 258, 259]) {
    const data = randomBytes(1024 + tail);
    data.set(data.subarray(0, tail), 1024);
    data[data.length - 1] ^= 128;
    cases.push([`remaining ${tail}`, data]);
  }
  for (const distance of [32767, 32768, 32769]) {
    const data = randomBytes(distance + 280 + 13);
    data.set(data.subarray(0, 280), distance);
    data[distance + 255] ^= 128;
    cases.push([`distance ${distance}`, data]);
  }
  for (const lead of [7, 129]) {
    const data = randomBytes((1 << 18) + 700);
    const target = (1 << 18) - lead;
    const source = target - 32768;
    data.set(data.subarray(source, source + 280), target);
    data[target + 255] ^= 128;
    cases.push([`block boundary, lead ${lead}`, data]);
  }
  return cases;
}

describe('word mismatch byte positions', () => {
  // Aggregate raw-stream fingerprints recorded from the reference encoder
  // before changing the matcher. Every case must actually use compressed
  // blocks, so a stored stream cannot hide an incorrect match length.
  const fingerprints = [
    [1, '1c632f642a5e24567facb77ecb9cbd1b08effc7c364a6b79e4cfea0d008c13b0'],
    [6, 'cce11aab1b1696925c5e5d38f2832ae159838858de476e715dd08d804b8343c2'],
    // High levels deliberately change the parse; retain the independent
    // decoding, offset-view, non-mutation and compressed-block assertions.
    [12, null],
  ] as const;
  for (const [level, fingerprint] of fingerprints) {
    it(`independently decodes word and tail boundaries at level ${level}`, () => {
      const hash = createHash('sha256');
      for (const [name, data] of inputs()) {
        const copy = data.slice();
        const output = deflateRaw(data, level);
        expect(output[0] & 6, name).not.toBe(0);
        expect(inflateRawSync(output).equals(data), name).toBe(true);
        expect(Buffer.from(data).equals(copy), name).toBe(true);
        hash.update(output);
      }
      if (fingerprint !== null) expect(hash.digest('hex')).toBe(fingerprint);
    });
  }

  it('keeps exact size limits across word, tail, window and block boundaries', () => {
    for (const [name, data] of inputs()) {
      const output = deflateRaw(data, 12);
      expect(deflateRawSize(data, 12, output.length), name).toBe(output.length);
      expect(() => deflateRawSize(data, 12, output.length - 1), name).toThrow(SizeLimitExceeded);
      expect(Buffer.from(deflateRaw(data, 12)).equals(output), name).toBe(true);
    }
  });
});
