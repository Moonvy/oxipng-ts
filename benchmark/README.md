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
