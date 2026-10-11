import { defineConfig } from '@rslib/core';

// The library has no runtime dependencies, so bundling produces fully
// self-contained output with no bare specifiers.
const output = (target: 'web' | 'node') => ({
  target,
  autoExternal: false as const,
  distPath: { root: './dist/js' },
});

export default defineConfig({
  lib: [
    // Browser / universal library.
    {
      format: 'esm',
      syntax: 'es2022',
      dts: { bundle: true },
      output: output('web'),
      source: { entry: { index: './src/index.ts' } },
    },
    {
      format: 'cjs',
      syntax: 'es2022',
      dts: false,
      output: output('web'),
      source: { entry: { index: './src/index.ts' } },
    },
    // Node.js entry points (file I/O + CLI).
    {
      format: 'esm',
      syntax: 'es2022',
      dts: { bundle: true },
      output: output('node'),
      source: { entry: { node: './src/node.ts', cli: './src/cli.ts' } },
    },
    {
      format: 'cjs',
      syntax: 'es2022',
      dts: false,
      output: output('node'),
      source: { entry: { node: './src/node.ts' } },
    },
  ],
});
