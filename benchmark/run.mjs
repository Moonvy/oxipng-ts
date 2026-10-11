#!/usr/bin/env node
// Compare Rust, Node, and native builds discovered in dist/bin.
// node benchmark/run.mjs [--minimal] [--opt 2] [--runs 3] [--warmup 0] [--output-dir DIR]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createProgress, duration } from './progress.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const here = join(root, 'benchmark');
const binDir = join(root, 'dist', 'bin');
const tsCliPath = join(root, 'dist', 'js', 'cli.js');
const startupImagePath = join(root, 'test', 'files', 'fully_optimized.png');
const startupRuns = 3;
const executable = name => process.platform === 'win32' ? `${name}.exe` : name;
function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const level = argValue('--opt', '2');
const runs = Number(argValue('--runs', '3'));
const warmup = Number(argValue('--warmup', '0'));
const outputDir = argValue('--output-dir', here);
if (!/^[0-6]$/.test(level) || !Number.isSafeInteger(runs) || runs < 3 || warmup !== 0) {
  throw new Error('--opt must be 0–6, --runs must be at least 3, and --warmup must be 0.');
}

function version(bin, prefix = []) {
  console.log(`  检查程序：${[bin, ...prefix].join(' ')}`);
  const result = spawnSync(bin, [...prefix, '--version'], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error(`Could not run ${bin}: ${result.error?.message || result.stderr || `exit ${result.status}, signal ${result.signal}`}`);
  return result.stdout.trim();
}
function findNative() {
  if (process.env.OXIPNG_BIN) return { bin: process.env.OXIPNG_BIN, version: version(process.env.OXIPNG_BIN) };
  for (const bin of [join(binDir, executable('oxipng')), 'oxipng', join(homedir(), '.local', 'bin', 'oxipng'),
    '/tmp/oxipng-ref/target/release/oxipng', '/opt/homebrew/bin/oxipng', '/usr/local/bin/oxipng']) {
    try { return { bin, version: version(bin) }; } catch { /* Try the next installed Rust CLI. */ }
  }
  throw new Error('Rust oxipng is required: place it in dist/bin/oxipng, install it on PATH, or set OXIPNG_BIN.');
}
if (!existsSync(tsCliPath)) throw new Error('dist/js/cli.js not found — run `npm run build:ts` first.');
console.log('\n  PNG CLI BENCHMARK\n  正在检查可用程序…\n');
const native = findNative();
const engines = [
  { id: 'native', label: 'Rust', bin: native.bin, prefix: [], version: native.version,
    sizeKey: 'nativeSize', timeKey: 'nativeMs', bytesKey: 'nativeBytes', startupKey: 'nativeStartupMs' },
  { id: 'ts', label: 'Node', bin: process.execPath, prefix: [tsCliPath], version: version(process.execPath, [tsCliPath]),
    sizeKey: 'tsSize', timeKey: 'tsCliMs', bytesKey: 'tsBytes', startupKey: 'tsCliStartupMs' },
];
// Minimal runs skip optional native engines, including their version checks.
const optionalEngines = process.argv.includes('--minimal') ? [] : [
  ['porffor', 'Porffor', 'oxipng-ts-porffor', 'OXIPNG_TS_PORFFOR_BIN'],
  ['scriptc', 'ScriptC', 'oxipng-ts-scriptc', 'OXIPNG_TS_SCRIPTC_BIN'],
];
for (const [id, label, filename, override] of optionalEngines) {
  const bin = process.env[override] || join(binDir, executable(filename));
  if (!existsSync(bin) && !process.env[override]) {
    console.log(`  跳过 ${label}：未找到 ${bin}`);
    continue;
  }
  engines.push({ id, label, bin, prefix: [], version: version(bin),
    build: existsSync(`${bin}.build.json`) ? JSON.parse(readFileSync(`${bin}.build.json`, 'utf8')) : null,
    sizeKey: `${id}Size`, timeKey: `${id}Ms`, bytesKey: `${id}Bytes`, startupKey: `${id}StartupMs` });
}
const sampleDir = join(here, 'sample');
const files = readdirSync(sampleDir).filter(name => /\.(png|apng)$/i.test(name)).sort();
if (!files.length) throw new Error(`No PNG files found in ${sampleDir}.`);
const startupImage = readFileSync(startupImagePath);
if (startupImage.readUInt32BE(16) !== 1 || startupImage.readUInt32BE(20) !== 1) {
  throw new Error(`${startupImagePath} must be a 1×1 PNG.`);
}
const progress = createProgress(files.length * engines.length * runs + engines.length * startupRuns);
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
console.log(`\n  实现    ${engines.map(engine => engine.label).join(' / ')}\n  样本    ${files.length} 张 · -o ${level}\n  启动    1×1 PNG 压缩 ${startupRuns} 次，取最快值\n  计时    每项测量 ${runs} 次，剔除最快值后平均其余 ${runs - 1} 次\n  输出    ${outputDir}\n`);

async function measure(fn, label, { runCount = runs, discardFastest = false } = {}) {
  let fastest = Infinity;
  let fastestValue;
  let lastValue;
  const measuredTimes = [];
  for (let i = 0; i < runCount; i++) {
    const round = `测量 ${i + 1}/${runCount}`;
    progress.begin(`${round} · ${label}`);
    const start = performance.now();
    let measured;
    let elapsed;
    try {
      measured = await fn(i);
      elapsed = performance.now() - start;
    } catch (error) {
      throw new Error(`${label} · ${round} · ${duration(performance.now() - start)} 后失败：${error.message}`, { cause: error });
    } finally {
      progress.end();
    }
    progress.complete();
    measuredTimes.push(elapsed);
    lastValue = measured;
    if (elapsed < fastest) { fastest = elapsed; fastestValue = measured; }
    if (!process.stdout.isTTY) progress.log(`    完成 ${round} · ${duration(elapsed)}`);
  }
  const times = discardFastest ? measuredTimes.sort((a, b) => a - b).slice(1) : measuredTimes;
  return {
    ms: discardFastest ? times.reduce((sum, value) => sum + value, 0) / times.length : fastest,
    value: discardFastest ? lastValue : fastestValue,
  };
}
function spawnCli(engine, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(engine.bin, [...engine.prefix, ...args], {
      stdio: ['ignore', 'ignore', 'pipe'], signal: controller.signal,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-65_536); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${engine.label}: ${stderr.trim() || `exit ${code}, signal ${signal}`}`));
    });
  });
}

async function main() {
  progress.log('  ── 启动时间 ─────────────────────────────────────');
  const startupDir = mkdtempSync(join(tmpdir(), 'oxipng-startup-'));
  try {
    for (const engine of engines) {
      const outputs = [];
      const measured = await measure(async runIndex => {
        const output = join(startupDir, `${engine.id}-${runIndex}.png`);
        outputs.push(output);
        await spawnCli(engine, ['-o', level, '--out', output, startupImagePath]);
      }, `启动 · ${engine.label}`, { runCount: startupRuns });
      if (outputs.some(output => !existsSync(output))) {
        throw new Error(`${engine.label} startup sample did not write its compressed PNG.`);
      }
      engine.startupMs = measured.ms;
      progress.log(`  ✓ ${engine.label.padEnd(8)} 启动最快 ${duration(engine.startupMs)}（1×1 PNG，${startupRuns} 次）`);
    }
  } finally {
    rmSync(startupDir, { recursive: true, force: true });
  }
  const rows = [];
  const workDir = mkdtempSync(join(tmpdir(), 'oxipng-bench-'));
  try {
    for (const [index, name] of files.entries()) {
      const file = join(sampleDir, name);
      const row = { name, originalSize: statSync(file).size };
      progress.log(`\n  ── 图片 ${index + 1}/${files.length}：${name} (${row.originalSize.toLocaleString('en-US')} B) ──`);
      for (const engine of engines) {
        const output = join(workDir, `${engine.id}.png`);
        const measured = await measure(async () => {
          // Do not let an output left by an earlier run hide a missing write.
          rmSync(output, { force: true });
          await spawnCli(engine, ['-o', level, '--out', output, file]);
          return statSync(output).size;
        }, `[图片 ${index + 1}/${files.length}] ${engine.label} · ${name}`, { runCount: runs, discardFastest: true });
        row[engine.sizeKey] = measured.value;
        row[engine.timeKey] = measured.ms;
        if (engine.id !== 'native' && engine.id !== 'ts') {
          progress.log(`  · ${engine.label.padEnd(8)} 正在检查与 Node 的字节一致性…`);
          // Compare bytes outside the timed region; fail before publishing reports.
          row[`${engine.id}MatchesTs`] = readFileSync(output).equals(readFileSync(join(workDir, 'ts.png')));
          if (!row[`${engine.id}MatchesTs`]) throw new Error(`${engine.label} output differs from Node output for ${name}.`);
          row[`${engine.id}SizeDelta`] = measured.value - row.nativeSize;
        }
        progress.log(`  ✓ ${engine.label.padEnd(8)} ${measured.value.toLocaleString('en-US').padStart(11)} B · 平均 ${duration(measured.ms)}${engine.id !== 'native' && engine.id !== 'ts' ? ' · 字节一致' : ''}`);
      }
      row.sizeDelta = row.tsSize - row.nativeSize;
      rows.push(row);
      progress.log(`  ✓ 图片 ${index + 1}/${files.length} 已完成`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  const pct = (a, b) => `${((a / b) * 100).toFixed(2)}%`;
  const delta = value => `${value > 0 ? '+' : ''}${value}`;
  const fmtMs = ms => ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(1)} ms`;
  const totals = { files: rows.length, originalBytes: sum('originalSize') };
  const tsPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const summary = {
    generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, node: process.version },
    options: {
      opt: level, runs, warmup, startupRuns,
      timeAggregation: 'drop-fastest-mean',
    }, totals, rows,
  };
  for (const engine of engines) {
    totals[engine.bytesKey] = sum(engine.sizeKey);
    totals[engine.timeKey] = sum(engine.timeKey);
    totals[engine.startupKey] = engine.startupMs;
    summary[engine.id] = engine.id === 'ts'
      ? { name: tsPackage.name, version: tsPackage.version, cliStartupMs: engine.startupMs }
      : { bin: engine.bin, version: engine.version, startupMs: engine.startupMs, ...(engine.build !== undefined ? { build: engine.build } : {}) };
  }
  totals.sizeOverheadPercent = (totals.tsBytes - totals.nativeBytes) / totals.nativeBytes * 100;
  totals.slowdown = totals.tsCliMs / totals.nativeMs;
  const compiled = engines.slice(2);
  for (const engine of compiled) {
    totals[`${engine.id}SizeOverheadPercent`] = (totals[engine.bytesKey] - totals.nativeBytes) / totals.nativeBytes * 100;
    totals[`${engine.id}VsNativeTimeRatio`] = totals[engine.timeKey] / totals.nativeMs;
    totals[`${engine.id}VsNodeTimeRatio`] = totals[engine.timeKey] / totals.tsCliMs;
    totals[`${engine.id}MatchesTs`] = rows.every(row => row[`${engine.id}MatchesTs`] === true);
  }

  const lines = ['# oxipng-ts benchmark', '', `Generated: ${summary.generatedAt}`, ''];
  for (const engine of engines) {
    lines.push(`- ${engine.label}: **${engine.version}** (\`${[engine.bin, ...engine.prefix].join(' ')}\`, startup ≈ ${fmtMs(engine.startupMs)}${engine.build !== undefined ? `; compiler ${engine.build?.version || 'unknown'}, mode: ${engine.build?.mode || 'unknown (external binary)'}` : ''})`);
  }
  lines.push(`- Host: ${summary.environment.platform}/${summary.environment.arch}, ${summary.environment.cpu}, Node ${summary.environment.node}`);
  lines.push(`- Options: \`-o ${level}\` applied identically to all ${engines.length} tools`);
  lines.push(`- Timing: ${runs} fresh processes per image, no warmup; discard the fastest run and average the remaining ${runs - 1}, with startup included`);
  lines.push(`- Startup: best of ${startupRuns} fresh processes compressing the 1×1 PNG at \`test/files/fully_optimized.png\`; no warmup`);
  lines.push(`- Native builds: automatically discovered in \`dist/bin\`; explicit binary environment overrides take precedence`);
  lines.push(`- Input directory: \`benchmark/sample\` (${rows.length} files)`, '', '## Output size', '');
  const tableRow = cells => `| ${cells.join(' | ')} |`;
  lines.push(tableRow(['File', 'Input (B)', ...engines.map(engine => `${engine.label} (B)`), 'TS − Rust (B)', 'All TS bytes']));
  lines.push(tableRow(['---', '---:', ...engines.map(() => '---:'), '---:', '---']));
  for (const row of rows) lines.push(tableRow([row.name, row.originalSize, ...engines.map(engine => row[engine.sizeKey]), `${delta(row.sizeDelta)} (${pct(row.sizeDelta, row.nativeSize)})`, compiled.length ? 'identical' : 'Node only']));
  lines.push(tableRow(['**Total**', totals.originalBytes, ...engines.map(engine => totals[engine.bytesKey]), `${delta(totals.tsBytes - totals.nativeBytes)} (${pct(totals.tsBytes - totals.nativeBytes, totals.nativeBytes)})`, compiled.length ? 'identical' : 'Node only']));
  lines.push('', '## CLI time', '', 'Ratios compare summed elapsed time across all images; lower is faster.', '');
  lines.push(tableRow(['File', ...engines.map(engine => engine.label), 'Node / Rust', ...compiled.map(engine => `${engine.label} / Node`)]));
  lines.push(tableRow(['---', ...engines.map(() => '---:'), '---:', ...compiled.map(() => '---:')]));
  for (const row of rows) lines.push(tableRow([row.name, ...engines.map(engine => fmtMs(row[engine.timeKey])), `${(row.tsCliMs / row.nativeMs).toFixed(2)}×`, ...compiled.map(engine => `${(row[engine.timeKey] / row.tsCliMs).toFixed(2)}×`)]));
  lines.push(tableRow(['**Total**', ...engines.map(engine => fmtMs(totals[engine.timeKey])), `${totals.slowdown.toFixed(2)}×`, ...compiled.map(engine => `${totals[`${engine.id}VsNodeTimeRatio`].toFixed(2)}×`)]));
  lines.push('', '## Summary', '', `- **Output size:** Node output is ${pct(totals.tsBytes, totals.nativeBytes)} of Rust (${delta(totals.tsBytes - totals.nativeBytes)} bytes).`);
  for (const engine of compiled) {
    lines.push(`- **${engine.label} parity:** all ${totals.files} outputs are byte-for-byte identical to Node, checked outside the timed region; the benchmark fails on a mismatch.`);
    lines.push(`- **${engine.label} time:** ${fmtMs(totals[engine.timeKey])}, **${totals[`${engine.id}VsNodeTimeRatio`].toFixed(2)}×** Node and **${totals[`${engine.id}VsNativeTimeRatio`].toFixed(2)}×** Rust.`);
  }
  lines.push('', '## Caveats', '',
    '- All TypeScript targets execute the same built-in DEFLATE core synchronously on one thread. Rust uses libdeflate and its default thread count; this benchmark does not force `--threads 1`.',
    '- Each file starts a fresh process. Startup is reported separately and is not subtracted from file times.',
    '- All tools receive the same preset without `--force`; inputs that cannot be improved are written unchanged.',
    '- Only available native builds are measured. Missing builds are omitted, and explicitly configured binaries must run successfully.',
    '- Compiler version and mode come from adjacent `.build.json` files when available; external binaries without metadata are reported as unknown.', '');
  mkdirSync(outputDir, { recursive: true });
  progress.log('\n  ── 正在写入报告 ─────────────────────────────────');
  writeFileSync(join(outputDir, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(outputDir, 'REPORT.md'), lines.join('\n'));
  progress.log(`\n  ✓ 全部完成 · ${totals.files} 张图片 · 总用时 ${duration(progress.elapsed)}\n`);
  console.table(engines.map(engine => ({
    实现: engine.label, '输出 (B)': totals[engine.bytesKey].toLocaleString('en-US'),
    压缩耗时: duration(totals[engine.timeKey]), 启动耗时: duration(engine.startupMs),
    '相对 Node': `${(totals[engine.timeKey] / totals.tsCliMs).toFixed(2)}×`,
  })));
  progress.log(`\n  报告  ${join(outputDir, 'REPORT.md')}\n  数据  ${join(outputDir, 'results.json')}\n`);
}

try {
  await main();
} catch (error) {
  progress.log(`\n  ✗ ${controller.signal.aborted ? '测量已中断；未更新报告。' : error.message}\n`);
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  progress.end();
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
