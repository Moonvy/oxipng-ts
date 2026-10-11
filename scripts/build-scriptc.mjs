import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { fixScriptcArrayOwnership } from './scriptc-compiler-fix.mjs';
import { prepareScriptcStaticSource, scriptcStaticSource } from './scriptc-static-compat.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const work = join(dist, '.scriptc-static');
const output = join(dist, 'oxipng-ts-scriptc');
const pending = join(work, 'oxipng-ts-scriptc');

try {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('The ScriptC filesystem bridge requires macOS or Linux (use WSL on Windows).');
  const compilerEntry = import.meta.resolve('@scriptc/compiler');
  const version = JSON.parse(readFileSync(new URL('../package.json', compilerEntry), 'utf8')).version;
  if (version !== '0.2.8') throw new Error(`Static ScriptC adaptations require @scriptc/compiler 0.2.8; found ${version}.`);
  const lowererUrl = new URL('frontend/lowering/lowerer.js', compilerEntry).href;
  let patchApplied = false;
  const hook = registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url !== lowererUrl) return loaded;
      patchApplied = true;
      return { ...loaded, source: fixScriptcArrayOwnership(String(loaded.source)) };
    },
  });
  let compiler;
  try { compiler = await import('@scriptc/compiler'); }
  finally { hook.deregister(); }
  if (!patchApplied) throw new Error('The ScriptC compiler initialization fix was not applied.');
  console.log(`build:scriptc: ${version} (LLVM, static, no JavaScript engine; ArrayOwnership initialization fix)`);
  rmSync(work, { force: true, recursive: true });
  mkdirSync(work, { recursive: true });
  const sources = [];
  function prepare(relative = '') {
    for (const entry of readdirSync(join(root, 'src', relative), { withFileTypes: true })) {
      const next = join(relative, entry.name);
      if (entry.isDirectory()) {
        if (!['scriptc', 'porffor'].includes(next)) prepare(next);
      } else if (entry.name.endsWith('.ts')) {
        const original = join(root, 'src', next);
        const target = join(work, 'src', next);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, prepareScriptcStaticSource(readFileSync(original, 'utf8'), original));
        sources.push(target);
      }
    }
  }
  prepare();
  const entry = join(work, 'cli.ts');
  writeFileSync(entry, readFileSync(join(root, 'src/scriptc/cli.ts'), 'utf8').replace('../cli-main.js', './src/cli-main.js'));
  const configPath = join(work, 'tsconfig.json');
  writeFileSync(configPath, JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, skipLibCheck: true, noUncheckedIndexedAccess: false, types: ['node'] },
    include: ['src/**/*.ts', 'cli.ts'],
  }));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const project = ts.parseJsonConfigFileContent(config.config, ts.sys, work);
  const program = ts.createProgram(project.fileNames, project.options);
  for (const path of sources) writeFileSync(path, scriptcStaticSource(path, program));
  const hostObject = join(work, 'fs-host.o');
  const cc = spawnSync(process.env.CC || 'cc', ['-O2', '-c', join(root, 'src/scriptc/fs-host.c'), '-o', hostObject], { stdio: 'inherit' });
  if (cc.error) throw new Error('A C compiler is required for ScriptC file permission preservation.', { cause: cc.error });
  if (cc.status !== 0) throw new Error(`ScriptC filesystem bridge compilation failed (exit ${cc.status ?? cc.signal}).`);
  const ffi = join(work, 'ffi.json');
  writeFileSync(ffi, JSON.stringify({ ffi_format: 1,
    functions: [{ name: 'nativeMode', symbol: 'oxipng_scriptc_mode', params: ['string'], returns: 'i32' }],
    libraries: [hostObject] }));
  const analysis = compiler.analyze(entry, { dynamic: false, ffiProfilePath: ffi });
  const coverage = compiler.coverageEnvelope(analysis.coverage, {
    compilerVersion: version, sourceTexts: analysis.sourceTexts, failOn: 'blockers',
  });
  writeFileSync(join(work, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
  const stats = analysis.coverage.stats;
  if (!compiler.coveragePasses(analysis.coverage, 'blockers') || stats.statementsFailed !== 0 ||
      stats.statementsIsland !== 0 || coverage.stats?.statementsFailed !== 0 ||
      coverage.stats?.statementsDynamic !== 0 || coverage.stats?.functionsSkipped !== 0 ||
      coverage.stats?.percentStatic !== 100 || (analysis.coverage.runtimeFences?.length || 0) !== 0 ||
      (analysis.coverage.unreached?.runtimeFences?.length || 0) !== 0) {
    console.error(compiler.renderCoverage(analysis.coverage, { sourceTexts: analysis.sourceTexts }));
    throw new Error('ScriptC static coverage gate failed; dynamic fallback is disabled.');
  }
  console.log(`build:scriptc: ${coverage.stats.statementsStatic} statements (${stats.statementsTotal} CLI-reachable), 0 failed, 0 dynamic`);
  const result = await compiler.compile(entry, { outPath: pending, outDir: work,
    ffiProfilePath: ffi, dynamic: false, optimization: 'speed', strip: true });
  if (!result.ok) {
    console.error(compiler.renderDiagnostics(result.diagnostics, result.sourceTexts));
    throw new Error('ScriptC static compilation failed; dynamic fallback is disabled.');
  }
  // Inspect generated IR as a second guard against accidentally embedding QuickJS.
  if (/scr_island|JS_Eval|JS_NewRuntime/.test(readFileSync(result.llvmPath, 'utf8'))) {
    throw new Error('Unexpected dynamic-engine reference in ScriptC LLVM output.');
  }
  chmodSync(pending, 0o755);
  const smoke = spawnSync(pending, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  if (smoke.status !== 0 || smoke.stdout !== `oxipng-ts ${packageVersion}\n`) throw new Error(`ScriptC executable failed its version check: ${smoke.error?.message || smoke.stderr || smoke.stdout}`);
  renameSync(pending, output);
  writeFileSync(`${output}.coverage.json`, JSON.stringify(coverage, null, 2) + '\n');
  writeFileSync(`${output}.build.json`, JSON.stringify({ compiler: 'scriptc', version,
    mode: 'static (LLVM, no JavaScript engine)', optimization: 'speed',
    compilerFixes: ['ArrayOwnership initialization order'], staticStatements: coverage.stats.statementsStatic,
    cliReachableStatements: stats.statementsTotal,
    dynamicStatements: stats.statementsIsland, failedStatements: stats.statementsFailed,
    platform: process.platform, arch: process.arch, bytes: statSync(output).size,
  }, null, 2) + '\n');
  console.log(`build:scriptc: created dist/oxipng-ts-scriptc (${process.platform}-${process.arch}, fully static)`);
} catch (error) {
  console.error(`build:scriptc: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (process.env.SCRIPTC_KEEP_BUILD === '1') console.log(`build:scriptc: retained ${work}`);
  else rmSync(work, { force: true, recursive: true });
}
