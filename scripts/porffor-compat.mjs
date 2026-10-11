import ts from 'typescript';
import { resolve } from 'node:path';

const integerArrays = new Set(['Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array']);

/** Alpha 17 drops typed-array element ++ writes. Compound assignment works.
 * Lower integer typed-array updates in the native build, retaining postfix values.
 * Also materialize Error.message and adapt Unicode suffix / byte-prefix logic.
 * Keep these workarounds out of the normal Node/browser build.
 */
export function porfforCompatibleSource(source, fileName, program) {
  // The lowest-set-bit idiom miscompiles when diff is 0x80000000, turning
  // a three-byte prefix into a huge match length. Test byte masks instead.
  const isDeflate = fileName.endsWith('/deflate/deflate.ts');
  const expression = '(31 - Math.clz32(diff & -diff)) >>> 3';
  if (isDeflate && !source.includes(expression)) throw new Error('DEFLATE match expression changed; review the Porffor compatibility adapter.');
  if (!program) {
    fileName = resolve(fileName);
    const options = { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext };
    const host = ts.createCompilerHost(options);
    const read = host.readFile.bind(host);
    host.readFile = path => path === fileName ? source : read(path);
    program = ts.createProgram([fileName], options, host);
  }
  const ast = program.getSourceFile(fileName);
  if (!ast || ast.text !== source) throw new Error(`Source/checker mismatch: ${fileName}`);
  const checker = program.getTypeChecker();
  const { factory: f } = ts;
  let wordReads = 0;
  const transformed = ts.transform(ast, [(context) => {
    const visit = (node) => {
      if (isDeflate && ts.isBinaryExpression(node) && node.getText(ast) === expression) {
        return f.createCallExpression(f.createIdentifier('pfMatchingBytes'), undefined, [f.createIdentifier('diff')]);
      }
      if (isDeflate && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'getUint32' && node.arguments.length === 2 &&
          node.arguments[1].kind === ts.SyntaxKind.TrueKeyword &&
          checker.getTypeAtLocation(node.expression.expression).getSymbol()?.name === 'DataView') {
        wordReads++;
        return f.createCallExpression(f.createIdentifier('pfCoreGetUint32LE'), undefined, [
          ts.visitNode(node.expression.expression, visit), ts.visitNode(node.arguments[0], visit),
        ]);
      }
      // Alpha 17 endsWith compares mixed UTF-16/byte strings incorrectly.
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'endsWith' &&
          (checker.getTypeAtLocation(node.expression.expression).flags & ts.TypeFlags.StringLike)) {
        return f.createCallExpression(f.createIdentifier('pfStringEndsWith'), undefined, [
          ts.visitNode(node.expression.expression, visit), ...node.arguments.map(arg => ts.visitNode(arg, visit)),
        ]);
      }
      if ((ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
          ts.isElementAccessExpression(node.operand) &&
          integerArrays.has(checker.getTypeAtLocation(node.operand.expression).getSymbol()?.name)) {
        const increment = node.operator === ts.SyntaxKind.PlusPlusToken;
        const updated = f.createParenthesizedExpression(f.createBinaryExpression(
          ts.visitEachChild(node.operand, visit, context),
          increment ? ts.SyntaxKind.PlusEqualsToken : ts.SyntaxKind.MinusEqualsToken,
          f.createNumericLiteral(1),
        ));
        return ts.isPostfixUnaryExpression(node) ? f.createParenthesizedExpression(f.createBinaryExpression(
          updated, increment ? ts.SyntaxKind.MinusToken : ts.SyntaxKind.PlusToken, f.createNumericLiteral(1),
        )) : updated;
      }
      if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.kind === ts.SyntaxKind.SuperKeyword && node.expression.arguments.length === 1 &&
          ts.isConstructorDeclaration(node.parent.parent) && node.parent.parent.parent.heritageClauses?.some(clause =>
            clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.some(type => type.expression.getText(ast) === 'Error'))) {
        const message = node.expression.arguments[0];
        const saved = f.createUniqueName('pfMessage');
        return [
          f.createVariableStatement(undefined, f.createVariableDeclarationList([
            f.createVariableDeclaration(saved, undefined, undefined, ts.visitNode(message, visit)),
          ], ts.NodeFlags.Const)),
          f.createExpressionStatement(f.createCallExpression(f.createSuper(), undefined, [saved])),
          f.createExpressionStatement(f.createBinaryExpression(
            f.createPropertyAccessExpression(f.createThis(), 'message'), ts.SyntaxKind.EqualsToken, saved,
          )),
        ];
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit);
  }]);
  try {
    // The optimal binary-tree matcher adds one prefix load and two bounded
    // word comparisons. All 17 loads use the checked native reader.
    if (isDeflate && wordReads !== 17) throw new Error(`DEFLATE word reads changed (${wordReads}); review the native reader contract.`);
    return ts.createPrinter().printFile(transformed.transformed[0]);
  }
  finally { transformed.dispose(); }
}
