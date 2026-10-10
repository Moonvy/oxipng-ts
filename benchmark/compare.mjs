// Compare a saved build with dist, using pngjs as an independent pixel oracle.
// node benchmark/compare.mjs --label batch1 --runs 3
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
const arg = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const baseline = await import(pathToFileURL(resolve(arg('--baseline', 'benchmark/baseline/dist'), 'index.js')));
const current = await import(pathToFileURL(resolve('dist/index.js')));
const runs = Number(arg('--runs', '3'));
const presets = arg('--presets', '2,6').split(',').map(Number);
const label = arg('--label', 'final');
const samples = arg('--samples', '').split(',').filter(Boolean);
const exact = process.argv.includes('--exact');
const decode = bytes => PNG.sync.read(Buffer.from(bytes), { skipRescale: true });
const rows = [];
for (const preset of presets) {
  for (const name of readdirSync('benchmark/sample').filter(n => /\.png$/i.test(n)).sort()) {
    if (samples.length && !samples.includes(name)) continue;
    const input = readFileSync(resolve('benchmark/sample', name));
    const original = decode(input);
    const modules = [baseline, current];
    const times = [[], []];
    const outputs = [];
    for (let round = -1; round < runs; round++) {
      // Alternate ordering to reduce warmup/thermal bias; one unmeasured warmup.
      for (const index of round % 2 === 0 ? [1, 0] : [0, 1]) {
        const mod = modules[index];
        const start = performance.now();
        const output = mod.oxipngSync(input, mod.Options.fromPreset(preset));
        const ms = performance.now() - start;
        if (round >= 0) times[index].push(ms);
        outputs[index] = output;
      }
    }
    for (const output of outputs) {
      const decoded = decode(output);
      assert.equal(decoded.width, original.width);
      assert.equal(decoded.height, original.height);
      assert.deepEqual(decoded.data, original.data, `${name}: pixel mismatch`);
    }
    assert.ok(outputs[1].length <= outputs[0].length, `${name}: size regression`);
    if (exact) assert.deepEqual(outputs[1], outputs[0], `${name}: output byte difference`);
    const median = values => values.sort((a, b) => a - b)[values.length >> 1];
    const row = { preset, name, baselineBytes: outputs[0].length, currentBytes: outputs[1].length,
      baselineMs: median(times[0]), currentMs: median(times[1]), identical: Buffer.from(outputs[0]).equals(Buffer.from(outputs[1])) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(`benchmark/comparison-${label}.json`, JSON.stringify({ label, runs,
  baseline: arg('--baseline', 'benchmark/baseline/dist'), presets, samples, exact,
  timing: 'median; in-process; one warmup; alternating order', rows }, null, 2) + '\n');
