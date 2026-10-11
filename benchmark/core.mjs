#!/usr/bin/env node
// In-process PNG benchmark: alternate old/new runs, excluding CLI startup.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPngEqual, decodePng } from './verify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const settings = { opt: 2, runs: 5, warmup: 2, baseline: null, corpus: 'sample', rust: null, output: join(here, 'core-results.json') };
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].slice(2);
  if (!args[i].startsWith('--') || !(key in settings) || args[i + 1] === undefined) {
    throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  settings[key] = ['opt', 'runs', 'warmup'].includes(key) ? Number(args[i + 1]) : args[i + 1];
}
for (const key of ['opt', 'runs', 'warmup']) {
  if (!Number.isSafeInteger(settings[key]) || settings[key] < (key === 'runs' ? 1 : 0)) {
    throw new Error(`Invalid --${key}`);
  }
}
if (settings.opt > 6) throw new Error('--opt must be between 0 and 6');
if (!['sample', 'extended'].includes(settings.corpus)) throw new Error('--corpus must be sample or extended');
const files = readdirSync(join(here, 'sample')).filter(f => /\.png$/i.test(f)).sort()
  .map(name => ({ name, category: 'screenshot', path: join(here, 'sample', name) }));
if (settings.corpus === 'extended') {
  for (const [name, category] of [['gradient.png', 'generated gradient'], ['shapes.png', 'generated transparent shapes'], ['photo.png', 'generated plasma (not a photograph)']]) {
    files.push({ name: `generated/${name}`, category, path: join(here, '../site/samples', name) });
  }
  for (const [name, category] of [
    ['palette_8_should_be_palette_8.png', 'indexed'], ['rgb_trns_8_should_be_palette_8.png', 'transparent'],
    ['rgba_16_should_be_rgba_16.png', '16-bit'], ['interlaced_rgba_16_should_be_rgba_16.png', 'interlaced 16-bit'],
    ['small_files.png', 'small'], ['apng_file.png', 'APNG'],
  ]) files.push({ name: `fixture/${name}`, category, path: join(here, '../test/files', name) });
}
const variants = [];
if (settings.baseline) variants.push({ name: 'baseline', api: await import(pathToFileURL(resolve(settings.baseline)).href) });
variants.push({ name: 'current', api: await import(pathToFileURL(join(here, '../dist/index.js')).href) });
for (const variant of variants) variant.api.setLogLevel(variant.api.LogLevel.Off);
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const rows = [];
const rustVersion = settings.rust ? spawnSync(settings.rust, ['--version'], { encoding: 'utf8' }) : null;
if (rustVersion && (rustVersion.error || rustVersion.status !== 0)) throw new Error('Cannot run --rust executable');
for (const { name, category, path } of files) {
  const input = readFileSync(path);
  const original = decodePng(input);
  const cases = variants.map(variant => ({ ...variant, opts: variant.api.Options.fromPreset(settings.opt), times: [], output: null }));
  for (const variant of cases) {
    for (let i = 0; i < settings.warmup; i++) variant.api.oxipngSync(input, variant.opts);
  }
  for (let i = 0; i < settings.runs; i++) {
    const order = i % 2 ? [...cases].reverse() : cases;
    for (const variant of order) {
      const start = performance.now();
      const output = variant.api.oxipngSync(input, variant.opts);
      variant.times.push(performance.now() - start);
      // Pixel checks and determinism checks are outside the timed region.
      try { assertPngEqual(original, decodePng(output)); }
      catch (error) { throw new Error(`${variant.name}: ${name}: ${error.message}`, { cause: error }); }
      if (variant.output !== null && !Buffer.from(output).equals(variant.output)) {
        throw new Error(`${variant.name}: nondeterministic output for ${name}`);
      }
      variant.output = Buffer.from(output);
    }
  }
  const measurements = Object.fromEntries(cases.map(v => [v.name, {
    bytes: v.output.length, medianMs: median(v.times), minMs: Math.min(...v.times), samplesMs: v.times,
  }]));
  // Rust is a size reference only: CLI timing is not comparable to API timing.
  if (settings.rust) {
    const dir = mkdtempSync(join(tmpdir(), 'oxipng-ts-core-'));
    try {
      const source = join(dir, 'input.png'), destination = join(dir, 'output.png');
      writeFileSync(source, input);
      const result = spawnSync(settings.rust, ['-o', String(settings.opt), '--out', destination, source], { encoding: 'utf8' });
      if (result.error || result.status !== 0) throw new Error(`Rust failed: ${result.error ?? result.stderr}`);
      const output = readFileSync(destination);
      assertPngEqual(original, decodePng(output));
      measurements.rust = { bytes: output.length };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  rows.push({ name, category, inputBytes: input.length, ...measurements });
  console.log(`${name}: ${cases.map(v => `${v.name} ${v.output.length} B / ${median(v.times).toFixed(1)} ms`).join(' → ')}`);
}
if (rows.length === 0) throw new Error('No benchmark PNGs found');
const totals = Object.fromEntries(variants.map(v => [v.name, {
  bytes: rows.reduce((sum, row) => sum + row[v.name].bytes, 0),
  medianMs: rows.reduce((sum, row) => sum + row[v.name].medianMs, 0),
}]));
if (settings.rust) totals.rust = { bytes: rows.reduce((sum, row) => sum + row.rust.bytes, 0) };
const report = {
  generatedAt: new Date().toISOString(),
  environment: { platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, node: process.version },
  settings, totals, rows,
  rust: rustVersion ? { version: rustVersion.stdout.trim(), sizeOnly: true } : null,
};
writeFileSync(resolve(settings.output), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(totals, null, 2));
