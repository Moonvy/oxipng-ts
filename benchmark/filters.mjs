// Isolated filter-path comparison: node benchmark/filters.mjs
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as baseline from './baseline/dist/index.js';
import * as current from '../dist/index.js';
const input = readFileSync('benchmark/sample/Qjiao.png');
const mods = [baseline, current];
const images = mods.map(mod => mod.PngData.fromSlice(input, new mod.Options()).raw);
const rows = [];
for (const strategy of ['PAETH', 'Entropy', 'Bigrams']) {
  const times = [[], []];
  const outputs = [];
  for (let round = -2; round < 9; round++) {
    for (const index of round % 2 === 0 ? [1, 0] : [0, 1]) {
      const start = performance.now();
      outputs[index] = images[index].filterImage(mods[index][strategy], false)[0];
      if (round >= 0) times[index].push(performance.now() - start);
    }
  }
  assert.deepEqual(outputs[0], outputs[1]);
  const median = xs => xs.sort((a,b) => a-b)[xs.length >> 1];
  rows.push({ strategy, baselineMs: median(times[0]), currentMs: median(times[1]), identical: true });
}
writeFileSync('benchmark/comparison-filters.json', JSON.stringify(rows, null, 2) + '\n');
console.log(rows);
