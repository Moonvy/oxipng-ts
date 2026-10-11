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
