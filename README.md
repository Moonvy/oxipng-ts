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

Preset `2` retains four filters and level-11 match search, with cheaper filter
scoring on eligible 8-bit truecolor inputs and one parsing pass for ordinary
blocks. Highly compressible blocks retain three passes. The speed budget was
validated within a 5% per-image output increase against the previous preset
on the checked corpus; this is not a universal size guarantee. Explicit
`--zc 11` retains full parsing. See the [size/speed measurements](benchmark/O2-BUDGET.md).

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

Supports recursive input, stdin/stdout, JSON output, attribute preservation,
PNG/APNG transformations, and compression controls. All TypeScript builds run
synchronously on one thread, including when compatibility flags such as
`--threads` are supplied.

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

`build:ts` clears only `dist/js`, `build:bin` clears only `dist/bin`, and
`build:site` clears only `docs`. Native builds can run independently of the TS
build. All targets compile the shared CLI and compression core and need no
Node.js at runtime. `build:site` requires a prior `build:ts` output.
A C compiler (`cc`, or `CC=clang`) is required. Build separately for each target
OS/architecture. Porffor and ScriptC have been verified on macOS ARM64, support
Linux hosts, and require WSL on Windows. Perry uses its host platform toolchain.

| Target | Build prerequisite | Output |
| --- | --- | --- |
| Porffor | [alpha 17](https://github.com/CanadaHonk/porffor/releases/tag/alpha-17), `porf` on PATH | `dist/bin/oxipng-ts-porffor` |
| ScriptC | Node.js 24+, pinned `@scriptc/compiler@0.2.8` installed by `npm ci` | `dist/bin/oxipng-ts-scriptc` |
| Perry | [Perry](https://www.perryts.com/), `perry` on PATH and its platform linker | `dist/bin/oxipng-perry` (`.exe` on Windows) |

```sh
bun run build:bin                      # targets with installed compilers
bun run build:bin -- perry             # only Perry
bun run build:bin -- porffor scriptc    # select multiple targets
./dist/bin/oxipng-ts-scriptc --out output.png input.png
./dist/bin/oxipng-perry --out output.png input.png

npm run test:porffor
npm run test:scriptc
```

Without target arguments, missing compilers are reported and skipped. Explicitly
selected targets and compiler path overrides must be available. Compiler checks
run before clearing `dist/bin`; if no compiler is available, existing output is
preserved. Compilation errors from available targets still fail the build.

Set `PORFFOR_BIN=/path/to/porf` if the compiler is outside PATH. Compiler-specific
adaptations are applied during builds; the public TypeScript implementation is
shared. Porffor restores source types and uses a checked native DEFLATE word
reader. ScriptC applies a guarded compiler initialization fix, compiles through
LLVM with no JavaScript engine, and requires 100% static coverage with zero failed
or dynamic statements. Its `.build.json` and `.coverage.json` accompany the binary.
Set `PORFFOR_KEEP_BUILD=1` or `SCRIPTC_KEEP_BUILD=1` to retain intermediate inputs.

Install Perry with `bun add --global @perryts/perry` and follow its
[platform setup instructions](https://docs.perryts.com/getting-started/installation.html).
The Perry target stages the original TypeScript modules so Perry can see their
type annotations, then compiles the CLI with Perry's Node API compatibility
layer and a generic CPU baseline. Its staged `headers.ts` contains a narrow
workaround for a cross-module inline linker issue in Perry 0.5.1520. The zlib
writer serializes Adler-32 from its 16-bit parts to avoid Perry's incorrect
unsigned 32-bit return lowering. Set `PERRY_BIN=/path/to/perry` to select a
compiler and `PERRY_KEEP_BUILD=1` to retain intermediate output.
Compiler version, host platform, architecture and binary size are recorded in
`dist/bin/oxipng-perry.build.json` (on Windows, `dist/bin/oxipng-perry.exe.build.json`).
Perry builds for the current host; build on each destination OS/architecture.
The CLI benchmark covers Rust, Node, Porffor and ScriptC.

### Browser demo

```sh
npm run build:ts
npm run build:site
npm run site        # http://localhost:5199
```

`site/` contains the static HTML/CSS/JS website source; `docs/` is its generated
GitHub Pages output with a local PNG optimizer, comparison
charts and a ball animation whose relative speed comes from the CLI benchmark.
Processing stays on the browser's main thread; images are never uploaded.
The browser bundle, samples and cited benchmark artifacts are generated by the build.

The charts and animation read `benchmark/results.json`, including each sample's
elapsed time, output size, preset, environment and measurement date. Values are
not embedded in the page. Select an individual sample or the complete set;
pause, reset or change animation playback speed. Reduced-motion preferences
start the animation paused.

`npm run site` serves the canonical benchmark files directly: after a benchmark
run, reload the page or click **刷新数据** to see the new results. For static hosting,
run `npm run build:site` after updating benchmark results, then deploy the entire
`docs/` directory. It refreshes `docs/benchmark/` and its source reports on every
build. Commit `docs/` and configure GitHub Pages to publish from the branch’s
`/docs` folder. A `.nojekyll` file is generated alongside the site. CLI measurements include process
startup and are displayed separately from the interactive browser's own timings.

### Benchmark

Run `build:ts` and `build:bin` for the native targets to compare, and install Rust
oxipng (`brew install oxipng` on macOS), then run:

```sh
npm run benchmark
```

The benchmark discovers available native CLIs in `dist/bin` and reads the Node
CLI from `dist/js/cli.js`. It checks output byte parity and measures CLI/startup
time; native targets that have not been built are omitted. Rust oxipng is found
in `dist/bin/oxipng`, on PATH, or through `OXIPNG_BIN`.
See [benchmark/README.md](benchmark/README.md) for options and binary paths, and
[benchmark/REPORT.md](benchmark/REPORT.md) for the latest results.

A separate lossless UPNG.js comparison covers oxipng-ts presets `-o 0` through
`-o 3`:

```sh
npm run benchmark:upng -- --runs 5
```

See [benchmark/UPNG-REPORT.md](benchmark/UPNG-REPORT.md) for the saved results
and [benchmark/README.md](benchmark/README.md#upngjs-comparison) for limitations.

## Compression

The built-in TypeScript DEFLATE encoder uses LZ77 and dynamic Huffman coding.
Levels 7–9 combine nearest three/four-byte matches with an eight-byte hash chain.
Levels 10–12 use a four-byte-prefix binary tree to cache progressively longer
matches with their nearer distance alternatives, including five-to-seven-byte
matches. They seed the Huffman cost model from a greedy parse of the current
block, then reparse the cache and retain the smallest measured result.
High-level trials stop when measured gains fall below a level-specific threshold
and retain the smallest block across passes. Byte-distribution changes guide
block boundaries, with blocks capped at 65,535 bytes. The encoder reuses fixed-size
scratch buffers and uses the same parser for encoding and exact size counting.
Rust oxipng uses libdeflate, so compression size, speed, and some
borderline reduction choices can differ. PNG/APNG optimization remains lossless
unless an explicitly lossy option such as `--scale16` is enabled.
The `libdeflater` option names the built-in encoder's level convention; it does
not load libdeflate. The `zopfli` option currently uses built-in level 12 and
does not implement Zopfli's iteration algorithm.
See [the optimization measurements](benchmark/PERFORMANCE.md) for before/after
results and the remaining gap to Rust.

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
