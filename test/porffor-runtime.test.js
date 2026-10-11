import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { preparePorfforRuntime } from '../scripts/porffor-runtime.mjs';

// The explicit native test command requires a compiler, while ordinary JS tests
// remain runnable without one. Probe the same unbundled runtime used in the CLI.
describe.skipIf(!process.env.PORFFOR_BIN && process.env.npm_lifecycle_event !== 'test:porffor')('Porffor native runtime', () => {
  let dir, result;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'oxipng-porffor-runtime-'));
    const text = readFileSync(new URL('../src/porffor/runtime.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('runtime.ts', text, ts.ScriptTarget.Latest, true);
    const helpers = new Set(['pfCoreGetUint32LE', 'pfMatchingBytes', 'pfStringEndsWith']);
    const sourceHelpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && helpers.has(node.name?.text))
      .map(node => node.getText(ast)).join('\n');
    expect(sourceHelpers).not.toBe('');
    const runtime = await preparePorfforRuntime(sourceHelpers);
    const source = join(dir, 'probe.ts'), binary = join(dir, 'probe');
    writeFileSync(source, runtime + `
      const bytes = new Uint8Array([99, 17, 34, 51, 128, 255, 255, 255, 255, 9]);
      const view = new DataView(bytes.buffer, 1, 8);
      const reads = [];
      for (let i = 0; i <= 4; i++) reads.push(pfCoreGetUint32LE(view, i));
      let bounds = 0;
      for (const offset of [-1, 5, 8]) {
        try { pfCoreGetUint32LE(view, offset); } catch (error) { if (error instanceof RangeError) bounds++; }
      }
      try { pfCoreGetUint32LE(new DataView(bytes.buffer, 1, 0), 0); }
      catch (error) { if (error instanceof RangeError) bounds++; }
      const prefix = [1, 256, 65536, 0x80000000].map(diff => pfMatchingBytes(diff));
      const suffix = [pfStringEndsWith('图片.png', '.png'), pfStringEndsWith('图片.png', '图', 1),
        pfStringEndsWith('abc', 'abc', Infinity), pfStringEndsWith('abc', 'abc', NaN),
        pfStringEndsWith('abc', '', NaN), pfStringEndsWith('abc', '', -Infinity),
        pfStringEndsWith('abc', 'b', 2.9)];
      console.log(JSON.stringify({ reads, bounds, prefix, suffix }));
    `);
    const compiler = spawnSync(process.env.PORFFOR_BIN || 'porf', ['native', source, '-o', binary], { encoding: 'utf8', timeout: 60_000 });
    if (compiler.error || compiler.status !== 0) throw new Error(`Runtime probe build failed: ${compiler.error?.message || compiler.stderr || compiler.stdout}`);
    const execution = spawnSync(binary, [], { encoding: 'utf8', timeout: 10_000 });
    if (execution.error || execution.status !== 0) throw new Error(`Runtime probe failed: ${execution.error?.message || execution.stderr}`);
    result = JSON.parse(execution.stdout);
  });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('reads unsigned little-endian words with nonzero view offsets and unaligned addresses', () => {
    const bytes = Uint8Array.from([99, 17, 34, 51, 128, 255, 255, 255, 255, 9]);
    const view = new DataView(bytes.buffer, 1, 8);
    expect(result.reads).toEqual(Array.from({ length: 5 }, (_, i) => view.getUint32(i, true)));
    expect(result.reads[4]).toBe(0xffffffff);
  });
  it('rejects reads outside the view, including empty views', () => { expect(result.bounds).toBe(4); });
  it('counts equal bytes correctly when bit 31 differs', () => { expect(result.prefix).toEqual([0, 1, 2, 3]); });
  it('handles mixed string representations and suffix end positions', () => {
    expect(result.suffix).toEqual([true, true, true, false, true, true, true]);
  });
});
