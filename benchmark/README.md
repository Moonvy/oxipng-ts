# Benchmark

Compares the native [oxipng](https://github.com/oxipng/oxipng) CLI with the `oxipng-ts` CLI on
the PNGs in `benchmark/sample/`, using identical options, and reports output size and timing.

```sh
npm run build            # build dist/ first
npm run benchmark        # defaults to -o 2
node benchmark/run.mjs --opt 6 --runs 5
```

- Native binary resolution: `$OXIPNG_BIN`, then `oxipng` on `PATH`, then a local build.
- Both tools are invoked as CLIs with the same arguments, so the comparison is like-for-like
  (Node startup is included for `oxipng-ts`).
- Native oxipng uses its default thread count; the TS encoder runs synchronously on one thread.
- Timings are best-of-`--runs` after `--warmup` runs.

Outputs:

- `benchmark/REPORT.md` — human-readable report (table + summary + caveats)
- `benchmark/results.json` — raw results

See [`REPORT.md`](./REPORT.md) for the latest run.

## Optimization baseline comparison

The saved pre-optimization build is in `baseline/dist/`. Compare it with the
current build, with independent `pngjs` pixel checks and per-file size checks:

```sh
npm run build
node benchmark/compare.mjs --label final --runs 3
```

Defaults to presets 2 and 6 on all four samples. `--baseline /path/to/dist`,
`--presets 2,6`, and `--runs N` override those settings. Timing uses the median
of N in-process runs after one warmup, with alternating baseline/current order.
The script fails on any pixel difference or output size increase and writes
`comparison-<label>.json`. See `OPTIMIZATION.md` for batch validation and results.

Additional checks: `node benchmark/deflate-parity.mjs` compares all encoder levels
against the saved build and independently inflates every result.
`node benchmark/filters.mjs` measures Paeth, Entropy, and Bigrams filtering on
Qjiao.png (nine measurements after two warmups), requiring byte-identical output.

## Second optimization round

`baseline-round2/dist/` saves the completed first-round build. The second round
requires exact output parity, rather than only checking that sizes do not grow:

```sh
bun run build
bun run typecheck
bun run test
node benchmark/deflate-parity.mjs --baseline benchmark/baseline-round2/dist --extended
node benchmark/filter-parity.mjs
node benchmark/compare.mjs --baseline benchmark/baseline-round2/dist --label round2-final --presets 2,6 --runs 3 --exact
```

`--samples Qjiao.png` limits the comparison to one sample during experiments.
The extended encoder check covers 390 raw/zlib streams across all levels,
window boundaries, offset views, late mismatches, and multiple blocks.
`filter-parity.mjs` checks Brute decisions and transparent-pixel handling on
five fixture types, also requiring input immutability.

`baseline-round2-ring/dist/` is the intermediate build with the matcher and ring
optimizations, before Brute sizing. Isolate the Brute sizing improvement with:

```sh
node benchmark/strategy-benchmark.mjs --baseline benchmark/baseline-round2-ring/dist --label round2-brute-size --runs 3
```

See [OPTIMIZATION-ROUND2.md](./OPTIMIZATION-ROUND2.md) for the retained changes,
validation, memory tradeoffs, and final timings.
