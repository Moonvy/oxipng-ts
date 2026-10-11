import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { fixScriptcArrayOwnership } from '../scripts/scriptc-compiler-fix.mjs';
import { scriptcStaticSource } from '../scripts/scriptc-static-compat.mjs';

describe('ScriptC compiler initialization fix', () => {
  it('removes the TDZ without losing the dynamic-view analysis', () => {
    const source = `
      const sourceFiles = [];
        const ownership = new ArrayOwnership(sourceFiles, {
            dynamicViewKeys: () => (dynamicViews ??= collectDynamicViews()),
        });
        let dynamicViews = null;
        const collectDynamicViews = () => {
            return new Set(['array-element-abi']);
        };
        const elementStates = new ArrayElementStates({});
      return [...ownership.keys];
    `;
    class Owner { constructor(_files, options) { this.keys = options.dynamicViewKeys(); } }
    const run = code => new Function('ArrayOwnership', 'ArrayElementStates', code)(Owner, class {});
    expect(() => run(source)).toThrow(ReferenceError);
    expect(run(fixScriptcArrayOwnership(source))).toEqual(['array-element-abi']);
  });

  it('refuses an unexpected compiler layout', () => {
    expect(() => fixScriptcArrayOwnership('const ownership = unknown();')).toThrow('refusing');
  });
});

describe('ScriptC build-only source adaptations', () => {
  const temps = [];
  afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  it('preserves scanline loop control and evaluates nested indexed mutations once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scriptc-source-'));
    temps.push(dir);
    mkdirSync(join(dir, 'src'));
    const filename = join(dir, 'src/probe.ts');
    const source = `
      class Lines {
        pos = 0;
        constructor(public values: number[]) {}
        next(): { value: number } | null {
          return this.pos === this.values.length ? null : { value: this.values[this.pos++] };
        }
        [Symbol.iterator](): Iterator<{ value: number }> {
          return { next: () => { const value = this.next(); return value === null ? { done: true, value: undefined } : { done: false, value }; } };
        }
      }
      function sample() {
        const scScan_1 = 'existing local';
        const image = { scanLines: () => new Lines([0, 1, 2, 3, 4]) };
        const picked: number[] = [];
        for (const line of image.scanLines()) {
          if (line.value === 1) continue;
          if (line.value === 4) break;
          picked.push(line.value);
        }
        let index = 0;
        const bytes = new Uint8Array([2, 2, 3]);
        const counts = new Uint32Array(4);
        counts[bytes[index++]]++;
        counts[bytes[index++]] += 2;
        const record = { key: 7 };
        const tuple: [number, number] = [5, 6];
        const key: 'key' = 'key';
        return { picked, counts: Array.from(counts), index, key: record[key], tuple: tuple[1], local: scScan_1 };
      }
    `;
    writeFileSync(filename, source);
    const program = ts.createProgram([filename], { target: ts.ScriptTarget.ES2022, strict: true });
    const adapted = scriptcStaticSource(filename, program);
    const run = code => new Function(transformSync(code, { loader: 'ts' }).code + '\nreturn sample();')();
    expect(run(adapted)).toEqual(run(source));
    expect(run(adapted)).toEqual({ picked: [0, 2, 3], counts: [0, 0, 3, 0], index: 2, key: 7, tuple: 6, local: 'existing local' });
  });
});

const metadata = new URL('../dist/bin/oxipng-ts-scriptc.build.json', import.meta.url);
describe.skipIf(!existsSync(metadata))('ScriptC static artifact', () => {
  it('records a fully static coverage result', () => {
    const build = JSON.parse(readFileSync(metadata, 'utf8'));
    expect(build.mode).toBe('static (LLVM, no JavaScript engine)');
    expect(build.staticStatements).toBeGreaterThan(3000);
    expect(build.dynamicStatements).toBe(0);
    expect(build.failedStatements).toBe(0);
    const coverage = JSON.parse(readFileSync(new URL('../dist/bin/oxipng-ts-scriptc.coverage.json', import.meta.url), 'utf8'));
    expect(coverage.stats).toMatchObject({ percentStatic: 100, statementsDynamic: 0, statementsFailed: 0 });
    expect(coverage.stats.statementsStatic).toBe(build.staticStatements);
    expect(coverage.groups).toEqual([]);
  });
});
