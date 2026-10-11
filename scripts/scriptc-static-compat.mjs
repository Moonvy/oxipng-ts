import ts from 'typescript';

// Build-only adaptations: keep the public TS/Node/browser implementation intact.
export function prepareScriptcStaticSource(source, filename) {
  const relative = filename.replaceAll('\\', '/').split('/src/')[1];
  if (relative === 'util/filterSet.ts') source = source.replace('Iterable<FilterStrategy>', 'FilterStrategy[]');
  if (relative === 'util/byteBuffer.ts') {
    source = source.replace('ArrayLike<number>', 'Uint8Array');
    source = source.replace(/    if \(bytes instanceof Uint8Array\) \{[\s\S]*?\n    \}/, '    this.buf.set(bytes, this.len);');
  }
  if (relative === 'png/index.ts') source = source.replace('out.extend([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);', 'out.extend(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));');
  if (relative === 'cli-main.ts') source = source.replace('filter: rowFilterFromNumber(f)', 'filter: Number(rowFilterFromNumber(f))');
  if (relative === 'optimize.ts') {
    // Every CLI filter is a plain object; retain JS's default object string in logs.
    source = source.replaceAll('${result.filter}', '[object Object]');
  }
  if (relative === 'node.ts') {
    source = 'declare function nativeMode(path: string): number;\n' + source;
    source = source.replace('{ atime: Date; mtime: Date; mode: number }', '{ atime: number; mtime: number; mode: number }');
    source = source.replace('atime: s.atime, mtime: s.mtime, mode: s.mode', 'atime: s.atimeMs / 1000, mtime: s.mtimeMs / 1000, mode: nativeMode(path)');
    // The executable does not expose the browser library's ArrayBuffer overloads.
    source = source.replace("export { optimizeFromMemory, Options } from './index.ts';", '');
  }
  if (relative === 'error.ts') source = source.replace('${colorType}', '[object Object]');
  if (relative === 'reduction/palette.ts') {
    source = source.replace('sum[1] += bestRow[sum[0]];', 'sum[1] = sum[1] + bestRow[sum[0]];');
    source = source.replace('const chainb = chains[cb];', 'const chainb = chains[cb]!;');
    source = source.replace('const chaina = chains[ca];', 'const chaina = chains[ca]!;');
    source = source.replace('vx[v][1] = ca;', 'vx[v]![1] = ca;');
  }
  return source;
}

export function scriptcStaticSource(filename, program) {
  // Analyze the prepared mirror, so every adaptation uses the exact receiver's
  // type, including when identically named variables occur in different scopes.
  const sf = program.getSourceFile(filename);
  if (!sf) throw new Error(`Missing ScriptC source in checked program: ${filename}`);
  const checker = program.getTypeChecker();
  const transform = context => {
    const f = context.factory;
    const visit = node => {
      if (filename.replaceAll('\\', '/').endsWith('/png/scanLines.ts') &&
          ts.isClassDeclaration(node) && node.name?.text === 'ScanLines') {
        // All native scanline consumers below drive next() directly; omit the
        // unused JS iterator adapter with its unsupported Iterator<T> signature.
        const members = node.members.filter(member => !(member.name && ts.isComputedPropertyName(member.name) &&
          member.name.expression.getText(sf) === 'Symbol.iterator'));
        return f.updateClassDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses,
          members.map(member => ts.visitNode(member, visit)));
      }
      if (ts.isForOfStatement(node) && ts.isCallExpression(node.expression) &&
          ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === 'scanLines') {
        const id = f.createUniqueName('scScan');
        const binding = node.initializer.declarations[0].name;
        const body = ts.isBlock(node.statement) ? node.statement.statements : [node.statement];
        return f.createBlock([
          f.createVariableStatement(undefined, f.createVariableDeclarationList([
            f.createVariableDeclaration(id, undefined, undefined, ts.visitNode(node.expression, visit)),
          ], ts.NodeFlags.Const)),
          f.createWhileStatement(f.createTrue(), f.createBlock([
            f.createVariableStatement(undefined, f.createVariableDeclarationList([
              f.createVariableDeclaration(binding, undefined, undefined, f.createCallExpression(f.createPropertyAccessExpression(id, 'next'), undefined, [])),
            ], ts.NodeFlags.Const)),
            f.createIfStatement(f.createBinaryExpression(binding, f.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken), f.createNull()), f.createBreakStatement()),
            ...body.map(s => ts.visitNode(s, visit)),
          ], true)),
        ], true);
      }
      // Restrict coercion to numeric array indices. Indexed reads may carry an
      // undefined arm in ScriptC IR even when unchecked access is disabled.
      // Tuple field numbers and string/record keys retain their original form.
      if (ts.isElementAccessExpression(node) && !ts.isNumericLiteral(node.argumentExpression)) {
        const t = checker.getTypeAtLocation(node.expression);
        const indexType = checker.getTypeAtLocation(node.argumentExpression);
        const numeric = (type) => (type.flags & ts.TypeFlags.NumberLike) !== 0 ||
          (type.isUnion() && type.types.every(arm => (arm.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.Undefined)) !== 0));
        const array = !checker.isTupleType(t) && (checker.isArrayType(t) ||
          /^(Uint|Int|Float|BigInt|BigUint)\d+(Clamped)?Array/.test(checker.typeToString(t)));
        if (array && numeric(indexType)) return f.updateElementAccessExpression(node, ts.visitNode(node.expression, visit),
          f.createCallExpression(f.createIdentifier('Number'), undefined, [ts.visitNode(node.argumentExpression, visit)]));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  };
  const result = ts.transform(sf, [transform]);
  const printed = ts.createPrinter().printFile(result.transformed[0]);
  result.dispose();
  return printed;
}
