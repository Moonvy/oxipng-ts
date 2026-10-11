import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizeFromMemory } from '../src/index.ts';
import { parseCliArgs } from '../src/cli.ts';
import { decodePng, readFixture } from './helpers.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function nativeCliSuite(label: string, filename: string) {
  const binary = join(root, 'dist', 'bin', filename);
  const temps: string[] = [];
  function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), `${filename}-`));
    temps.push(dir);
    return dir;
  }
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function native(args: string[], input?: Uint8Array) {
    const result = spawnSync(binary, args, { input, timeout: 30_000 });
    if (result.error) throw result.error;
    expect(result.signal).toBeNull();
    return result;
  }

  // Explicit native test scripts build the executable first. Ordinary JS tests can run
  // without a platform-specific compiler installed.
  describe.skipIf(!existsSync(binary))(`${label} CLI`, () => {
    it('prints help and version from the standalone executable', () => {
      const help = native(['--help']);
      expect(help.status).toBe(0);
      expect(help.stdout.toString()).toContain('Usage: oxipng-ts');
      const version = native(['-V']);
      expect(version.status).toBe(0);
      expect(version.stdout.toString()).toBe('oxipng-ts 0.1.0\n');
    });

    it.each([
      ['rgb_8_should_be_rgb_8.png', []],
      ['rgba_8_should_be_palette_2.png', ['-o1']],
      ['palette_8_should_be_palette_1.png', ['--opt=0']],
      ['interlaced_rgba_8_should_be_rgba_8.png', ['--interlace', 'on']],
      ['rgba_16_should_be_rgba_8.png', ['-o', '2']],
      ['strip_chunks_safe.png', ['--strip', 'safe']],
      ['apng_file.png', ['--nx', '--nz']],
      ['json.png', ['-o', '0', '-z', '--zi', '1']],
      ['json.png', ['-o', '6']],
      ['rgb_8_should_be_rgb_8.png', ['-o', '2', '--filters', '8', '--brute-lines', '2']],
      ['apng_file.png', ['-o', '2']],
      ['strip_chunks_safe.png', ['-o', '2', '--strip', 'all']],
      ['json.png', ['-o', '2', '-z', '--zi', '1']],
    ] as [string, string[]][])('matches the TypeScript optimizer for %s (%j)', (fixture, flags) => {
      const dir = tempDir();
      const input = join(dir, fixture);
      const output = join(dir, 'out.png');
      const bytes = readFixture(fixture);
      writeFileSync(input, bytes);
      const expected = optimizeFromMemory(bytes, parseCliArgs([...flags, '--quiet']).opts);
      const result = native([...flags, '--quiet', '--json', '--out', output, input]);
      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.toString()).results[0]).toMatchObject({ status: 'success', insize: bytes.length, outsize: expected.length });
      const actual = new Uint8Array(readFileSync(output));
      expect(Buffer.from(actual).equals(Buffer.from(expected)), 'native output must match TypeScript bytes').toBe(true);
      expect(() => decodePng(actual)).not.toThrow();
    });

    it('supports stdin and binary stdout without text contamination', () => {
      const bytes = readFixture('json.png');
      const result = native(['--nx', '--nz', '--stdout', '-'], bytes);
      expect(result.status).toBe(0);
      expect(result.stdout.equals(Buffer.from(bytes)), 'stdout must contain exact PNG bytes').toBe(true);
      expect(result.stderr.length).toBe(0);
    });

    it('handles recursive input, Unicode names, nested output, and dry runs', () => {
      const dir = tempDir();
      const inputDir = join(dir, '输入 📷');
      mkdirSync(join(inputDir, 'nested'), { recursive: true });
      const input = join(inputDir, 'nested', '图片\n.png');
      const bytes = readFixture('json.png');
      writeFileSync(input, bytes);
      writeFileSync(join(inputDir, 'ignored.txt'), 'text');
      const dry = native(['-r', '--dry-run', '--json', inputDir]);
      expect(dry.status).toBe(0);
      expect(JSON.parse(dry.stdout.toString()).results).toHaveLength(1);
      expect(new Uint8Array(readFileSync(input))).toEqual(bytes);
      const outputDir = join(dir, '输出', 'nested');
      const written = native(['-r', '--nx', '--nz', '--dir', outputDir, inputDir]);
      expect(written.status).toBe(0);
      expect(new Uint8Array(readFileSync(join(outputDir, '图片\n.png')))).toEqual(bytes);
    });

    it('preserves permissions and timestamps', () => {
      const dir = tempDir();
      const input = join(dir, 'in.png');
      const output = join(dir, 'out.png');
      writeFileSync(input, readFixture('json.png'));
      chmodSync(input, 0o640);
      utimesSync(input, 1_600_000_000, 1_600_000_000);
      const result = native(['--nx', '--nz', '--preserve', '--out', output, input]);
      expect(result.status).toBe(0);
      expect(statSync(output).mode & 0o777).toBe(0o640);
      expect(statSync(output).mtimeMs).toBe(1_600_000_000_000);
    });

    it.each([
      ['--unknown'], ['--opt'], ['--opt', '7'], ['--out', 'x', '--stdout'],
      ['--json', '--stdout', '-'], ['--quiet=true'],
      ['--toString', 'value', '--help'], ['--__proto__', 'value', '--help'], ['--constructor', 'value', '--help'],
    ])('rejects invalid arguments %j', (...args) => {
      const result = native(args);
      expect(result.status).toBe(1);
      expect(result.stdout.length).toBe(0);
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it('escapes every control character in JSON paths and errors', () => {
      const dir = tempDir();
      const name = Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join('');
      const input = join(dir, `${name}图片.png`);
      writeFileSync(input, readFixture('json.png'));
      const success = native(['--json', '--nx', '--nz', input]);
      expect(success.status).toBe(0);
      expect(JSON.parse(success.stdout.toString()).results[0]).toMatchObject({ input, output: input, status: 'success' });
      const missing = input + '.missing';
      const failure = native(['--json', missing]);
      expect(failure.status).toBe(1);
      expect(JSON.parse(failure.stdout.toString()).results[0]).toMatchObject({ input: missing, status: 'error' });
    });

    it('reports file failures in JSON and returns a nonzero status', () => {
      const dir = tempDir();
      const input = join(dir, 'invalid.png');
      writeFileSync(input, 'not PNG');
      for (const file of [input, join(dir, 'missing.png')]) {
        const result = native(['--json', file]);
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout.toString()).results[0]).toMatchObject({ input: file, status: 'error' });
      }
    });
  });
}
