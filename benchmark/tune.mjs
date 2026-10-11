#!/usr/bin/env node
// Screen public settings and private encoder parameters in consistently built API bundles.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPngEqual, decodePng } from './verify.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '..');
const settings = { runs: 1, warmup: 1, corpus: 'pilot', candidates: 'all', output: join(here, 'tuning-screen.json') };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].slice(2);
  if (!args[i].startsWith('--') || !(key in settings) || args[i + 1] === undefined) throw Error(`Invalid option: ${args[i]}`);
  settings[key] = ['runs', 'warmup'].includes(key) ? Number(args[i + 1]) : args[i + 1];
}
for (const key of ['runs', 'warmup']) if (!Number.isSafeInteger(settings[key]) || settings[key] < (key === 'runs' ? 1 : 0)) throw Error(`Invalid --${key}`);
if (!['pilot', 'sample', 'extended', 'validation', 'fixtures', 'fixtures-all'].includes(settings.corpus)) throw Error('Invalid --corpus');
const configs = [
  { name: 'insertion-before', compression: 11, filters: 'default', keepPresetDeflater: true, insertionDepth: 64 },
  { name: 'insertion-current', compression: 11, filters: 'default', keepPresetDeflater: true, maxGrowthPercent: 2 },
  ...[48, 32, 16, 8].map(insertionDepth => ({
    name: `insertion-${insertionDepth}`, compression: 11, filters: 'default',
    keepPresetDeflater: true, insertionDepth, maxGrowthPercent: 2,
  })),
  ...[32, 16].flatMap(insertionDepth => [750, 875].map(dominantPermille => ({
    name: `insertion-${insertionDepth}-guard${dominantPermille}`, compression: 11, filters: 'default',
    keepPresetDeflater: true, insertionDepth, dominantPermille, maxGrowthPercent: 2,
  }))),
  ...[32, 16].flatMap(insertionDepth => [8, 16].map(minSymbols => ({
    name: `insertion-${insertionDepth}-symbols${minSymbols}`, compression: 11, filters: 'default',
    keepPresetDeflater: true, insertionDepth, dominantPermille: 875, minSymbols, maxGrowthPercent: 2,
  }))),
  { name: 'insertion-24-symbols16', compression: 11, filters: 'default',
    keepPresetDeflater: true, insertionDepth: 24, dominantPermille: 875, minSymbols: 16, maxGrowthPercent: 2 },
  { name: 'budget-before', compression: 11, filters: 'default' },
  { name: 'budget-current', compression: 11, filters: 'default', keepPresetDeflater: true, maxGrowthPercent: 5 },
  { name: 'baseline-o2', compression: 11, filters: 'default' },
  { name: 'before-o2', compression: 11, filters: 'default', evaluationLevel: 7 },
  { name: 'current-o2', compression: 11, filters: 'default' },
  { name: 'three-filters-entropy', compression: 11, filters: 'entropy-bigrams' },
  { name: 'three-filters-sub', compression: 11, filters: 'sub-bigrams' },
  { name: 'stop64', compression: 11, filters: 'default', minImprovement: 64 },
  { name: 'stop128', compression: 11, filters: 'default', minImprovement: 128 },
  { name: 'skip16', compression: 11, filters: 'default', skipLength: 16 },
  { name: 'eval5', compression: 11, filters: 'default', evaluationLevel: 5 },
  { name: 'eval6', compression: 11, filters: 'default', evaluationLevel: 6 },
  { name: 'eval1', compression: 11, filters: 'default', evaluationLevel: 1 },
  { name: 'eval2', compression: 11, filters: 'default', evaluationLevel: 2 },
  { name: 'eval3', compression: 11, filters: 'default', evaluationLevel: 3 },
  { name: 'three-entropy-eval5', compression: 11, filters: 'entropy-bigrams', evaluationLevel: 5 },
  { name: 'baseline-o5', preset: 5, compression: 12, filters: 'default' },
  { name: 'two-filters-z11', compression: 11, filters: 'bigrams' },
  { name: 'two-filters-z10', compression: 10, filters: 'bigrams' },
  { name: 'four-filters-z10', compression: 10, filters: 'default' },
  { name: 'two-filters-z9', compression: 9, filters: 'bigrams' },
  { name: 'minsum-z11', compression: 11, filters: 'minsum' },
  { name: 'minsum-z9', compression: 9, filters: 'minsum' },
  { name: 'two-filters-z12', compression: 12, filters: 'bigrams' },
  { name: 'four-filters-z12', compression: 12, filters: 'default' },
  { name: 'o5-fast', preset: 5, compression: 12, filters: 'default', fastEvaluation: true },
  { name: 'o6-fast-brute1', preset: 6, compression: 12, filters: 'default', fastEvaluation: true, bruteLevel: 1 },
  { name: 'o6-brute1', preset: 6, compression: 12, filters: 'default', bruteLevel: 1 },
  { name: 'depth32-passes3', compression: 11, filters: 'default', depth: 32, passes: 3 },
  { name: 'depth64-passes0', compression: 11, filters: 'default', depth: 64, passes: 0 },
  { name: 'depth64-passes1', compression: 11, filters: 'default', depth: 64, passes: 1 },
  { name: 'depth32-passes1', compression: 11, filters: 'default', depth: 32, passes: 1 },
  { name: 'adaptive-depth-passes1', compression: 11, filters: 'default', passes: 1, adaptiveDepth: true },
  { name: 'depth48-passes3', compression: 11, filters: 'default', depth: 48, passes: 3 },
  { name: 'depth64-passes2', compression: 11, filters: 'default', depth: 64, passes: 2 },
  { name: 'depth32-passes2', compression: 11, filters: 'default', depth: 32, passes: 2 },
  { name: 'depth48-passes2', compression: 11, filters: 'default', depth: 48, passes: 2 },
];
const selected = settings.candidates === 'all'
  ? configs.filter(c => c.name !== 'baseline-o5' || ['extended', 'validation'].includes(settings.corpus))
  : configs.filter(c => settings.candidates.split(',').includes(c.name));
if (!selected.length || (settings.candidates !== 'all' && selected.length !== settings.candidates.split(',').length)) throw Error('Unknown candidate');
const files = readdirSync(join(here, 'sample')).filter(f => /\.png$/i.test(f)).sort()
  .filter(f => settings.corpus !== 'pilot' || f === 'Icon2.png')
  .filter(() => !['validation', 'fixtures', 'fixtures-all'].includes(settings.corpus))
  .map(name => ({ name, path: join(here, 'sample', name), category: 'screenshot' }));
if (['extended', 'validation'].includes(settings.corpus)) {
  for (const name of ['gradient.png', 'shapes.png', 'photo.png']) files.push({ name: `generated/${name}`, path: join(root, 'docs/samples', name), category: 'generated' });
  for (const name of ['palette_8_should_be_palette_8.png', 'rgb_trns_8_should_be_palette_8.png', 'rgba_16_should_be_rgba_16.png', 'interlaced_rgba_16_should_be_rgba_16.png', 'small_files.png', 'apng_file.png']) files.push({ name: `fixture/${name}`, path: join(root, 'test/files', name), category: 'fixture' });
}
if (['fixtures', 'fixtures-all'].includes(settings.corpus)) {
  for (const name of readdirSync(join(root, 'test/files')).filter(f => /\.png$/i.test(f)).sort()) {
    const path = join(root, 'test/files', name), header = readFileSync(path);
    const channels = [1, 0, 3, 1, 2, 0, 4][header[25]] ?? 0;
    if (settings.corpus === 'fixtures-all' || header[24] === 8 && header.readUInt32BE(16) * header.readUInt32BE(20) * channels >= 65536)
      files.push({ name: `fixture/${name}`, path, category: settings.corpus === 'fixtures-all' ? 'fixture' : '8-bit fixture' });
  }
}
const source = readFileSync(join(root, 'src/deflate/deflate.ts'), 'utf8');
const optimizeSource = readFileSync(join(root, 'src/optimize.ts'), 'utf8');
const report = { generatedAt: new Date().toISOString(), environment: { cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch, node: process.version }, settings, encoderSha256: createHash('sha256').update(source).digest('hex'), optimizerSha256: createHash('sha256').update(optimizeSource).digest('hex'), timing: 'In-process API; alternating/rotating candidates; PNG checks outside timing; all bundles built identically', complete: false, configurations: selected, rows: [], totals: [] };
const save = () => writeFileSync(resolve(settings.output), JSON.stringify(report, null, 2) + '\n');
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const work = mkdtempSync(join(tmpdir(), 'oxipng-tune-'));
save();
try {
  const variants = [];
  for (const config of selected) {
    let contents = source;
    if (config.insertionDepth !== undefined) {
      // Replace the whole per-block insertion policy so both the original
      // depth-64 baseline and screened guards remain reproducible after tuning.
      const block = /let end = optimalBlockEnd\(data, start\);[\s\S]*?(?=\n    cacheCount = 0;)/;
      if (!block.test(contents)) throw Error('Optimal block declaration changed');
      let budget = `let end = optimalBlockEnd(data, start);
    let insertionDepth = fastOptimal && level === 11 ? ${config.insertionDepth} : depth;`;
      if (config.dominantPermille !== undefined) budget += `
    if (fastOptimal && level === 11) {
      for (let s = 0; s < 256; s++) {
        if (blockHistogram[s] * 1000 >= (end - start) * ${config.dominantPermille}) { insertionDepth = depth; break; }
      }
    }`;
      if (config.minSymbols !== undefined) budget += `
    if (fastOptimal && level === 11) {
      let symbols = 0;
      for (let s = 0; s < 256; s++) if (blockHistogram[s] * 1024 >= end - start) symbols++;
      if (symbols <= ${config.minSymbols}) insertionDepth = depth;
    }`;
      contents = contents.replace(block, budget);
      const insertion = /insertTree\(data, view, p, end, (?:depth|insertionDepth), nice, distance, next - p\);/;
      if (!insertion.test(contents)) throw Error('Tree insertion call changed');
      contents = contents.replace(insertion, 'insertTree(data, view, p, end, insertionDepth, nice, distance, next - p);');
    }
    if (config.depth !== undefined) {
      const old = 'const depth = level >= 12 ? 128 : level >= 11 ? 64 : 32;';
      if (!contents.includes(old)) throw Error('Encoder depth declaration changed');
      contents = contents.replace(old, `const depth = level >= 12 ? 128 : level >= 11 ? ${config.depth} : 32;`);
    }
    if (config.adaptiveDepth) {
      const old = 'let end = optimalBlockEnd(data, start);';
      if (!contents.includes(old)) throw Error('Optimal block declaration changed');
      contents = contents.replace(old, `${old}
      let dominant = 0;
      for (let s = 0; s < 256; s++) if (blockHistogram[s] * 16 >= end - start) dominant += blockHistogram[s];
      const depth = level >= 12 ? 128 : level >= 11 ? (dominant * 2 < end - start ? 32 : 64) : 32;`);
    }
    if (config.passes !== undefined) {
      const old = 'level >= 12 ? 4 : 3, level >= 12 ? 1 : level >= 11 ? 16 : 32';
      if (!contents.includes(old)) throw Error('Encoder pass declaration changed');
      contents = contents.replace(old, `level >= 12 ? 4 : ${config.passes}, level >= 12 ? 1 : level >= 11 ? 16 : 32`);
    }
    if (config.minImprovement !== undefined) contents = contents.replace('level >= 11 ? 16 : 32', `level >= 11 ? ${config.minImprovement} : 32`);
    if (config.skipLength !== undefined) contents = contents.replace('const skipLength = level >= 12 ? 128 : 32;', `const skipLength = level >= 12 ? 128 : level >= 11 ? ${config.skipLength} : 32;`);
    const outfile = join(work, config.name + '.mjs');
    await build({ entryPoints: [join(root, 'src/index.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile, plugins: [{ name: 'parameters', setup(build) {
      build.onLoad({ filter: /\/deflate\/deflate\.ts$/ }, () => ({ contents, loader: 'ts', resolveDir: join(root, 'src/deflate') }));
      if (config.evaluationLevel !== undefined) build.onLoad({ filter: /\/optimize\.ts$/ }, () => {
        const declaration = /const compression =[\s\S]*?(?=\n  const evalDeflater)/;
        if (!declaration.test(optimizeSource)) throw Error('Evaluation level declaration changed');
        const legacy = `const compression = opts.deflater.kind === 'libdeflater' && opts.deflater.compression < 11
          ? Math.min(5, opts.deflater.compression) : opts.filters.length <= 4 ? ${config.evaluationLevel} : 8;`;
        const overridden = optimizeSource.replace(declaration, legacy)
          .replace('const cheapEvaluation =', 'const cheapEvaluation = false &&');
        return { contents: overridden, loader: 'ts', resolveDir: join(root, 'src') };
      });
    } }] });
    const api = await import(pathToFileURL(outfile).href);
    api.setLogLevel(api.LogLevel.Off);
    const opts = api.Options.fromPreset(config.preset ?? 2);
    if (!config.keepPresetDeflater) opts.deflater = api.libdeflater(config.compression);
    if (config.filters === 'bigrams') opts.filters = [api.NONE, api.Bigrams];
    if (config.filters === 'minsum') opts.filters = [api.NONE, api.MinSum];
    if (config.filters === 'entropy-bigrams') opts.filters = [api.NONE, api.Entropy, api.Bigrams];
    if (config.filters === 'sub-bigrams') opts.filters = [api.NONE, api.SUB, api.Bigrams];
    if (config.fastEvaluation !== undefined) opts.fastEvaluation = config.fastEvaluation;
    if (config.bruteLevel !== undefined) opts.filters = opts.filters.map(f => f.kind === 'brute' ? api.Brute(f.numLines, config.bruteLevel) : f);
    (report.bundles ??= {})[config.name] = {
      sha256: createHash('sha256').update(readFileSync(outfile)).digest('hex'),
      encoderSha256: createHash('sha256').update(contents).digest('hex'), deflater: opts.deflater,
    };
    variants.push({ config, api, opts });
  }
  for (const file of files) {
    const input = readFileSync(file.path);
    let original;
    try { original = decodePng(input); }
    catch (error) {
      if (!['fixtures', 'fixtures-all'].includes(settings.corpus)) throw error;
      (report.skipped ??= []).push({ name: file.name, reason: `Input decoding: ${error.message}` });
      save();
      continue;
    }
    const cases = variants.map(v => ({ ...v, samplesMs: [], output: null }));
    for (const variant of cases) for (let i = 0; i < settings.warmup; i++) {
      console.log(`${file.name}: warmup ${variant.config.name} ${i + 1}/${settings.warmup}`);
      variant.api.oxipngSync(input, variant.opts);
    }
    for (let round = 0; round < settings.runs; round++) {
      const rotated = [...cases.slice(round % cases.length), ...cases.slice(0, round % cases.length)];
      for (const variant of round % 2 ? rotated.reverse() : rotated) {
        console.log(`${file.name}: ${variant.config.name} ${round + 1}/${settings.runs} starting`);
        const start = performance.now();
        const output = variant.api.oxipngSync(input, variant.opts);
        variant.samplesMs.push(performance.now() - start);
        assertPngEqual(original, decodePng(output));
        if (variant.output !== null && !Buffer.from(output).equals(variant.output)) throw Error(`Nondeterministic: ${variant.config.name}`);
        variant.output = Buffer.from(output);
        console.log(`  ${output.length} B / ${variant.samplesMs.at(-1).toFixed(1)} ms`);
      }
    }
    const baseline = cases.find(v => v.config.name === 'insertion-before') ?? cases.find(v => v.config.name === 'budget-before') ?? cases.find(v => v.config.name === 'before-o2') ?? cases.find(v => v.config.name === 'baseline-o2');
    const row = { name: file.name, category: file.category, inputBytes: input.length, candidates: Object.fromEntries(cases.map(v => [v.config.name, {
      bytes: v.output.length, medianMs: median(v.samplesMs), minMs: Math.min(...v.samplesMs), samplesMs: v.samplesMs,
      sha256: createHash('sha256').update(v.output).digest('hex'), ...(baseline ? { matchesBaseline: v.output.equals(baseline.output) } : {}),
    }])) };
    report.rows.push(row);
    save();
    if (baseline) for (const variant of cases) {
      const limit = variant.config.maxGrowthPercent;
      if (limit !== undefined && variant.output.length > baseline.output.length * (1 + limit / 100)) {
        (report.budgetFailures ??= []).push({ name: file.name, candidate: variant.config.name,
          baselineBytes: baseline.output.length, bytes: variant.output.length, maxGrowthPercent: limit });
        save();
      }
    }
  }
  report.totals = selected.map(config => ({ name: config.name,
    bytes: report.rows.reduce((sum, row) => sum + row.candidates[config.name].bytes, 0),
    medianMs: report.rows.reduce((sum, row) => sum + row.candidates[config.name].medianMs, 0),
    minMs: report.rows.reduce((sum, row) => sum + row.candidates[config.name].minMs, 0),
  }));
  report.complete = true;
  save();
  console.table(report.totals);
  if (report.budgetFailures?.length) throw Error(`Size budget exceeded in ${report.budgetFailures.length} comparisons; see ${settings.output}`);
} finally { rmSync(work, { recursive: true, force: true }); }
