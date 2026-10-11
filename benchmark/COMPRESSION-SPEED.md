# Compression speed optimization

Matched comparison: the pre-change and current TypeScript APIs ran alternately in one process, with one warmup and three measured runs per sample. Values below are medians; decoding and byte comparisons are outside the timed regions.

Environment: Apple M3 Pro, darwin/arm64, Node v26.7.0.

| Sample | Before (ms) | After (ms) | Time reduction | Output (B) |
| --- | ---: | ---: | ---: | ---: |
| IMG_5112.PNG | 1131.6 | 1043.5 | 7.8% | 817288 |
| Image Capture.png | 1391.2 | 1239.3 | 10.9% | 558294 |
| Qjiao.png | 1720.7 | 1514.0 | 12.0% | 562538 |
| Siri AI.png | 1591.9 | 1395.1 | 12.4% | 563067 |
| **Total** | **5835.4** | **5191.9** | **11.0%** | **2501187** |

All 13 extended samples match the pre-change encoder byte for byte, with independent PNG/APNG decoding and deterministic output checks. Their combined median time decreased from 8857.7 ms to 8144.6 ms (8.1%). Speed varies by input: generated/shapes.png increased from 148.5 ms to 177.7 ms; this change is not a universal speedup.

The matching CLI command (`npm run benchmark:min -- --output-dir /private/tmp/oxipng-speed-cli`) reported Node at 5.6 s, Rust at 2.8 s and Node startup at 34.2 ms. The user-provided prior CLI run reported Node at 6.4 s. These CLI results are separate runs; the alternating API measurements above are the controlled before/after comparison.

Implementation: specialize tree insertion for skipped long-match interiors, stop comparisons once the tree-copy threshold is reached, locate word mismatches using bit operations, and isolate minimum-cost path computation with distance costs outside the inner length loop. Compression levels, search depths, filter choices and tie handling are preserved.

Validation: TypeScript build and typecheck passed; 552 tests passed, 4 skipped when excluding test/site-benchmark.test.js. The full suite has three unrelated website benchmark failures (two assertions and a server listen EPERM). Regression tests pin pre-change DEFLATE fingerprints at levels 10–12 and cover long-match interiors, window boundaries and block boundaries.

Measurements, individual timings, CLI results, baseline bundle hash and output hashes: [compression-speed.json](compression-speed.json).

Reproduce the API comparison after preserving the old bundle outside dist and rebuilding:

```sh
node benchmark/core.mjs --baseline /path/to/baseline.mjs --runs 3 --warmup 1 --corpus extended --output /tmp/comparison.json
```
