#!/usr/bin/env node
// Benchmarks Rust, Node, Porffor, and ScriptC (static LLVM) on every PNG in
// benchmark/sample, using identical options, and writes benchmark/REPORT.md
// plus benchmark/results.json.
//
//   node benchmark/run.mjs [--opt 2] [--runs 5] [--warmup 1]
//
// All tools are invoked as CLIs with the same arguments, including process startup.
//
// Native binary resolution: $OXIPNG_BIN, PATH, ~/.local/bin, local build,
// and standard Homebrew / system installation paths.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sampleDir = join(here, 'sample');
const tsCliPath = join(root, 'dist', 'cli.js');
const porfforCliPath = process.env.OXIPNG_TS_PORFFOR_BIN || join(root, 'dist', 'oxipng-ts-porffor');
const scriptcCliPath = process.env.OXIPNG_TS_SCRIPTC_BIN || join(root, 'dist', 'oxipng-ts-scriptc');

/* ------------------------------------------------------------------- args --- */

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const level = argValue('--opt', '2');
const runs = Number(argValue('--runs', '5'));
const warmup = Number(argValue('--warmup', '1'));
if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(warmup) || warmup < 0) {
  console.error('--runs must be a positive integer and --warmup a non-negative integer.');
  process.exit(1);
}

/* ----------------------------------------------------------------- checks --- */

function findNative() {
  const candidates = [
    process.env.OXIPNG_BIN,
    'oxipng',
    join(homedir(), '.local', 'bin', 'oxipng'),
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
  console.error('Rust oxipng is required for this benchmark. Install it (macOS: `brew install oxipng`), place it in ~/.local/bin, or set OXIPNG_BIN=/path/to/oxipng.');
  process.exit(1);
}
if (!existsSync(tsCliPath)) {
  console.error('dist/cli.js not found — run `npm run build` first.');
  process.exit(1);
}
if (!existsSync(porfforCliPath)) {
  console.error('oxipng-ts-porffor not found — run `npm run build:porffor` after `npm run build`, or set OXIPNG_TS_PORFFOR_BIN=/path/to/oxipng-ts-porffor.');
  process.exit(1);
}
const porfforVersion = spawnSync(porfforCliPath, ['--version'], { encoding: 'utf8' });
if (porfforVersion.status !== 0) {
  console.error(`Could not run ${porfforCliPath}: ${porfforVersion.error?.message || porfforVersion.stderr || `exit ${porfforVersion.status}, signal ${porfforVersion.signal}`}`);
  process.exit(1);
}

const tsPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!existsSync(scriptcCliPath)) {
  console.error('oxipng-ts-scriptc not found — run `npm run build:scriptc` after `npm run build`, or set OXIPNG_TS_SCRIPTC_BIN=/path/to/oxipng-ts-scriptc.');
  process.exit(1);
}
const scriptcVersion = spawnSync(scriptcCliPath, ['--version'], { encoding: 'utf8' });
if (scriptcVersion.status !== 0) {
  console.error(`Could not run ${scriptcCliPath}: ${scriptcVersion.error?.message || scriptcVersion.stderr || `exit ${scriptcVersion.status}, signal ${scriptcVersion.signal}`}`);
  process.exit(1);
}
const scriptcBuild = existsSync(`${scriptcCliPath}.build.json`)
  ? JSON.parse(readFileSync(`${scriptcCliPath}.build.json`, 'utf8')) : null;

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
  const res = spawnSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  const ms = performance.now() - t0;
  if (res.status !== 0) throw new Error(`command failed: ${bin} ${args.join(' ')}\n${res.error?.message || res.stderr || `exit ${res.status}, signal ${res.signal}`}`);
  return ms;
}

function runCli(file, bin, prefix, output) {
  return bestOf(() => {
    spawnTimed(bin, [...prefix, '-o', level, '--out', output, file]);
    return statSync(output).size;
  }, runs, warmup);
}

// Startup floors, so small-file numbers can be interpreted sensibly.
const nativeStartupMs = bestOf(() => spawnTimed(native.bin, ['--version']), runs, warmup).ms;
const tsCliStartupMs = bestOf(() => spawnTimed(process.execPath, [tsCliPath, '--version']), runs, warmup).ms;
const porfforStartupMs = bestOf(() => spawnTimed(porfforCliPath, ['--version']), runs, warmup).ms;
const scriptcStartupMs = bestOf(() => spawnTimed(scriptcCliPath, ['--version']), runs, warmup).ms;

/* ------------------------------------------------------------------- main --- */

const files = readdirSync(sampleDir)
  .filter((f) => /\.(png|apng)$/i.test(f))
  .sort();
if (files.length === 0) {
  console.error(`No PNG files found in ${sampleDir}.`);
  process.exit(1);
}

const rows = [];
const workDir = mkdtempSync(join(tmpdir(), 'oxipng-bench-'));
const nativeTmp = join(workDir, 'rust.png');
const tsCliTmp = join(workDir, 'node.png');
const porfforTmp = join(workDir, 'porffor.png');
const scriptcTmp = join(workDir, 'scriptc.png');
try {
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

    const nat = runCli(file, native.bin, [], nativeTmp);
    const cli = runCli(file, process.execPath, [tsCliPath], tsCliTmp);
    const porffor = runCli(file, porfforCliPath, [], porfforTmp);
    const scriptc = runCli(file, scriptcCliPath, [], scriptcTmp);
    // Byte comparison is deliberately outside the timed region.
    const porfforMatchesTs = readFileSync(porfforTmp).equals(readFileSync(tsCliTmp));
    if (!porfforMatchesTs) throw new Error(`Porffor output differs from Node output for ${name}.`);
    const scriptcMatchesTs = readFileSync(scriptcTmp).equals(readFileSync(tsCliTmp));
    if (!scriptcMatchesTs) throw new Error(`ScriptC output differs from Node output for ${name}.`);

    rows.push({
      name,
      originalSize,
      nativeSize: nat.value,
      tsSize: cli.value,
      sizeDelta: cli.value - nat.value,
      nativeMs: nat.ms,
      tsCliMs: cli.ms,
      porfforSize: porffor.value,
      porfforSizeDelta: porffor.value - nat.value,
      porfforMs: porffor.ms,
      porfforMatchesTs,
      scriptcSize: scriptc.value,
      scriptcSizeDelta: scriptc.value - nat.value,
      scriptcMs: scriptc.ms,
      scriptcMatchesTs,
    });
    process.stdout.write(
      `  ${name.padEnd(46)} ` +
        `size Rust/Node/Porffor/ScriptC ${nat.value}/${cli.value}/${porffor.value}/${scriptc.value} B  ` +
        `time ${nat.ms.toFixed(1)}/${cli.ms.toFixed(1)}/${porffor.ms.toFixed(1)}/${scriptc.ms.toFixed(1)} ms  bytes match\n`,
    );
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

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
  porfforBytes: sum('porfforSize'),
  porfforMs: sum('porfforMs'),
  scriptcBytes: sum('scriptcSize'),
  scriptcMs: sum('scriptcMs'),
};
totals.sizeOverheadPercent = ((totals.tsBytes - totals.nativeBytes) / totals.nativeBytes) * 100;
totals.slowdown = totals.tsCliMs / totals.nativeMs;
totals.nativeStartupMs = nativeStartupMs;
totals.tsCliStartupMs = tsCliStartupMs;
totals.porfforStartupMs = porfforStartupMs;
totals.porfforSizeOverheadPercent = ((totals.porfforBytes - totals.nativeBytes) / totals.nativeBytes) * 100;
totals.porfforVsNativeTimeRatio = totals.porfforMs / totals.nativeMs;
totals.porfforVsNodeTimeRatio = totals.porfforMs / totals.tsCliMs;
totals.porfforMatchesTs = rows.every((r) => r.porfforMatchesTs);
totals.scriptcStartupMs = scriptcStartupMs;
totals.scriptcSizeOverheadPercent = ((totals.scriptcBytes - totals.nativeBytes) / totals.nativeBytes) * 100;
totals.scriptcVsNativeTimeRatio = totals.scriptcMs / totals.nativeMs;
totals.scriptcVsNodeTimeRatio = totals.scriptcMs / totals.tsCliMs;
totals.scriptcMatchesTs = rows.every((r) => r.scriptcMatchesTs);

const summary = {
  generatedAt: new Date().toISOString(),
  native: { bin: native.bin, version: native.version, startupMs: nativeStartupMs },
  ts: { name: tsPackage.name, version: tsPackage.version, cliStartupMs: tsCliStartupMs },
  porffor: { bin: porfforCliPath, version: porfforVersion.stdout.trim(), startupMs: porfforStartupMs },
  scriptc: { bin: scriptcCliPath, version: scriptcVersion.stdout.trim(), startupMs: scriptcStartupMs, build: scriptcBuild },
  environment: { platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, node: process.version },
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
lines.push(`- oxipng-ts-porffor: **${summary.porffor.version}** CLI (\`${porfforCliPath}\`, startup ≈ ${fmtMs(porfforStartupMs)})`);
lines.push(`- oxipng-ts-scriptc: **${summary.scriptc.version}** CLI (\`${scriptcCliPath}\`, startup ≈ ${fmtMs(scriptcStartupMs)}; compiler ${scriptcBuild?.version || 'unknown'}, mode: ${scriptcBuild?.mode || 'unknown (external binary)'})`);
lines.push(`- Host: ${summary.environment.platform}/${summary.environment.arch}, ${summary.environment.cpu}, Node ${summary.environment.node}`);
lines.push(`- Options: \`-o ${level}\` applied identically to all four tools`);
lines.push(`- Timing: best of ${runs} runs (${warmup} warmup), CLI vs CLI (process startup included for all four)`);
lines.push(`- Input directory: \`benchmark/sample\` (${rows.length} files)`);
lines.push('');
lines.push('## Output size');
lines.push('');
lines.push('| File | Input (B) | Rust (B) | Node (B) | Porffor (B) | ScriptC (B) | TS − Rust (B) | All TS bytes |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
for (const r of rows) {
  lines.push(
    `| ${r.name} | ${r.originalSize} | ${r.nativeSize} | ${r.tsSize} | ${r.porfforSize} | ${r.scriptcSize} | ${delta(r.sizeDelta)} (${pct(r.sizeDelta, r.nativeSize)}) | identical |`,
  );
}
lines.push(
  `| **Total** | **${totals.originalBytes}** | **${totals.nativeBytes}** | **${totals.tsBytes}** | **${totals.porfforBytes}** | **${totals.scriptcBytes}** | **${delta(totals.tsBytes - totals.nativeBytes)} (${pct(totals.tsBytes - totals.nativeBytes, totals.nativeBytes)})** | **identical** |`,
);
lines.push('');
lines.push('## CLI time');
lines.push('');
lines.push('Ratios show elapsed time relative to the denominator; lower is faster.');
lines.push('');
lines.push('| File | Rust | Node | Porffor | ScriptC | Node / Rust | Porffor / Node | ScriptC / Node |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const r of rows) {
  lines.push(`| ${r.name} | ${fmtMs(r.nativeMs)} | ${fmtMs(r.tsCliMs)} | ${fmtMs(r.porfforMs)} | ${fmtMs(r.scriptcMs)} | ${(r.tsCliMs / r.nativeMs).toFixed(2)}× | ${(r.porfforMs / r.tsCliMs).toFixed(2)}× | ${(r.scriptcMs / r.tsCliMs).toFixed(2)}× |`);
}
lines.push(`| **Total** | **${fmtMs(totals.nativeMs)}** | **${fmtMs(totals.tsCliMs)}** | **${fmtMs(totals.porfforMs)}** | **${fmtMs(totals.scriptcMs)}** | **${totals.slowdown.toFixed(2)}×** | **${totals.porfforVsNodeTimeRatio.toFixed(2)}×** | **${totals.scriptcVsNodeTimeRatio.toFixed(2)}×** |`);
lines.push('');
lines.push('## Summary');
lines.push('');
lines.push(
  `- **Output size:** oxipng-ts produced **${pct(totals.tsBytes, totals.nativeBytes)}** of native oxipng's total — ` +
    `${pct(Math.abs(totals.tsBytes - totals.nativeBytes), totals.nativeBytes)} ${totals.tsBytes >= totals.nativeBytes ? 'larger' : 'smaller'} ` +
    `(${delta(totals.tsBytes - totals.nativeBytes)} bytes over ${totals.files} files).`,
);
lines.push(`- **Porffor parity:** all ${totals.files} outputs are byte-for-byte identical to Node output. This check is outside the timed region; the benchmark fails on a mismatch.`);
lines.push(`- **ScriptC parity:** all ${totals.files} outputs are byte-for-byte identical to Node output, checked outside the timed region.`);
lines.push(`- **Time (CLI vs CLI):** Rust ${fmtMs(totals.nativeMs)}, Node ${fmtMs(totals.tsCliMs)}, Porffor ${fmtMs(totals.porfforMs)}. Porffor took **${totals.porfforVsNodeTimeRatio.toFixed(2)}×** Node's time and **${totals.porfforVsNativeTimeRatio.toFixed(2)}×** Rust's time.`);
lines.push(`- **ScriptC time:** ${fmtMs(totals.scriptcMs)}, **${totals.scriptcVsNodeTimeRatio.toFixed(2)}×** Node's time and **${totals.scriptcVsNativeTimeRatio.toFixed(2)}×** Rust's time.`);
lines.push('');
lines.push('## Caveats');
lines.push('');
lines.push(
  '- oxipng-ts uses its own built-in pure-JavaScript DEFLATE encoder (LZ77 + lazy matching + dynamic' +
    ' Huffman) rather than libdeflate in Node, Porffor, and ScriptC builds; the TS − Rust column' +
    ' quantifies that gap per file.',
);
lines.push(`- All tools start a fresh process per file. Startup floors: Rust ${fmtMs(nativeStartupMs)}, Node ${fmtMs(tsCliStartupMs)}, Porffor ${fmtMs(porfforStartupMs)}, ScriptC ${fmtMs(scriptcStartupMs)}. Reported file times include startup; it is not subtracted.`);
lines.push('- Node, Porffor, and ScriptC execute the same TypeScript optimization core synchronously on one thread. Rust oxipng uses its default thread count (logical CPU count); this benchmark does not force `--threads 1`.');
lines.push('- The default ScriptC build compiles the CLI and compression core statically through LLVM without a JavaScript engine. Its build gates require zero failed/dynamic statements and no dynamic-engine references in LLVM output. External binary build metadata is shown above when available.');
lines.push('- All tools receive the same `-o` preset and identical semantics (no `--force`, so a file that cannot be improved is written unchanged).');
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
console.log(`Porffor output:     ${totals.porfforBytes} B  (byte-for-byte identical to Node)`);
console.log(`Porffor time:       ${fmtMs(totals.porfforMs)}  (${totals.porfforVsNodeTimeRatio.toFixed(2)}× Node, ${totals.porfforVsNativeTimeRatio.toFixed(2)}× native)`);
console.log(`ScriptC output:     ${totals.scriptcBytes} B  (byte-for-byte identical to Node)`);
console.log(`ScriptC time:       ${fmtMs(totals.scriptcMs)}  (${totals.scriptcVsNodeTimeRatio.toFixed(2)}× Node, ${totals.scriptcVsNativeTimeRatio.toFixed(2)}× native; mode: ${scriptcBuild?.mode || 'unknown'})`);
console.log(`Startup Rust/Node/Porffor/ScriptC: ${fmtMs(nativeStartupMs)} / ${fmtMs(tsCliStartupMs)} / ${fmtMs(porfforStartupMs)} / ${fmtMs(scriptcStartupMs)}`);
console.log('');
console.log('Report written to benchmark/REPORT.md and benchmark/results.json');
