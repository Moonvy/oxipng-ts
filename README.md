# oxipng-ts

A lossless PNG/APNG optimizer ported from Rust [oxipng](https://github.com/oxipng/oxipng)
to pure TypeScript. Runs in browsers and Node.js, with a CLI and optional native
builds using [Porffor](https://porffor.dev/), [ScriptC](https://scriptc.dev/), and
[Perry](https://www.perryts.com/).
The compression core has no runtime dependencies, WASM, or native addons.

## Install

```sh
npm install oxipng-ts
```

## Library

```ts
import { oxipng, oxipngSync, Options } from 'oxipng-ts';

const input: Uint8Array = /* PNG bytes */;
const options = Options.fromPreset(3);
const output = await oxipng(input, options);
const syncOutput = oxipngSync(input, options);
```

Both APIs return PNG bytes and keep the original bytes when no improvement is
possible. Presets range from `0` (fastest) to `6` (`Options.maxCompression()`).
`Options` controls filtering, color/bit-depth/palette reductions, interlacing,
chunk stripping, DEFLATE settings, timeouts, and decompressed size limits.
`RawImage.createOptimizedPng()` accepts raw pixel data.

Preset `2` balances speed and ratio via adaptive filter scoring and match search.
See the [size/speed budget measurements](benchmark/O2-BUDGET.md) for details.

For file I/O in Node.js:

```ts
import { optimize, inFileFromPath, Options } from 'oxipng-ts/node';

const [inputSize, outputSize] = optimize(
  inFileFromPath('input.png'),
  { kind: 'path', path: 'output.png', preserveAttrs: false },
  Options.fromPreset(3),
);
```

## CLI

```sh
npx oxipng-ts -o 3 image.png
npx oxipng-ts --strip safe --out output.png input.png
cat input.png | npx oxipng-ts - > output.png
npx oxipng-ts --help
```

Supports recursive directories, stdin/stdout, JSON output, metadata preservation,
and compression controls (runs single-threaded in pure TypeScript).

## Development

Use Node.js 20+ for the library, or **Node.js 24+** to build the ScriptC target.

```sh
npm ci
npm run build:ts    # ESM, CJS, declarations, and Node CLI → dist/js
npm run build:bin   # Porffor, ScriptC, and Perry → dist/bin
npm run build:site  # GitHub Pages static site → docs
npm run typecheck
npm test
```

### Native CLI

Ahead-of-time (AOT) native binaries compile the shared TypeScript core into standalone executables with zero runtime dependencies. A C compiler (`cc` or `CC=clang`) is required.

| Target | Prerequisite | Output |
| --- | --- | --- |
| [Porffor](https://porffor.dev/) | [alpha 17](https://github.com/CanadaHonk/porffor/releases/tag/alpha-17), `porf` on PATH | `dist/bin/oxipng-ts-porffor` |
| [ScriptC](https://scriptc.dev/) | Node.js 24+, `@scriptc/compiler@0.2.8` (installed via `npm ci`) | `dist/bin/oxipng-ts-scriptc` |
| [Perry](https://www.perryts.com/) | `bun add --global @perryts/perry`, `perry` on PATH | `dist/bin/oxipng-perry` |

```sh
bun run build:bin                      # build targets with available compilers
bun run build:bin -- perry             # build specific target(s)
bun run build:bin -- porffor scriptc

./dist/bin/oxipng-perry --out output.png input.png
npm run test:porffor
npm run test:scriptc
```

Compiler binaries outside `PATH` can be specified via `PORFFOR_BIN`, `SCRIPTC_BIN`, or `PERRY_BIN`. Set `<TARGET>_KEEP_BUILD=1` to retain intermediate build artifacts.

### Browser demo

```sh
npm run build:ts
npm run build:site
npm run site        # http://localhost:5199
```

The demo runs completely client-side (no images are uploaded) and includes an interactive optimizer and benchmark visualizations driven by `benchmark/results.json`. The static site builds to `docs/` for GitHub Pages.

### Benchmark

Compare performance and byte parity against upstream Rust oxipng (`brew install oxipng`):

```sh
npm run benchmark
```

Discovers built binaries in `dist/bin` and benchmarks Node and native targets against Rust `oxipng` (or `OXIPNG_BIN`). See [benchmark/README.md](benchmark/README.md) and [benchmark/REPORT.md](benchmark/REPORT.md).

For the UPNG.js comparison (`-o 0` through `-o 3`):

```sh
npm run benchmark:upng -- --runs 5
```

See [benchmark/UPNG-REPORT.md](benchmark/UPNG-REPORT.md).

## Compression

The built-in TypeScript DEFLATE engine uses custom LZ77 and dynamic Huffman coding:
- **Levels 7–9**: Hash-chain match finder (3–4 byte matches with 8-byte hash chains).
- **Levels 10–12**: 4-byte-prefix binary tree caching match alternatives, seeded Huffman cost modeling, and multi-pass optimal parsing.
- **Block splitting**: Guided by byte-distribution changes (capped at 65,535 bytes per block).

Optimization remains lossless unless explicitly lossy options (such as `--scale16`) are specified.

> **Note**: Rust oxipng uses C `libdeflate`, so minor differences in output size or reduction decisions may occur. The `libdeflater` option configures matching compression levels without loading external libraries; `zopfli` currently maps to level 12.
> See [benchmark/PERFORMANCE.md](benchmark/PERFORMANCE.md) for detailed measurements.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/index.ts`, `src/node.ts` | Universal and Node library APIs |
| `src/cli.ts`, `src/cli-main.ts` | Node entry and shared CLI |
| `src/png/`, `src/headers.ts`, `src/apng.ts` | PNG/APNG parsing and encoding |
| `src/optimize.ts`, `src/evaluate.ts`, `src/reduction/`, `src/filters/`, `src/deflate/` | Optimization and compression core |
| `src/porffor/`, `src/scriptc/`, `src/perry/`, `scripts/` | Native adapters and build tools |
| `test/`, `benchmark/`, `site/`, `docs/` | Regression tests, benchmark, site source, GitHub Pages output |

## License

MIT. Ported from [oxipng](https://github.com/oxipng/oxipng), also MIT licensed.
