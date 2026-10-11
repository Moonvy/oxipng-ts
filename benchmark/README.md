# Benchmark

Compares Rust oxipng, Node, Porffor, and static LLVM ScriptC on the four PNGs in
`sample/`. All receive the same options; Node/Porffor/ScriptC must produce identical
bytes or the benchmark fails.

## Run

Install Rust oxipng (`brew install oxipng` on macOS) and follow the
[native build prerequisites](../README.md#native-cli). Then:

```sh
npm run build
npm run build:porffor
npm run build:scriptc
npm run benchmark                            # -o 2, five runs, one warmup
npm run benchmark -- --opt 6 --runs 3
npm run benchmark -- --runs 1 --warmup 0       # faster, noisier smoke run
```

Native builds must follow `npm run build`, which cleans `dist/`.

## Binary paths

| Implementation | Override | Default |
| --- | --- | --- |
| Rust | `OXIPNG_BIN` | PATH, `~/.local/bin/oxipng`, local build, system locations |
| Porffor | `OXIPNG_TS_PORFFOR_BIN` | `dist/oxipng-ts-porffor` |
| ScriptC | `OXIPNG_TS_SCRIPTC_BIN` | `dist/oxipng-ts-scriptc` |

`PORFFOR_BIN` selects the Porffor **compiler**, not its output executable.
The ScriptC binary's adjacent `.build.json` identifies compiler version and mode;
external binaries without metadata are reported as unknown mode.

## Measurements

Times are the fastest of the measured runs after warmup. Every file run starts a
fresh process and includes startup; `--version` startup is also reported separately.
Byte parity checks run outside the timed region.

Rust uses its default thread count and libdeflate. The three TypeScript builds use
the same built-in encoder on one thread, so Rust output size and timing can differ.
The default ScriptC target requires 100% static coverage and includes no JS engine.

Results are written to [REPORT.md](REPORT.md) and [results.json](results.json).

## In-process before/after measurements

`npm run benchmark:core` measures the public synchronous API without process
startup. It reports median and minimum elapsed times, checks independently decoded
pixels using pngjs at full 16-bit precision, checks every APNG frame and its control
fields, and checks deterministic output outside the timed region.
With `--baseline`, baseline/current runs alternate their order to reduce warmup
and ordering bias. The default is five measured runs and two warmups per file.

To reproduce the baseline used for this optimization, export revision
`65775627960607f97d3251d6926ec8c10244c2da` and bundle its library with esbuild:

```sh
baseline_dir=$(mktemp -d)
git archive 65775627960607f97d3251d6926ec8c10244c2da | tar -x -C "$baseline_dir"
node_modules/.bin/esbuild "$baseline_dir/src/index.ts" --bundle --platform=node \
  --format=esm --outfile="$baseline_dir/index.mjs"
npm run build
npm run benchmark:core -- --baseline "$baseline_dir/index.mjs" --opt 2
```

Use `--opt 6` for maximum compression and `--output /path/results.json` to keep
separate runs. Results default to [core-results.json](core-results.json).
The four-way CLI benchmark above remains the Rust comparison; it includes process
startup and uses Rust's default thread count. See [PERFORMANCE.md](PERFORMANCE.md).

`--corpus extended` adds generated gradients, transparent shapes and plasma,
plus indexed, transparent, 16-bit, interlaced, small PNG and APNG fixtures: 13
files in total. The generated `photo.png` is plasma, not a real photograph.
Run `npm run build` first to generate the three demo samples. `--rust /path/to/oxipng`
adds an independently validated Rust **size** reference; it does not mix CLI
timing with synchronous API timing.

To reproduce the baseline immediately before adaptive parsing/block splitting,
apply [adaptive-baseline.patch](adaptive-baseline.patch) to the original revision:

```sh
baseline_dir=$(mktemp -d)
git archive 65775627960607f97d3251d6926ec8c10244c2da | tar -x -C "$baseline_dir"
patch -d "$baseline_dir" -p1 < benchmark/adaptive-baseline.patch
node_modules/.bin/esbuild "$baseline_dir/src/index.ts" --bundle --platform=node \
  --format=esm --outfile="$baseline_dir/index.mjs"
npm run build
npm run benchmark:core -- --baseline "$baseline_dir/index.mjs" --corpus extended \
  --rust "$HOME/.local/bin/oxipng" --opt 2 --runs 3 --warmup 1 \
  --output benchmark/adaptive-results.json
```

Repeat with `--opt 4 --output benchmark/adaptive-level4-results.json` for the
higher preset. Results retain every measured sample; per-file regressions should
be considered alongside totals.
