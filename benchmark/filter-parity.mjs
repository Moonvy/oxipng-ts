// Verify Brute filter decisions and alpha handling against the saved build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const i = process.argv.indexOf('--baseline');
const baseline = await import(pathToFileURL(resolve(i < 0 ? 'benchmark/baseline-round2/dist' : process.argv[i + 1], 'index.js')));
const current = await import(pathToFileURL(resolve('dist/index.js')));
const files = ['rgba_8_reduce_alpha.png', 'rgba_16_should_be_rgba_16.png',
  'interlaced_odd_width.png', 'palette_2_should_be_palette_2.png', 'grayscale_16_should_be_grayscale_16.png'];
let checks = 0;
for (const name of files) {
  const input = readFileSync(resolve('test/files', name));
  const modules = [baseline, current];
  const images = modules.map(mod => mod.PngData.fromSlice(input, new mod.Options()).raw);
  const originals = images.map(image => image.data.slice());
  for (const [lines, level] of [[3, 1], [8, 5]]) {
    for (const alpha of [false, true]) {
      const outputs = images.map((image, i) => image.filterImage(modules[i].Brute(lines, level), alpha));
      assert.deepEqual(outputs[1], outputs[0], `${name}, Brute(${lines},${level}), alpha=${alpha}`);
      images.forEach((image, i) => assert.deepEqual(image.data, originals[i]));
      checks++;
    }
  }
}
console.log(`${checks} Brute filter/alpha trials: exact output and decisions; inputs unchanged`);
