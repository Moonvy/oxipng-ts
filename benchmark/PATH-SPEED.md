# Path calculation and convergence optimization

This round compares against the bundle after the earlier compression-speed optimization. It does not reuse the original 6.4 s CLI result as its baseline.

Changes:

- Long-match blocks use equal-cost length ranges. Cumulative match-cache offsets identify literal-only suffix intervals, whose positive step costs prove that the last suffix is the unique minimum. Short or non-monotone ranges retain scalar enumeration and the original tie rules.
- Blocks with average greedy token length of at most 32 bytes retain the original scalar hot loop. General range indexes and match-position lists were discarded after they failed to show a stable benefit.
- Compression stops once both the literal/length and distance Huffman cost models match the model used for the preceding path computation. Equal output size alone never triggers this rule.

The configured compression levels, filter selection, match-search depths and original improvement threshold are unchanged.

## Whole PNG/APNG comparison

Alternate baseline/current API runs; one warmup and three measured runs per file, reporting medians. Independent pixel/frame decoding and byte comparisons run outside the timed regions.

| Sample | Before (ms) | After (ms) | Output (B) | Byte parity |
| --- | ---: | ---: | ---: | --- |
| IMG_5112.PNG | 1071.7 | 1043.0 | 817288 | exact |
| Image Capture.png | 1282.0 | 1234.4 | 558294 | exact |
| Qjiao.png | 1529.8 | 1522.1 | 562538 | exact |
| Siri AI.png | 1426.1 | 1598.7 | 563067 | exact |
| **Total** | **5309.5** | **5398.2** | **2501187** | **exact** |

There is no demonstrated end-to-end speedup on the four screenshot samples. The full 13-file corpus measured 8303.6 ms before and 8346.8 ms after (0.5% slower). Individual timings fluctuate; in particular, Siri AI.png measured 1426–1723 ms after the change. All 13 outputs remain byte-for-byte identical to the pre-round bundle.

The CLI minimum-of-three benchmark still reports Node at 5.7 s and Rust at 2.8 s. Its current startup measurement compresses a 1×1 PNG, so its startup figures are not directly comparable to the earlier --version measurements.

## Repeated-data DEFLATE comparison

1 MiB synthetic inputs; raw DEFLATE levels 11 and 12, three warmups and seven alternating measured runs, reporting medians. These results measure the compression core, not complete PNG/CLI performance.

| Input | Level | Before (ms) | After (ms) | Time reduction |
| --- | ---: | ---: | ---: | ---: |
| zero run | 11 | 38.88 | 34.70 | 10.8% |
| zero run | 12 | 95.56 | 90.27 | 5.5% |
| periodic | 11 | 37.76 | 32.64 | 13.6% |
| periodic | 12 | 95.77 | 91.19 | 4.8% |

All synthetic streams also match the pre-round encoder byte for byte. Gains apply to repetitive content and should not be generalized to screenshots.

Validation: TypeScript build and typecheck passed; the relevant suite passed 554 tests with 4 skipped, excluding the known website benchmark failures. A further long-match length-boundary golden test was then added and validated in the targeted DEFLATE suite. Golden hashes cover pre-change stream choices at levels 10–12, all length-code boundaries, convergence, block tails, and exact size limits.

Raw timings and parity checks: [path-speed.json](path-speed.json).

```sh
node benchmark/core.mjs --baseline /path/to/pre-round.mjs --runs 3 --warmup 1 --corpus extended --output /tmp/path-comparison.json
npm run benchmark:min -- --output-dir /tmp/path-cli
```
