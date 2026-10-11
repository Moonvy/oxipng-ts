import ts from 'typescript';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const primitives = new Map([
  ['number', ts.SyntaxKind.NumberKeyword], ['boolean', ts.SyntaxKind.BooleanKeyword],
  ['string', ts.SyntaxKind.StringKeyword], ['void', ts.SyntaxKind.VoidKeyword],
]);
const builtins = new Set(['DataView', 'ArrayBuffer', 'Uint8Array', 'Uint8ClampedArray',
  'Uint16Array', 'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array']);
const f = ts.factory;
function typeNode(name) {
  return primitives.has(name) ? f.createKeywordTypeNode(primitives.get(name)) : f.createTypeReferenceNode(name);
}
function simpleType(node, file) {
  const name = node?.getText(file);
  return primitives.has(name) || builtins.has(name) ? name : undefined;
}

/** Restore hints using exact source positions, including esbuild-renamed bindings.
 * Never match on names alone: different modules can declare the same function.
 * Only simple, supported types are passed to Porffor. The host's raw-C ABI is
 * deliberately outside this transformation.
 */
export function restorePorfforTypes(source, sourceMap) {
  const map = new TraceMap(sourceMap);
  const origins = new Map();
  for (let i = 0; i < map.sources.length; i++) {
    const content = map.sourcesContent?.[i];
    if (content == null) continue;
    const file = ts.createSourceFile(map.sources[i], content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declarations = new Map();
    const collect = node => {
      if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        declarations.set(node.name.getStart(file), node);
      }
      ts.forEachChild(node, collect);
    };
    collect(file);
    origins.set(map.sources[i], { file, declarations });
  }
  const ast = ts.createSourceFile('cli.ts', source, ts.ScriptTarget.Latest, true);
  function original(node) {
    const pos = ast.getLineAndCharacterOfPosition(node.name.getStart(ast));
    const mapped = originalPositionFor(map, { line: pos.line + 1, column: pos.character });
    const origin = origins.get(mapped.source);
    if (!origin || mapped.line == null || mapped.column == null) return {};
    const offset = origin.file.getPositionOfLineAndCharacter(mapped.line - 1, mapped.column);
    return { file: origin.file, node: origin.declarations.get(offset) };
  }
  let functions = 0, variables = 0;
  const transformed = ts.transform(ast, [context => {
    const visit = node => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const origin = original(node);
        if (origin.node && ts.isFunctionDeclaration(origin.node) && node.parameters.length === origin.node.parameters.length) {
          const params = origin.node.parameters.map(p => simpleType(p.type, origin.file));
          const result = simpleType(origin.node.type, origin.file);
          if (result || params.some(Boolean)) {
            functions++;
            node = f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters,
              node.parameters.map((p, i) => f.updateParameterDeclaration(p, p.modifiers, p.dotDotDotToken, p.name,
                p.questionToken, params[i] ? typeNode(params[i]) : p.type, p.initializer)),
              result ? typeNode(result) : node.type, node.body);
          }
        }
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const origin = original(node);
        if (origin.node && ts.isVariableDeclaration(origin.node)) {
          const init = origin.node.initializer;
          // These initializers infer stable types in the checked TypeScript source.
          // Do not infer from generated JS temporaries or arbitrary expressions.
          let type;
          if (init && (ts.isNumericLiteral(init) || ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand))) type = 'number';
          if (init && ts.isNewExpression(init) && ts.isIdentifier(init.expression) && builtins.has(init.expression.text)) type = init.expression.text;
          // An explicit any/union annotation must not be narrowed by the initializer.
          if (origin.node.type) type = simpleType(origin.node.type, origin.file);
          if (type) {
            variables++;
            node = f.updateVariableDeclaration(node, node.name, node.exclamationToken, typeNode(type), node.initializer);
          }
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  }]);
  try { return { source: ts.createPrinter().printFile(transformed.transformed[0]), functions, variables }; }
  finally { transformed.dispose(); }
}
