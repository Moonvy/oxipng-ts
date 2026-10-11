import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { porfforCompatibleSource } from '../scripts/porffor-compat.mjs';

describe('Porffor source compatibility', () => {
  it('preserves numeric updates, postfix values, and computed-key side effects', () => {
    const source = `
      const data = new Uint16Array([3]);
      let calls = 0;
      function key() { calls++; return 0; }
      const old = data[key()]++;
      const next = ++data[key()];
      const beforeDecrement = data[key()]--;
      const afterDecrement = --data[key()];
      var result = [old, next, beforeDecrement, afterDecrement, data[0], calls];
    `;
    const expected = {};
    const actual = {};
    runInNewContext(source, expected);
    runInNewContext(porfforCompatibleSource(source, 'probe.ts'), actual);
    expect(actual.result).toEqual(expected.result);
  });

  it('leaves unary minus, bitwise complement, and logical negation intact', () => {
    const source = 'const data = [7]; var result = [-data[0], +data[0], ~data[0], !data[0], data[0]];';
    const context = {};
    runInNewContext(porfforCompatibleSource(source, 'probe.ts'), context);
    expect(context.result).toEqual([-7, 7, -8, false, 7]);
  });

  it('retains Error subclass messages and routes mixed-string suffix checks', () => {
    const source = `class E extends Error { constructor(message) { super(message); } }
      var result = [new E('message').message, '图片.png'.endsWith('.png')];`;
    const context = { pfStringEndsWith: (value, suffix) => value.endsWith(suffix) };
    runInNewContext(porfforCompatibleSource(source, 'probe.ts'), context);
    expect(context.result).toEqual(['message', true]);
  });

  it('leaves string arrays, bigint arrays, and floating-point postfix values intact', () => {
    const source = `const strings = ['3']; const bigints = new BigInt64Array([3n]);
      const floats = new Float64Array([0.1]);
      var result = [strings[0]++, strings[0], bigints[0]++, bigints[0], floats[0]++];`;
    const expected = {}, actual = {};
    runInNewContext(source, expected);
    runInNewContext(porfforCompatibleSource(source, 'probe.ts'), actual);
    expect(actual.result).toEqual(expected.result);
  });

  it('evaluates Error messages once and leaves other super calls unchanged', () => {
    const source = `let calls = 0; function message() { calls++; return 'message'; }
      class E extends Error { constructor() { super(message()); } }
      class Base { constructor(value) { this.message = 'base: ' + value; } }
      class Derived extends Base { constructor() { super(message()); } }
      var result = [new E().message, new Derived().message, calls];`;
    const context = {};
    runInNewContext(porfforCompatibleSource(source, 'probe.ts'), context);
    expect(context.result).toEqual(['message', 'base: message', 2]);
  });

  it('does not redirect user-defined endsWith methods', () => {
    const context = {};
    runInNewContext(porfforCompatibleSource(`const obj = { endsWith: () => 42 }; var result = obj.endsWith();`, 'probe.ts'), context);
    expect(context.result).toBe(42);
  });
});
