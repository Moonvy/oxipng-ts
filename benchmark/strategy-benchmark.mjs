// Isolate the cost of Brute filtering, keeping compressed stream choices exact.
// node benchmark/strategy-benchmark.mjs --baseline /path/to/dist --label round2-brute
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
const arg = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const baselinePath = arg('--baseline', 'benchmark/baseline-round2/dist');
const baseline = await import(pathToFileURL(resolve(baselinePath, 'index.js')));
const current = await import(pathToFileURL(resolve('dist/index.js')));
const name = arg('--sample', 'Qjiao.png');
const runs = Number(arg('--runs', '3'));
const label = arg('--label', 'round2-brute');
const input = readFileSync(resolve('benchmark/sample', name));
const modules = [baseline, current];
const images = modules.map(mod => mod.PngData.fromSlice(input, new mod.Options()).raw);
const times = [[], []];
const outputs = [];
for (let round = -1; round < runs; round++) {
  for (const index of round % 2 === 0 ? [1, 0] : [0, 1]) {
    const start = performance.now();
    outputs[index] = images[index].filterImage(modules[index].Brute(8, 5), false);
    if (round >= 0) times[index].push(performance.now() - start);
  }
}
assert.deepEqual(outputs[1], outputs[0]);
const median = values => values.sort((a, b) => a - b)[values.length >> 1];
const result = { baseline: baselinePath, sample: name, strategy: 'Brute(8,5)', runs,
  timing: 'median; in-process; one warmup; alternating order',
  baselineMs: median(times[0]), currentMs: median(times[1]), identical: true };
writeFileSync(`benchmark/comparison-${label}.json`, JSON.stringify(result, null, 2) + '\n');
console.log(result);
