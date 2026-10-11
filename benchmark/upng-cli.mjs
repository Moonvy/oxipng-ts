#!/usr/bin/env node
// Process-based lossless UPNG.js reference encoder for upng-compare.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import UPNG from 'upng-js';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
if (process.argv[2] === '--version') {
  console.log(`upng-js ${require('upng-js/package.json').version}`);
} else {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node benchmark/upng-cli.mjs INPUT OUTPUT');
  const bytes = readFileSync(input);
  const image = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  // This comparison is for still, 8-bit PNGs. Reject unsupported inputs instead
  // of silently losing animation or 16-bit precision. Metadata is not preserved.
  if (image.frames.length || image.depth === 16) {
    throw new Error('UPNG benchmark supports only still PNGs with at most 8-bit channels');
  }
  const pixels = UPNG.toRGBA8(image)[0];
  const encoded = Buffer.from(UPNG.encode([pixels], image.width, image.height, 0));
  if (process.argv.includes('--verify')) {
    const original = PNG.sync.read(bytes);
    const decoded = PNG.sync.read(encoded);
    assert.equal(decoded.width, original.width);
    assert.equal(decoded.height, original.height);
    assert.deepEqual(decoded.data, original.data, 'UPNG output must preserve all RGBA pixels');
  }
  writeFileSync(output, encoded);
}
