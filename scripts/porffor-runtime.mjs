import ts from 'typescript';
import { transform } from 'esbuild';

/** Preserve the hot reader's types without altering the POSIX host's raw-C ABI.
 * Host C snippets refer to concrete local names and jsval fields, so those
 * functions keep their established JS lowering and never enter the bundler.
 */
export async function preparePorfforRuntime(source) {
  const ast = ts.createSourceFile('runtime.ts', source, ts.ScriptTarget.Latest, true);
  const reader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'pfCoreGetUint32LE');
  if (!reader) throw new Error('Missing Porffor DEFLATE reader');
  const host = ts.factory.updateSourceFile(ast, ast.statements.filter(node => node !== reader));
  const lowered = await transform(ts.createPrinter().printFile(host), { loader: 'ts', target: 'esnext' });
  return lowered.code + '\n' + reader.getText(ast) + '\n';
}
