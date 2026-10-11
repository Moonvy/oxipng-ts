// Bundle the existing TypeScript CLI, replace its Node host, then compile AOT.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { porfforCompatibleSource } from './porffor-compat.mjs';
import { restorePorfforTypes } from './porffor-types.mjs';
import { preparePorfforRuntime } from './porffor-runtime.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'bin');
const work = join(dist, '.porffor');
const output = join(dist, 'oxipng-ts-porffor');
const pending = join(work, 'oxipng-ts-porffor');
const porf = process.env.PORFFOR_BIN || 'porf';
const shims = {
  'node:fs': `export const readFileSync = pfReadFileSync, writeFileSync = pfWriteFileSync,
    statSync = pfStatSync, existsSync = pfExistsSync, mkdirSync = pfMkdirSync,
    readdirSync = pfReaddirSync, chmodSync = pfChmodSync, utimesSync = pfUtimesSync;`,
  'node:path': 'export const dirname = pfDirname;',
  'node:util': 'export const parseArgs = pfParseArgs;',
};

try {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Porffor native builds require macOS or Linux (use WSL on Windows).');
  const version = spawnSync(porf, ['--version'], { encoding: 'utf8' });
  if (version.error) throw new Error(`Porffor not found: ${porf}. Install from https://porffor.dev/ or set PORFFOR_BIN.`, { cause: version.error });
  if (version.status !== 0) throw new Error(`Could not run ${porf} --version: ${version.stderr}`);
  console.log(`build:porffor: ${version.stdout.trim()}`);
  mkdirSync(work, { recursive: true });
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  const project = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(project.fileNames, project.options);
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: ['src/porffor/cli.ts'],
    bundle: true,
    write: false,
    outfile: join(work, 'bundle.js'),
    sourcemap: 'external',
    format: 'esm',
    platform: 'neutral',
    target: 'esnext',
    define: { process: 'pfProcess' },
    plugins: [{
      name: 'porffor-host',
      setup(build) {
        build.onLoad({ filter: /\.ts$/ }, ({ path }) => ({
          contents: porfforCompatibleSource(readFileSync(path, 'utf8'), path, program), loader: 'ts',
        }));
        build.onResolve({ filter: /^node:/ }, ({ path }) => {
          if (!(path in shims)) throw new Error(`Unsupported native CLI dependency: ${path}`);
          return { path, namespace: 'porffor-host' };
        });
        build.onLoad({ filter: /.*/, namespace: 'porffor-host' }, ({ path }) => ({ contents: shims[path], loader: 'js' }));
      },
    }],
  });
  for (const file of bundled.outputFiles) writeFileSync(file.path, file.contents);
  const typed = restorePorfforTypes(
    bundled.outputFiles.find(file => file.path.endsWith('.js')).text,
    bundled.outputFiles.find(file => file.path.endsWith('.js.map')).text,
  );
  console.log(`build:porffor: restored types for ${typed.functions} functions and ${typed.variables} variables`);
  const runtime = await preparePorfforRuntime(readFileSync(join(root, 'src/porffor/runtime.ts'), 'utf8'));
  const source = join(work, 'cli.ts');
  writeFileSync(source, runtime + '\n' + typed.source);
  const result = spawnSync(porf, ['native', source, '-o', pending], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Porffor compilation failed (exit ${result.status ?? result.signal}).`);
  if (!statSync(pending).isFile()) throw new Error('Porffor did not produce a native executable.');
  chmodSync(pending, 0o755);
  renameSync(pending, output);
  console.log(`build:porffor: created dist/bin/oxipng-ts-porffor (${process.platform}-${process.arch})`);
} catch (error) {
  console.error(`build:porffor: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Retain the exact bundle/map/compiler input on request for alpha compiler diagnostics.
  if (process.env.PORFFOR_KEEP_BUILD === '1') console.log(`build:porffor: retained ${work}`);
  else rmSync(work, { force: true, recursive: true });
}
