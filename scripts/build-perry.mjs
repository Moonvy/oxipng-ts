import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'bin');
const work = join(dist, '.perry');
const name = process.platform === 'win32' ? 'oxipng-perry.exe' : 'oxipng-perry';
const output = join(dist, name);
const pending = join(work, name);
const perry = process.env.PERRY_BIN || 'perry';

function perryCompatibleSource(relative, source) {
  if (relative !== 'headers.ts') return source;
  const original = `export function ihdrBpp(ihdr: IhdrData): number {
  return ihdr.bitDepth * channelsPerPixel(ihdr.colorType);
}`;
  const compatible = `export function ihdrBpp(ihdr: IhdrData): number {
  const kind = ihdr.colorType.kind;
  let channels: number;
  if (kind === 'grayscale' || kind === 'indexed') channels = 1;
  else if (kind === 'grayscaleAlpha') channels = 2;
  else if (kind === 'rgb') channels = 3;
  else channels = 4;
  return ihdr.bitDepth * channels;
}`;
  if (!source.includes(original) || source.indexOf(original) !== source.lastIndexOf(original)) {
    throw new Error('Perry ihdrBpp compatibility anchor changed; review the native adapter.');
  }
  return source.replace(original, compatible);
}

function prepareSources(relative = '') {
  for (const entry of readdirSync(join(root, 'src', relative), { withFileTypes: true })) {
    const next = join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!['scriptc', 'porffor'].includes(entry.name)) prepareSources(next);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    const source = readFileSync(join(root, 'src', next), 'utf8');
    const target = join(work, 'src', next);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, perryCompatibleSource(next, source));
  }
}

try {
  const version = spawnSync(perry, ['--version'], { encoding: 'utf8' });
  if (version.error) throw new Error(`Perry not found: ${perry}. Install @perryts/perry or set PERRY_BIN.`, { cause: version.error });
  if (version.status !== 0) throw new Error(`Could not run ${perry} --version: ${version.stderr}`);
  console.log(`build:perry: ${version.stdout.trim()}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  // Preserve TypeScript signatures so Perry can specialize hot functions.
  // Its 0.5.1520 cross-module inliner drops channelsPerPixel from ihdrBpp,
  // so stage an equivalent local implementation in headers.ts.
  prepareSources();
  const source = join(work, 'src', 'perry', 'cli.ts');
  const result = spawnSync(perry, ['compile', source, '-o', pending, '--march', 'generic'], {
    cwd: root, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Perry compilation failed (exit ${result.status ?? result.signal}).`);
  if (!statSync(pending).isFile()) throw new Error('Perry did not produce a native executable.');
  chmodSync(pending, 0o755);
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const smoke = spawnSync(pending, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  if (smoke.status !== 0 || smoke.stdout !== `oxipng-ts ${packageVersion}\n`) {
    throw new Error(`Perry executable failed its version check: ${smoke.error?.message || smoke.stderr || smoke.stdout}`);
  }
  renameSync(pending, output);
  writeFileSync(`${output}.build.json`, JSON.stringify({
    compiler: 'perry', version: version.stdout.trim(),
    mode: 'native (LLVM, typed modules)', cpu: 'generic', platform: process.platform, arch: process.arch,
    adapters: ['ihdrBpp cross-module inline workaround', 'Adler-32 bytewise serialization'],
    bytes: statSync(output).size,
  }, null, 2) + '\n');
  console.log(`build:perry: created dist/bin/${name} (${process.platform}-${process.arch})`);
} catch (error) {
  console.error(`build:perry: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (process.env.PERRY_KEEP_BUILD === '1') console.log(`build:perry: retained ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
