import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Options } from '../src/index.js';
import { collectFiles, inFileFromPath, optimize, type OutFile } from '../src/node.js';
import { parseCliArgs, run } from '../src/cli.js';
import { decodePng, readFixture } from './helpers.js';

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oxipng-ts-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function capture(fn: () => number): { code: number; stdout: string; stderr: string } {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    outChunks.push(s);
    return true;
  };
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    errChunks.push(s);
    return true;
  };
  try {
    const code = fn();
    return { code, stdout: outChunks.join(''), stderr: errChunks.join('') };
  } finally {
    (process.stdout as unknown as { write: typeof origOut }).write = origOut;
    (process.stderr as unknown as { write: typeof origErr }).write = origErr;
  }
}

describe('node optimize()', () => {
  it('writes an optimized file', () => {
    const dir = tempDir();
    const inputPath = join(dir, 'in.png');
    const outputPath = join(dir, 'out.png');
    writeFileSync(inputPath, readFixture('rgb_8_should_be_rgb_8.png'));

    const opts = new Options();
    const out: OutFile = { kind: 'path', path: outputPath, preserveAttrs: false };
    const [insize, outsize] = optimize(inFileFromPath(inputPath), out, opts);
    expect(insize).toBeGreaterThan(0);
    expect(outsize).toBeGreaterThan(0);

    const written = new Uint8Array(readFileSync(outputPath));
    expect(() => decodePng(written)).not.toThrow();
  });

  it('does not write in dry-run mode', () => {
    const dir = tempDir();
    const inputPath = join(dir, 'in.png');
    writeFileSync(inputPath, readFixture('rgb_8_should_be_rgb_8.png'));
    const before = readdirSync(dir).length;
    optimize(inFileFromPath(inputPath), { kind: 'none' }, new Options());
    expect(readdirSync(dir).length).toBe(before);
  });

  it('recursively collects PNG files only', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.png'), readFixture('rgb_8_should_be_rgb_8.png'));
    writeFileSync(join(dir, 'b.txt'), 'not a png');
    const pairs = collectFiles([dir], null, { kind: 'none' }, true, true);
    expect(pairs.map(([i]) => (i.kind === 'path' ? i.path : i.kind))).toEqual([join(dir, 'a.png')]);
  });
});

describe('CLI argument parsing', () => {
  it('applies the -o preset', () => {
    const parsed = parseCliArgs(['-o', '3', 'file.png']);
    expect(parsed.opts.filters.length).toBe(6);
    expect(parsed.files).toEqual(['file.png']);
  });

  it('parses filter ranges', () => {
    const parsed = parseCliArgs(['-f', '0-2', 'file.png']);
    expect(parsed.opts.filters).toHaveLength(3);
  });

  it('parses strip and interlace options', () => {
    const parsed = parseCliArgs(['--strip', 'safe', '-i', 'on', 'file.png']);
    expect(parsed.opts.strip).toEqual({ mode: 'safe' });
    expect(parsed.opts.interlace).toBe(true);
  });

  it('handles --zopfli and --zc', () => {
    expect(parseCliArgs(['--zopfli', '--zi', '20', 'f.png']).opts.deflater).toMatchObject({ kind: 'zopfli' });
    expect(parseCliArgs(['--zc', '10', 'f.png']).opts.deflater).toEqual({ kind: 'libdeflater', compression: 10 });
  });

  it('rejects conflicting output options', () => {
    expect(() => parseCliArgs(['--stdout', '--out', 'x.png', 'f.png'])).toThrow();
  });
});

describe('CLI run()', () => {
  it.each(['toString', '__proto__', 'constructor'])('rejects --%s and writes only to stderr', (name) => {
    const result = capture(() => run([`--${name}`, 'value', '--help']));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(name);
  });

  it('escapes every control character in JSON paths and errors', () => {
    const dir = tempDir();
    const name = Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join('');
    const inputPath = join(dir, `${name}图片.png`);
    writeFileSync(inputPath, readFixture('json.png'));
    const success = capture(() => run(['--json', '--nx', '--nz', inputPath]));
    expect(success.code).toBe(0);
    expect(JSON.parse(success.stdout).results[0]).toMatchObject({ input: inputPath, output: inputPath, status: 'success' });
    const missing = inputPath + '.missing';
    const failure = capture(() => run(['--json', missing]));
    expect(failure.code).toBe(1);
    expect(JSON.parse(failure.stdout).results[0]).toMatchObject({ input: missing, status: 'error' });
  });

  it('prints JSON results for --nx --nz', () => {
    const dir = tempDir();
    const inputPath = join(dir, 'json.png');
    writeFileSync(inputPath, readFixture('json.png'));
    const { code, stdout } = capture(() => run(['--json', '--nx', '--nz', inputPath]));
    expect(code).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.results[0].input).toBe(inputPath);
    expect(data.results[0].status).toBe('success');
    expect(data.results[0].output).toBe(inputPath);
    expect(data.results[0].insize).toBe(data.results[0].outsize);
  });

  it('reports dry run with a null output', () => {
    const dir = tempDir();
    const inputPath = join(dir, 'json.png');
    writeFileSync(inputPath, readFixture('json.png'));
    const { code, stdout } = capture(() => run(['--json', '--dry-run', inputPath]));
    expect(code).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.results[0].status).toBe('success');
    expect(data.results[0].output).toBeNull();
  });

  it('prints help and version', () => {
    expect(capture(() => run(['--help'])).code).toBe(0);
    const version = capture(() => run(['--version']));
    expect(version.code).toBe(0);
    expect(version.stdout).toContain('oxipng-ts');
  });
});
