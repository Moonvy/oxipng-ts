#!/usr/bin/env node
// Benchmarks the native oxipng CLI against the oxipng-ts CLI on every PNG in
// benchmark/sample, using identical options, and writes benchmark/REPORT.md
// plus benchmark/results.json.
//
//   node benchmark/run.mjs [--opt 2] [--runs 5] [--warmup 1]
//
// Both tools are invoked as CLIs with the same arguments, so the comparison is
// like-for-like (Node startup included for oxipng-ts).
//
// Native binary resolution order: $OXIPNG_BIN, `oxipng` on PATH,
// /tmp/oxipng-ref/target/release/oxipng.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sampleDir = join(here, 'sample');
const tsCliPath = join(root, 'dist', 'cli.js');

/* ------------------------------------------------------------------- args --- */

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const level = argValue('--opt', '2');
const runs = Number(argValue('--runs', '5'));
const warmup = Number(argValue('--warmup', '1'));

/* ----------------------------------------------------------------- checks --- */

function findNative() {
  const candidates = [
    process.env.OXIPNG_BIN,
    'oxipng',
    '/tmp/oxipng-ref/target/release/oxipng',
    '/opt/homebrew/bin/oxipng',
    '/usr/local/bin/oxipng',
  ].filter(Boolean);
  for (const c of candidates) {
    const res = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout) return { bin: c, version: res.stdout.trim() };
  }
  return null;
}

const native = findNative();
if (!native) {
  console.error('Could not find a native oxipng binary. Set OXIPNG_BIN=/path/to/oxipng.');
  process.exit(1);
}
if (!existsSync(tsCliPath)) {
  console.error('dist/cli.js not found — run `npm run build` first.');
  process.exit(1);
}

const tsPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/* -------------------------------------------------------------- measuring --- */

/** Run `fn` `warmup` times, then time `times` runs and keep the fastest. */
function bestOf(fn, times, warmups) {
  for (let i = 0; i < warmups; i++) fn();
  let best = Infinity;
  let value;
  for (let i = 0; i < times; i++) {
    const t0 = performance.now();
    value = fn();
    const dt = performance.now() - t0;
    if (dt < best) best = dt;
  }
  return { ms: best, value };
}

function spawnTimed(bin, args) {
  const t0 = performance.now();
  const res = spawnSync(bin, args, { stdio: 'ignore' });
  const ms = performance.now() - t0;
  if (res.status !== 0) throw new Error(`command failed: ${bin} ${args.join(' ')}`);
  return ms;
}

const nativeTmp = join(tmpdir(), `oxipng-bench-native-${process.pid}.png`);
const tsCliTmp = join(tmpdir(), `oxipng-bench-ts-${process.pid}.png`);

function runNative(file) {
  return bestOf(() => {
    spawnTimed(native.bin, ['-o', level, '--out', nativeTmp, file]);
    return statSync(nativeTmp).size;
  }, runs, warmup);
}

function runTsCli(file) {
  return bestOf(() => {
    spawnTimed(process.execPath, [tsCliPath, '-o', level, '--out', tsCliTmp, file]);
    return statSync(tsCliTmp).size;
  }, runs, warmup);
}

// Startup floors, so small-file numbers can be interpreted sensibly.
const nativeStartupMs = bestOf(() => spawnTimed(native.bin, ['--version']), runs, warmup).ms;
const tsCliStartupMs = bestOf(() => spawnTimed(process.execPath, [tsCliPath, '--version']), runs, warmup).ms;

/* ------------------------------------------------------------------- main --- */

const files = readdirSync(sampleDir)
  .filter((f) => /\.(png|apng)$/i.test(f))
  .sort();
if (files.length === 0) {
  console.error(`No PNG files found in ${sampleDir}.`);
  process.exit(1);
}

const rows = [];
for (const name of files) {
  const file = join(sampleDir, name);
  // Skip files that vanish between listing and stat (e.g. a set being edited).
  let originalSize;
  try {
    originalSize = statSync(file).size;
  } catch {
    process.stdout.write(`  ${name.padEnd(46)} skipped (file disappeared)\n`);
    continue;
  }

  const nat = runNative(file);
  const cli = runTsCli(file);

  rows.push({
    name,
    originalSize,
    nativeSize: nat.value,
    tsSize: cli.value,
    sizeDelta: cli.value - nat.value,
    nativeMs: nat.ms,
    tsCliMs: cli.ms,
  });
  process.stdout.write(
    `  ${name.padEnd(46)} ` +
      `size ${String(nat.value).padStart(9)}→${String(cli.value).padStart(9)}  ` +
      `oxipng ${nat.ms.toFixed(1).padStart(8)}ms  oxipng-ts ${cli.ms.toFixed(1).padStart(8)}ms\n`,
  );
}

rmSync(nativeTmp, { force: true });
rmSync(tsCliTmp, { force: true });

if (rows.length === 0) {
  console.error('No files could be benchmarked.');
  process.exit(1);
}

/* -------------------------------------------------------------- aggregate --- */

const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
const pct = (a, b) => `${((a / b) * 100).toFixed(2)}%`;
const delta = (d) => `${d > 0 ? '+' : ''}${d}`;
const fmtMs = (ms) => (ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(1)} ms`);

const totals = {
  files: rows.length,
  originalBytes: sum('originalSize'),
  nativeBytes: sum('nativeSize'),
  tsBytes: sum('tsSize'),
  nativeMs: sum('nativeMs'),
  tsCliMs: sum('tsCliMs'),
};
totals.sizeOverheadPercent = ((totals.tsBytes - totals.nativeBytes) / totals.nativeBytes) * 100;
totals.slowdown = totals.tsCliMs / totals.nativeMs;
totals.nativeStartupMs = nativeStartupMs;
totals.tsCliStartupMs = tsCliStartupMs;

const summary = {
  generatedAt: new Date().toISOString(),
  native: { bin: native.bin, version: native.version, startupMs: nativeStartupMs },
  ts: { name: tsPackage.name, version: tsPackage.version, cliStartupMs: tsCliStartupMs },
  options: { opt: level, runs, warmup },
  totals,
  rows,
};
writeFileSync(join(here, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);

/* ----------------------------------------------------------------- report --- */

const lines = [];
lines.push('# oxipng-ts benchmark');
lines.push('');
lines.push(`Generated: ${summary.generatedAt}`);
lines.push('');
lines.push(`- Native: **${native.version}** (\`${native.bin}\`, startup ≈ ${fmtMs(nativeStartupMs)})`);
lines.push(
  `- oxipng-ts: **${tsPackage.name}@${tsPackage.version}** CLI (\`node dist/cli.js\`, startup ≈ ${fmtMs(tsCliStartupMs)})`,
);
lines.push(`- Options: \`-o ${level}\` applied identically to both`);
lines.push(`- Timing: best of ${runs} runs (${warmup} warmup), CLI vs CLI (process startup included for both)`);
lines.push(`- Input directory: \`benchmark/sample\` (${rows.length} files)`);
lines.push('');
lines.push('## Results');
lines.push('');
lines.push('| File | Input | oxipng (B) | oxipng-ts (B) | Δ size | oxipng | oxipng-ts | speed |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const r of rows) {
  lines.push(
    `| ${r.name} | ${r.originalSize} | ${r.nativeSize} | ${r.tsSize} | ${delta(r.sizeDelta)} (${pct(r.tsSize - r.nativeSize, r.nativeSize)}) | ${fmtMs(r.nativeMs)} | ${fmtMs(r.tsCliMs)} | ${(r.tsCliMs / r.nativeMs).toFixed(2)}× |`,
  );
}
lines.push(
  `| **Total** | **${totals.originalBytes}** | **${totals.nativeBytes}** | **${totals.tsBytes}** | **${delta(totals.tsBytes - totals.nativeBytes)} (${pct(totals.tsBytes - totals.nativeBytes, totals.nativeBytes)})** | **${fmtMs(totals.nativeMs)}** | **${fmtMs(totals.tsCliMs)}** | **${totals.slowdown.toFixed(2)}×** |`,
);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(
  `- **Output size:** oxipng-ts produced **${pct(totals.tsBytes, totals.nativeBytes)}** of native oxipng's total — ` +
    `${pct(Math.abs(totals.tsBytes - totals.nativeBytes), totals.nativeBytes)} ${totals.tsBytes >= totals.nativeBytes ? 'larger' : 'smaller'} ` +
    `(${delta(totals.tsBytes - totals.nativeBytes)} bytes over ${totals.files} files).`,
);
lines.push(
  `- **Time (CLI vs CLI):** native ${fmtMs(totals.nativeMs)} vs oxipng-ts ${fmtMs(totals.tsCliMs)} ` +
    `— oxipng-ts took **${totals.slowdown.toFixed(2)}×** as long.`,
);
lines.push('');
lines.push('## Caveats');
lines.push('');
lines.push(
  '- oxipng-ts uses its own built-in pure-JavaScript DEFLATE encoder (LZ77 + lazy matching + dynamic' +
    ' Huffman) rather than libdeflate, so its compressed output is somewhat larger; the Δ size column' +
    ' quantifies that gap per file.',
);
lines.push(
  '- Both tools start a fresh process per file; oxipng-ts is Node, so its per-file time includes Node startup (' +
    fmtMs(tsCliStartupMs) +
    ') versus native startup (' +
    fmtMs(nativeStartupMs) +
    ').',
);
lines.push('- oxipng-ts uses a synchronous encoder on one thread. Native oxipng uses its default thread count (logical CPU count); this benchmark does not force `--threads 1`.');
lines.push('- Both tools receive the same `-o` preset and identical semantics (no `--force`, so a file that cannot be improved is written unchanged).');
lines.push('');

writeFileSync(join(here, 'REPORT.md'), lines.join('\n'));

/* ----------------------------------------------------------------- console --- */

console.log('');
console.log(`Files:              ${totals.files}`);
console.log(`Options:            -o ${level}`);
console.log(`Native:             ${native.version}`);
console.log(`Total input:        ${totals.originalBytes} B`);
console.log(`Native output:      ${totals.nativeBytes} B`);
console.log(`oxipng-ts output:   ${totals.tsBytes} B  (${pct(totals.tsBytes, totals.nativeBytes)} of native, ${pct(Math.abs(totals.tsBytes - totals.nativeBytes), totals.nativeBytes)} ${totals.tsBytes >= totals.nativeBytes ? 'larger' : 'smaller'})`);
console.log(`Native time:        ${fmtMs(totals.nativeMs)}`);
console.log(`oxipng-ts time:     ${fmtMs(totals.tsCliMs)}  (${totals.slowdown.toFixed(2)}× native)`);
console.log('');
console.log('Report written to benchmark/REPORT.md and benchmark/results.json');
