// Byte parity at all encoder levels, including block/window edges and lazy matches.
import assert from 'node:assert/strict';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const baseArg = process.argv.indexOf('--baseline');
const baseline = await import(pathToFileURL(resolve(baseArg >= 0 ? process.argv[baseArg + 1] : 'benchmark/baseline/dist', 'index.js')));
import * as current from '../dist/index.js';
let state = 0x12345678;
const backing = Uint8Array.from({ length: 300017 }, (_, i) => {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return i % 300 < 250 ? i % 19 : state >>> 24;
});
backing.copyWithin(100000, 100, 33000);
const inputs = [new Uint8Array(0), backing.subarray(7, 11), backing.subarray(7, 32776), backing.subarray(7, 262152), backing.subarray(7)];
if (process.argv.includes('--extended')) {
  const random = length => Uint8Array.from({ length }, () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 24;
  });
  for (const distance of [32767, 32768, 32769]) {
    const bytes = random(100017);
    const pos = 65553;
    bytes.copyWithin(pos, pos - distance, pos - distance + 258);
    inputs.push(bytes.subarray(7));
  }
  // Repeated prefixes with late mismatches exercise best-length suffix checks
  // and lazy lookahead across many ring wraps and block boundaries.
  const tails = new Uint8Array(600017);
  for (let i = 0; i < tails.length; i++) tails[i] = i % 257 === 256 ? (i >>> 8) & 255 : i % 19;
  inputs.push(tails.subarray(7));
  for (const length of [31, 4099, 32772, 65541, 262149, 524301]) {
    const bytes = random(length + 7);
    if (length > 65541) bytes.copyWithin(50003, 2007, 10007);
    inputs.push(bytes.subarray(7));
  }
}
let checks = 0;
for (let level = 0; level <= 12; level++) {
  for (const input of inputs) {
    for (const key of ['deflate', 'deflateRaw']) {
      const expected = baseline[key](input, level);
      const actual = current[key](input, level);
      assert.deepEqual(actual, expected, `${key} level ${level}, ${input.length} bytes`);
      const decode = key === 'deflate' ? inflateSync : inflateRawSync;
      assert.deepEqual(new Uint8Array(decode(actual)), input);
      checks++;
    }
  }
}
console.log(`${checks} streams: byte-identical to baseline; independent zlib round-trips passed`);
