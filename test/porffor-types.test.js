import { describe, expect, it } from 'vitest';
import { build, transform } from 'esbuild';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { restorePorfforTypes } from '../scripts/porffor-types.mjs';

describe('Porffor bundle types', () => {
  it('tracks source identity across same-name functions, renaming, and unsupported types', async () => {
    const files = {
      entry: `import { compute as numeric } from 'numeric'; import { compute as textual } from 'textual';
        import { compute as dynamic } from 'dynamic';
        globalThis.result = [numeric(3), textual('3'), dynamic('3')];`,
      numeric: `export function compute(value: number): number { const step = 1; return value + step; }`,
      textual: `export function compute(value: string): string { return value + '1'; }`,
      dynamic: `export function compute(value: any) { let mixed: any = 0; mixed = value; return mixed; }`,
    };
    const output = await build({
      entryPoints: ['entry'], bundle: true, write: false, outfile: 'bundle.js', sourcemap: 'external', format: 'esm',
      plugins: [{ name: 'test-modules', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => ({ path: args.path, namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: files[args.path], loader: 'ts' }));
      } }],
    });
    const typed = restorePorfforTypes(output.outputFiles.find(file => file.path.endsWith('.js')).text,
      output.outputFiles.find(file => file.path.endsWith('.map')).text);
    const ast = ts.createSourceFile('bundle.ts', typed.source, ts.ScriptTarget.Latest, true);
    const funcs = ast.statements.filter(ts.isFunctionDeclaration);
    expect(funcs.map(fn => fn.parameters[0].type?.getText(ast))).toEqual(['number', 'string', undefined]);
    expect(funcs.map(fn => fn.type?.getText(ast))).toEqual(['number', 'string', undefined]);
    expect(typed.source).not.toMatch(/mixed:\s*number/);
    const context = {};
    runInNewContext((await transform(typed.source, { loader: 'ts' })).code, context);
    expect(context.result).toEqual([4, '31', '3']);
  });
});
