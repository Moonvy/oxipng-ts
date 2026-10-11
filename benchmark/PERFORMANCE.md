# Compression optimization measurements

Measured on 2026-10-11, Apple M1, macOS arm64, Node v24.21.0. The first phase
uses the four unchanged PNGs in `benchmark/sample`; the second adds nine files.
The original baseline is revision
`65775627960607f97d3251d6926ec8c10244c2da`.

## First phase: matching and cost-based parsing

These times exclude process startup. Each value is the sum of the per-file median
times. Old/new calls alternate their order, and independent pngjs pixel decoding
and byte determinism checks run outside the timed region.

| Preset | Original output | First-phase output | Byte reduction | Original time | First-phase time | Time reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `-o 2` | 2,673,830 B | 2,622,578 B | 1.92% | 4,707.1 ms | 3,751.3 ms | 20.31% |
| `-o 4` | 2,636,033 B | 2,532,139 B | 3.94% | 11,013.9 ms | 10,543.2 ms | 4.27% |

`-o 2` uses five measured runs and two warmups per file; `-o 4` uses three
measured runs and one warmup. Individual files can have different tradeoffs:
`-o 4` is slightly slower on the first two images and faster on the last two.
Raw samples are in [core-results.json](core-results.json) and
[core-level4-results.json](core-level4-results.json).

## Second phase: adaptive parsing and block boundaries

The baseline here is the first-phase encoder, reconstructed with
[adaptive-baseline.patch](adaptive-baseline.patch). Its `deflate.ts` SHA-256 is
`00e8d18a8e15aca8bb638f542624a143902c25261808e8de532cb9309cac3ba6`.
Both presets use three measured runs and one warmup per file, alternating
baseline/current calls. No compiler builds or test suites ran during timing.

The extended corpus contains 13 PNGs: the four original screenshots, generated
gradients/transparent shapes/plasma, and indexed, transparent, 16-bit, interlaced,
small-file and APNG fixtures. Generated `photo.png` is plasma, not a photograph.
Independent checks compare full 16-bit samples, every APNG frame, timing,
disposal and blending, plus output determinism, outside the timed region.

| Preset | First-phase output | Current output | Byte reduction | First-phase time | Current time | Time reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `-o 2` | 3,214,470 B | 3,200,686 B | 0.43% | 5,256.6 ms | 4,808.5 ms | 8.53% |
| `-o 4` | 3,081,093 B | 3,068,195 B | 0.42% | 17,908.8 ms | 16,232.4 ms | 9.36% |

Raw samples: [adaptive-results.json](adaptive-results.json) and
[adaptive-level4-results.json](adaptive-level4-results.json). These are sums of
per-file medians, not a single batch measurement. Default-preset gradients take
5.5% longer; improvements are not uniform. Output size also regresses slightly
on some files: `-o 2` shapes +1 B and the two indexed/transparent fixtures +115 B
each; `-o 4` shapes +18 B, those two fixtures +113 B each, APNG +20 B.

For the original four screenshots, this phase produces 2,611,151 B at `-o 2`
and 2,521,863 B at `-o 4`, versus 2,622,578 B and 2,532,139 B in the first phase.
Their measured time reductions in this run are 9.76% and 10.33%, respectively.

## Rust oxipng comparison

Both versions use the same preset options, preserve metadata, and keep the
original file when an optimization does not improve its size.

| Preset | Rust oxipng 10.2.1 (four screenshots) | Original TS overhead | First-phase overhead | Current overhead |
| --- | ---: | ---: | ---: | ---: |
| `-o 2` | 2,473,423 B | 8.10% | 6.03% | 5.57% |
| `-o 4` | 2,452,721 B | 7.47% | 3.24% | 2.82% |

On the 13-file corpus, Rust produces 2,987,238 B at `-o 2` and 2,955,623 B at
`-o 4`; current TS overhead is 7.15% and 3.81%. Rust outputs pass the same
independent losslessness checks. Rust is a size reference in these API runs;
its CLI time is not mixed with the API measurements.

For current CLI times, process startup, Rust's default multithreading, and
Node/Porffor/ScriptC byte parity, see [REPORT.md](REPORT.md). Those CLI times
must not be compared directly with the in-process medians above. The `-o 4`
Rust size measurements are recorded in [rust-level4-results.json](rust-level4-results.json).

## Implementation and validation

Validation passed: 551 regression tests (including the Porffor runtime probe),
TypeScript type checking, the Node/browser build, and both native builds.
ScriptC compiled 3702 statements with zero failed or dynamic statements. All four
benchmark outputs are byte-for-byte identical across Node, Porffor, and ScriptC.

- Levels 7–9 use nearest three/four-byte prefixes plus an eight-byte hash chain
  to avoid traversing large sets of short-prefix matches.
- Levels 10–12 cache short/near/long match choices and find a low-cost
  literal/match path using dynamic programming. Up to three passes at levels
  10/11 or four at level 12 refine Huffman costs, retaining the best measured
  block cost. Parsing stops when the improvement is below 32/16/1 bits,
  respectively. The next pass reuses Huffman lengths already computed during
  block measurement, before unused-symbol completion modifies them.
  Long-match interiors are inserted without full searches.
- Block boundaries use 8 KiB byte-distribution observations. After at least
  16 KiB, L1 distance above 0.4 ends the block before the changed observation.
  Stable regions merge up to 65,535 bytes, retaining the stored-block fallback
  for incompressible input. The match window remains continuous between blocks.
- Length costs are precomputed, and near/far distance ranges are scanned
  separately. Encoding and exact size-only trials share the parser and block
  selection. Scratch storage is bounded, adding approximately 1.75 MiB of
  reusable buffers independent of input size, about 0.63 MiB more than the
  first phase's 32 KiB block cache.
- Regression coverage independently inflates streams with Node zlib, checks
  input immutability and deterministic reuse after rejected size limits, and
  exercises word mismatches, offset views, short tails, overlapping matches,
  block boundaries, and distances 32767/32768/32769. Lower-level reference
  fingerprints remain intact; high-level tests permit deliberate parse changes.

This remains a dependency-free TypeScript encoder, with different match choices,
block splitting, and parsing from Rust's libdeflate. These samples are a
focused regression corpus; the measurements do not establish parity or a
universal speedup. The parsing approach is informed by
[libdeflate's compression implementation](https://github.com/ebiggers/libdeflate/blob/master/lib/deflate_compress.c).

Reproduction commands are in [README.md](README.md#in-process-beforeafter-measurements).
