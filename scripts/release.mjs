#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org/';
const flags = new Set(process.argv.slice(2));
const knownFlags = new Set(['--dry-run', '--skip-build', '--build-bin', '--help']);
const unknownFlags = [...flags].filter(flag => !knownFlags.has(flag));

if (unknownFlags.length) {
  console.error(`Unknown option: ${unknownFlags.join(', ')}`);
  process.exit(2);
}

if (flags.has('--help')) {
  console.log(`Usage: npm run release [-- --dry-run] [--skip-build] [--build-bin]

Builds the JavaScript package, verifies that npm only contains dist/js, publishes
the npm tarball, then attaches a platform-specific archive of existing dist/bin
contents and a checksum to the matching GitHub release.

--dry-run     Build and inspect artifacts without publishing
--skip-build  Reuse existing dist/js and dist/bin outputs
--build-bin   Rebuild dist/bin first (build:bin replaces that directory)`);
  process.exit(0);
}

function run(command, args, { capture = false, cwd = root } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `${result.stderr || ''}${result.stdout || ''}`.trim() : '';
    throw new Error(`${command} ${args.join(' ')} failed${result.status == null ? ` (${result.signal})` : ` (exit ${result.status})`}${detail ? `:\n${detail}` : ''}`);
  }
  return capture ? result.stdout.trim() : '';
}

function runResult(command, args, { cwd = root } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported release artifact entry: ${path}`);
  }
  return files.sort();
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function assertPackContents(files) {
  const allowed = path => path === 'package.json' || path === 'README.md' || path === 'LICENSE' || path.startsWith('dist/js/');
  const unexpected = files.filter(file => !allowed(file.path));
  const required = ['dist/js/cli.js', 'dist/js/index.js', 'dist/js/index.cjs', 'dist/js/node.js', 'dist/js/node.cjs'];
  const missing = required.filter(path => !files.some(file => file.path === path));
  if (unexpected.length || missing.length) {
    throw new Error([
      unexpected.length ? `npm package includes files outside package metadata, README/license, and dist/js: ${unexpected.map(file => file.path).join(', ')}` : '',
      missing.length ? `npm package is missing required JavaScript entry points: ${missing.join(', ')}` : '',
    ].filter(Boolean).join('\n'));
  }
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!Array.isArray(packageJson.files) || packageJson.files.length !== 1 || packageJson.files[0] !== 'dist/js') {
  throw new Error('package.json files must contain only "dist/js". Native binaries belong in GitHub Releases.');
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
  throw new Error(`Invalid package version: ${packageJson.version}`);
}

const tag = `v${packageJson.version}`;
const binDir = join(root, 'dist', 'bin');
const jsDir = join(root, 'dist', 'js');
const releaseDir = join(root, 'dist', 'release');
const tempDir = await mkdtemp(join(tmpdir(), 'oxipng-ts-release-'));
const npmCache = join(tempDir, 'npm-cache');

try {
  if (!flags.has('--skip-build')) run('npm', ['run', 'build:ts']);
  if (flags.has('--build-bin')) run('npm', ['run', 'build:bin']);

  for (const required of ['cli.js', 'index.js', 'index.cjs', 'node.js', 'node.cjs']) {
    await access(join(jsDir, required));
  }
  const binFiles = await listFiles(binDir);
  if (!binFiles.length) throw new Error('dist/bin is empty; build native binaries before creating a release.');
  let executableFound = false;
  for (const path of binFiles) {
    if ((await stat(path)).mode & 0o111) executableFound = true;
  }
  if (!executableFound) {
    throw new Error('No native binary artifacts found in dist/bin.');
  }

  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tempDir, '--cache', npmCache], { capture: true }));
  if (!Array.isArray(packed) || packed.length !== 1 || !Array.isArray(packed[0].files)) {
    throw new Error('npm pack did not return the expected package manifest.');
  }
  assertPackContents(packed[0].files);
  const npmTarball = join(tempDir, packed[0].filename);

  await mkdir(releaseDir, { recursive: true });
  const platform = `${process.platform}-${process.arch}`;
  const assetBase = `oxipng-ts-${packageJson.version}-bin-${platform}`;
  const archive = join(releaseDir, `${assetBase}.tar.gz`);
  const checksum = join(releaseDir, `${assetBase}.tar.gz.sha256`);
  await rm(archive, { force: true });
  run('tar', ['-czf', archive, '-C', binDir, '.']);
  await writeFile(checksum, `${await sha256(archive)}  ${basename(archive)}\n`);

  console.log(`\nVerified npm package: ${packed[0].filename}`);
  console.log(`Included ${packed[0].files.length} files; all are package metadata, README/license, or dist/js.`);
  for (const file of packed[0].files) console.log(`  ${file.path}`);
  console.log(`GitHub binary asset: ${relative(root, archive).split(sep).join('/')}`);
  console.log(`GitHub checksum: ${relative(root, checksum).split(sep).join('/')}`);

  if (flags.has('--dry-run')) {
    console.log(`\nDry run complete. Would publish ${packageJson.name}@${packageJson.version} to npm and attach the native archive to GitHub release ${tag}.`);
    process.exitCode = 0;
  } else {
    const sourceChanges = run('git', ['status', '--porcelain', '--', 'src', 'rslib.config.ts', 'tsconfig.json', 'scripts/postbuild.mjs', 'scripts/build-bin.mjs', 'scripts/build-porffor.mjs', 'scripts/build-scriptc.mjs', 'scripts/build-perry.mjs', 'scripts/porffor-compat.mjs', 'scripts/porffor-types.mjs', 'scripts/porffor-runtime.mjs', 'scripts/scriptc-static-compat.mjs', 'scripts/scriptc-compiler-fix.mjs'], { capture: true });
    if (sourceChanges) throw new Error(`Commit source or native build changes before publishing:\n${sourceChanges}`);
    const committedPackage = JSON.parse(run('git', ['show', 'HEAD:package.json'], { capture: true }));
    if (committedPackage.name !== packageJson.name || committedPackage.version !== packageJson.version) {
      throw new Error(`HEAD has ${committedPackage.name}@${committedPackage.version}; release target must use the same package name and version as package.json.`);
    }

    run('npm', ['whoami', '--registry', registry, '--cache', npmCache]);
    run('gh', ['auth', 'status', '--hostname', 'github.com']);
    const branch = run('git', ['branch', '--show-current'], { capture: true });
    if (!branch) throw new Error('Publish from a named branch so the release target can be verified.');
    const remoteHead = run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], { capture: true }).split(/\s+/)[0];
    const localHead = run('git', ['rev-parse', 'HEAD'], { capture: true });
    if (remoteHead !== localHead) throw new Error(`Push ${branch} to origin before publishing; origin points to ${remoteHead || 'no matching branch'}, local HEAD is ${localHead}.`);
    const localTag = runResult('git', ['rev-parse', `${tag}^{commit}`]);
    if (localTag.status === 0 && localTag.stdout !== localHead) {
      throw new Error(`Local tag ${tag} points to ${localTag.stdout}, not current HEAD ${localHead}.`);
    }

    const existingPackage = runResult('npm', ['view', `${packageJson.name}@${packageJson.version}`, 'dist.integrity', '--json', '--registry', registry, '--cache', npmCache]);
    let alreadyPublished = false;
    if (existingPackage.status === 0) {
      const integrity = JSON.parse(existingPackage.stdout);
      if (integrity !== packed[0].integrity) {
        throw new Error(`${packageJson.name}@${packageJson.version} already exists on npm with different contents; bump package.json version.`);
      }
      alreadyPublished = true;
    } else if (!/E404|404 Not Found|is not in this registry/i.test(`${existingPackage.stderr}\n${existingPackage.stdout}`)) {
      throw new Error(`Could not check npm version availability:\n${existingPackage.stderr || existingPackage.stdout}`);
    }

    let releaseDraft = true;
    const existingRelease = runResult('gh', ['release', 'view', tag, '--json', 'isDraft']);
    if (existingRelease.status === 0) releaseDraft = JSON.parse(existingRelease.stdout).isDraft;
    else if (!/release not found|HTTP 404/i.test(`${existingRelease.stderr}\n${existingRelease.stdout}`)) {
      throw new Error(`Could not check GitHub release ${tag}:\n${existingRelease.stderr || existingRelease.stdout}`);
    }

    if (existingRelease.status !== 0) {
      run('gh', ['release', 'create', tag, '--draft', '--target', 'HEAD', '--title', `${packageJson.name} ${tag}`, '--generate-notes']);
    }
    run('gh', ['release', 'upload', tag, archive, checksum, '--clobber']);
    if (!alreadyPublished) run('npm', ['publish', npmTarball, '--access', 'public', '--registry', registry, '--cache', npmCache]);
    else console.log(`${packageJson.name}@${packageJson.version} is already published with this exact tarball; skipping npm publish.`);
    if (releaseDraft) run('gh', ['release', 'edit', tag, '--draft=false']);
    console.log(`\nPublished ${packageJson.name}@${packageJson.version} and GitHub release ${tag}.`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
