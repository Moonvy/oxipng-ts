#!/usr/bin/env node
// Fresh-process preset comparison with independent PNG/APNG validation.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { assertPngEqual, decodePng } from './verify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const settings = { runs: 3, rust: process.env.OXIPNG_BIN || 'oxipng', output: join(here, 'presets.json'), profiles: 'presets' };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].slice(2);
  if (!args[i].startsWith('--') || !(key in settings) || args[i + 1] === undefined) throw Error(`Invalid option: ${args[i]}`);
  settings[key] = key === 'runs' ? Number(args[i + 1]) : args[i + 1];
}
if (!Number.isSafeInteger(settings.runs) || settings.runs < 1) throw Error('--runs must be positive');
const customProfiles = [
  { name: 'budget-before', level: 2, flags: ['--zc', '11'] },
  { name: 'budget-current', level: 2, flags: [] },
  { name: 'baseline-o2', level: 2, flags: [] },
  { name: 'two-filters-z11', level: 1, flags: ['--zc', '11'] },
  { name: 'two-filters-z12', level: 1, flags: ['--zc', '12'] },
  { name: 'four-filters-z12', level: 2, flags: ['--zc', '12'] },
  { name: 'o5-fast', level: 5, flags: ['--fast'] },
  { name: 'o6-fast-brute1', level: 6, flags: ['--fast', '--brute-level', '1'] },
];
const profiles = settings.profiles === 'presets'
  ? Array.from({ length: 7 }, (_, level) => ({ level, flags: [] }))
  : settings.profiles.split(',').map(name => {
    const profile = customProfiles.find(p => p.name === name);
    if (!profile) throw Error(`Unknown profile: ${name}`);
    return profile;
  });
const version = spawnSync(settings.rust, ['--version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) throw Error(`Cannot run Rust oxipng: ${version.error ?? version.stderr}`);
const inputs = readdirSync(join(here, 'sample')).filter(name => /\.png$/i.test(name)).sort().map(name => {
  const path = join(here, 'sample', name), data = readFileSync(path);
  return { name, path, bytes: data.length, decoded: decodePng(data) };
});
if (!inputs.length) throw Error('No sample PNGs');
const engines = [
  { name: 'rust', command: settings.rust, prefix: [] },
  { name: 'node', command: process.execPath, prefix: [join(root, 'dist/js/cli.js')] },
];
// Tuned settings are specific to this Node implementation.
if (settings.profiles !== 'presets') engines.splice(0, 1);
const report = {
  generatedAt: new Date().toISOString(),
  environment: { cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch, node: process.version, rust: version.stdout.trim() },
  settings: { ...settings, warmup: 0, timing: 'Fresh CLI process per file; startup included; alternate engines; pixel checks outside timing', rustThreads: 'default' },
  bundleSha256: createHash('sha256').update(readFileSync(join(root, 'dist/js/index.js'))).digest('hex'),
  complete: false, rows: [], totals: [],
};
const median = times => {
  const sorted = [...times].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
function save() { writeFileSync(resolve(settings.output), JSON.stringify(report, null, 2) + '\n'); }
function run(engine, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(engine.command, [...engine.prefix, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-65536); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(Error(`${engine.name}: ${stderr || `exit ${code}`}`)));
  });
}
const work = mkdtempSync(join(tmpdir(), 'oxipng-presets-'));
save();
try {
  for (const profile of profiles) {
    const { level, name, flags } = profile;
    const profileRows = [];
    for (const input of inputs) {
      const row = { level, ...(name ? { profile: name, flags } : {}), name: input.name, inputBytes: input.bytes };
      for (const engine of engines) row[engine.name] = { samplesMs: [], bytes: null, sha256: null };
      for (let round = 0; round < settings.runs; round++) {
        for (const engine of round % 2 ? [...engines].reverse() : engines) {
          const outputPath = join(work, engine.name + '.png');
          rmSync(outputPath, { force: true });
          console.log(`${name ?? `-o ${level}`} ${input.name}: ${engine.name} ${round + 1}/${settings.runs} starting`);
          const start = performance.now();
          await run(engine, ['-o', String(level), ...flags, '--out', outputPath, input.path]);
          const elapsed = performance.now() - start;
          const output = readFileSync(outputPath);
          assertPngEqual(input.decoded, decodePng(output));
          const sha256 = createHash('sha256').update(output).digest('hex');
          const result = row[engine.name];
          if (result.sha256 !== null && result.sha256 !== sha256) throw Error(`Nondeterministic output: ${engine.name}, ${input.name}, -o ${level}`);
          result.bytes = output.length;
          result.sha256 = sha256;
          result.samplesMs.push(elapsed);
          console.log(`  ${output.length} B / ${elapsed.toFixed(1)} ms`);
        }
      }
      for (const engine of engines) {
        const result = row[engine.name];
        result.minMs = Math.min(...result.samplesMs);
        result.medianMs = median(result.samplesMs);
      }
      report.rows.push(row);
      profileRows.push(row);
      save();
    }
    const rows = profileRows;
    const total = { level, ...(name ? { profile: name, flags } : {}) };
    for (const engine of engines) total[engine.name] = {
      bytes: rows.reduce((sum, row) => sum + row[engine.name].bytes, 0),
      minMs: rows.reduce((sum, row) => sum + row[engine.name].minMs, 0),
      medianMs: rows.reduce((sum, row) => sum + row[engine.name].medianMs, 0),
    };
    if (total.rust) total.sizeGapPercent = (total.node.bytes / total.rust.bytes - 1) * 100;
    report.totals.push(total);
    save();
    console.log(`DONE ${name ?? `-o ${level}`}: ${JSON.stringify(total)}`);
  }
  report.complete = true;
  save();
} finally { rmSync(work, { recursive: true, force: true }); }
