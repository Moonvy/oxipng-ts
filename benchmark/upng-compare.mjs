#!/usr/bin/env node
// Compare oxipng-ts optimization presets 0–3 with lossless UPNG.js on benchmark/sample.
// Writes UPNG-REPORT.md and upng-results.json (or --output-dir).
//
//   node benchmark/upng-compare.mjs [--runs 5] [--warmup 1] [--output-dir DIR]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sampleDir = join(here, 'sample');
const tsCliPath = join(root, 'dist', 'js', 'cli.js');
const upngCliPath = join(here, 'upng-cli.mjs');
function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const runs = Number(argValue('--runs', '5'));
const warmup = Number(argValue('--warmup', '1'));
const outputDir = argValue('--output-dir', here);
if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(warmup) || warmup < 0) {
  throw new Error('--runs must be positive and --warmup nonnegative');
}
if (!existsSync(tsCliPath)) throw new Error('dist/js/cli.js not found; run `npm run build:ts` first');
mkdirSync(outputDir, { recursive: true });

function run(bin, args) {
  const start = performance.now();
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  const ms = performance.now() - start;
  if (result.status !== 0) {
    throw new Error(`command failed: ${bin} ${args.join(' ')}\n${result.stderr || result.error || ''}`);
  }
  return ms;
}
function bestOf(fn) {
  for (let i = 0; i < warmup; i++) fn();
  let best = Infinity;
  let value;
  for (let i = 0; i < runs; i++) {
    const measured = fn();
    if (measured.ms < best) {
      best = measured.ms;
      value = measured.value;
    }
  }
  return { ms: best, value };
}
function runTs(file, level, output) {
  return bestOf(() => {
    const ms = run(process.execPath, [tsCliPath, '-o', String(level), '--out', output, file]);
    return { ms, value: statSync(output).size };
  });
}
function runUpng(file, output) {
  return bestOf(() => {
    const ms = run(process.execPath, [upngCliPath, file, output]);
    return { ms, value: statSync(output).size };
  });
}
const tsTmp = join(tmpdir(), `oxipng-upng-ts-${process.pid}.png`);
const upngTmp = join(tmpdir(), `oxipng-upng-ref-${process.pid}.png`);
process.on('exit', () => {
  rmSync(tsTmp, { force: true });
  rmSync(upngTmp, { force: true });
});
const upngVersion = spawnSync(process.execPath, [upngCliPath, '--version'], { encoding: 'utf8' });
if (upngVersion.status !== 0) throw new Error(upngVersion.stderr || 'UPNG.js unavailable; run npm install');
const files = readdirSync(sampleDir).filter((name) => /\.png$/i.test(name)).sort();
if (!files.length) throw new Error(`No PNG files found in ${sampleDir}`);

const rows = [];
for (const name of files) {
  const input = join(sampleDir, name);
  const originalBytes = readFileSync(input);
  const original = PNG.sync.read(originalBytes);
  const row = { name, inputBytes: originalBytes.length };
  for (const level of [0, 1, 2, 3]) {
    const ts = runTs(input, level, tsTmp);
    const decoded = PNG.sync.read(readFileSync(tsTmp));
    if (decoded.width !== original.width || decoded.height !== original.height || !decoded.data.equals(original.data)) {
      throw new Error(`oxipng-ts -o ${level} changed pixels for ${name}`);
    }
    row[`o${level}Bytes`] = ts.value;
    row[`o${level}Ms`] = +ts.ms.toFixed(2);
  }
  const upng = runUpng(input, upngTmp);
  const decodedUpng = PNG.sync.read(readFileSync(upngTmp));
  if (decodedUpng.width !== original.width || decodedUpng.height !== original.height || !decodedUpng.data.equals(original.data)) {
    throw new Error(`UPNG.js changed pixels for ${name}`);
  }
  row.upngBytes = upng.value;
  row.upngMs = +upng.ms.toFixed(2);
  rows.push(row);
  process.stdout.write(`${name}\t` + [0, 1, 2, 3].map((level) => `-o${level} ${row[`o${level}Bytes`]} B/${row[`o${level}Ms`]} ms`).join('\t') + `\tUPNG ${row.upngBytes} B/${row.upngMs} ms\n`);
}

const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
const totals = { inputBytes: sum('inputBytes'), upngBytes: sum('upngBytes'), upngMs: +sum('upngMs').toFixed(2) };
for (const level of [0, 1, 2, 3]) {
  totals[`o${level}Bytes`] = sum(`o${level}Bytes`);
  totals[`o${level}Ms`] = +sum(`o${level}Ms`).toFixed(2);
}
const summary = {
  generatedAt: new Date().toISOString(),
  oxipngTs: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  upng: upngVersion.stdout.trim(),
  options: { optimizationLevels: [0, 1, 2, 3], runs, warmup, upngCnum: 0 },
  totals,
  rows,
};
writeFileSync(join(outputDir, 'upng-results.json'), `${JSON.stringify(summary, null, 2)}\n`);
const pctDelta = (bytes, ref) => `${(((bytes - ref) / ref) * 100).toFixed(2)}%`;
const fmtMs = (ms) => `${ms.toFixed(1)} ms`;
const lines = [
  '# oxipng-ts presets vs UPNG.js',
  '',
  `Generated: ${summary.generatedAt}`,
  '',
  `- oxipng-ts ${summary.oxipngTs}, CLI; presets passed as \`-o 0\` through \`-o 3\`.`,
  `- ${summary.upng}, lossless encoding with \`cnum=0\`; source metadata is not preserved.`,
  `- Best of ${runs} runs after ${warmup} warmup runs; fresh Node process per measurement, including startup, read, encode and write.`,
  '- PNG dimensions and decoded pixels are checked for every result outside the timed interval.',
  '',
  '## Results',
  '',
  '| File | Input | -o 0 size / time | -o 1 size / time | -o 2 size / time | -o 3 size / time | UPNG size / time |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for (const row of rows) {
  lines.push(`| ${row.name} | ${row.inputBytes} B | ${row.o0Bytes} B / ${fmtMs(row.o0Ms)} | ${row.o1Bytes} B / ${fmtMs(row.o1Ms)} | ${row.o2Bytes} B / ${fmtMs(row.o2Ms)} | ${row.o3Bytes} B / ${fmtMs(row.o3Ms)} | ${row.upngBytes} B / ${fmtMs(row.upngMs)} |`);
}
lines.push(`| **Total** | **${totals.inputBytes} B** | **${totals.o0Bytes} B / ${fmtMs(totals.o0Ms)} (${pctDelta(totals.o0Bytes, totals.upngBytes)})** | **${totals.o1Bytes} B / ${fmtMs(totals.o1Ms)} (${pctDelta(totals.o1Bytes, totals.upngBytes)})** | **${totals.o2Bytes} B / ${fmtMs(totals.o2Ms)} (${pctDelta(totals.o2Bytes, totals.upngBytes)})** | **${totals.o3Bytes} B / ${fmtMs(totals.o3Ms)} (${pctDelta(totals.o3Bytes, totals.upngBytes)})** | **${totals.upngBytes} B / ${fmtMs(totals.upngMs)}** |`);
lines.push('', 'Size percentage is relative to UPNG.js; negative means smaller. oxipng-ts retains the input PNG format and can preserve metadata, while UPNG.js decodes and re-encodes pixels.', '');
writeFileSync(join(outputDir, 'UPNG-REPORT.md'), lines.join('\n'));
console.log(`Totals: ${JSON.stringify(totals)}`);
console.log(`Reports written to ${join(outputDir, 'UPNG-REPORT.md')} and ${join(outputDir, 'upng-results.json')}`);
