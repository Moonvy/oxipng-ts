import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const available = ['porffor', 'scriptc', 'perry'];
const requested = [...new Set(process.argv.slice(2))];
const explicit = requested.length > 0;
const unknown = requested.filter(target => !available.includes(target));
if (unknown.length) {
  console.error(`Unknown binary target: ${unknown.join(', ')}. Choose ${available.join(', ')}.`);
  process.exit(1);
}

function unavailable(target) {
  if (target !== 'perry' && !['darwin', 'linux'].includes(process.platform)) {
    return `${target} requires macOS or Linux (use WSL on Windows)`;
  }
  if (target === 'scriptc') {
    if (Number(process.versions.node.split('.')[0]) < 24) return 'ScriptC requires Node.js 24+';
    try { import.meta.resolve('@scriptc/compiler'); }
    catch { return 'ScriptC is not installed; run npm ci'; }
    return null;
  }
  const compiler = target === 'porffor' ? process.env.PORFFOR_BIN || 'porf' : process.env.PERRY_BIN || 'perry';
  const result = spawnSync(compiler, ['--version'], { encoding: 'utf8', timeout: 10_000 });
  if (result.status === 0) return null;
  const setting = target === 'porffor' ? 'PORFFOR_BIN' : 'PERRY_BIN';
  return `${compiler} is unavailable (${result.error?.message || result.stderr.trim() || `exit ${result.status}, signal ${result.signal}`}); install the compiler or set ${setting}`;
}

// Discover compilers before cleaning output. Missing optional compilers should
// not prevent the default command from building the installed targets.
const targets = [];
for (const target of explicit ? requested : available) {
  const reason = unavailable(target);
  if (!reason) { targets.push(target); continue; }
  const configured = target === 'porffor' ? process.env.PORFFOR_BIN : target === 'perry' ? process.env.PERRY_BIN : null;
  if (explicit || configured) {
    console.error(`build:bin: ${target}: ${reason}`);
    process.exit(1);
  }
  console.warn(`build:bin: skipping ${target}: ${reason}`);
}
if (!targets.length) {
  console.error('build:bin: no native compilers available. Install a compiler before building. Existing dist/bin was preserved.');
  process.exit(1);
}
console.log(`build:bin: building ${targets.join(', ')}`);

// Native output is independent of the JS library and GitHub Pages output.
const output = join(root, 'dist', 'bin');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const target of targets) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', `build-${target}.mjs`)], {
    cwd: root, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`build:bin: ${target} failed (exit ${result.status ?? result.signal}).`);
    process.exit(result.status || 1);
  }
}
