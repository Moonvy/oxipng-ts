# oxipng-ts benchmark

Generated: 2026-10-11T07:27:33.084Z

- Native: **oxipng 10.2.1** (`oxipng`, startup ≈ 4.3 ms)
- oxipng-ts: **oxipng-ts@0.1.0** CLI (`node dist/cli.js`, startup ≈ 34.7 ms)
- Options: `-o 2` applied identically to both
- Timing: best of 1 runs (0 warmup), CLI vs CLI (process startup included for both)
- Input directory: `benchmark/sample` (4 files)

## Results

| File | Input | oxipng (B) | oxipng-ts (B) | Δ size | oxipng | oxipng-ts | speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IMG_5112.PNG | 1220437 | 808313 | 846944 | +38631 (4.78%) | 567.9 ms | 857.0 ms | 1.51× |
| Image Capture.png | 757550 | 551303 | 596603 | +45300 (8.22%) | 629.5 ms | 955.7 ms | 1.52× |
| Qjiao.png | 827230 | 554704 | 615570 | +60866 (10.97%) | 842.3 ms | 1369.8 ms | 1.63× |
| Siri AI.png | 811487 | 559103 | 614713 | +55610 (9.95%) | 739.5 ms | 1331.8 ms | 1.80× |
| **Total** | **3616704** | **2473423** | **2673830** | **+200407 (8.10%)** | **2779.2 ms** | **4514.3 ms** | **1.62×** |

## Summary

- **Output size:** oxipng-ts produced **108.10%** of native oxipng's total — 8.10% larger (+200407 bytes over 4 files).
- **Time (CLI vs CLI):** native 2779.2 ms vs oxipng-ts 4514.3 ms — oxipng-ts took **1.62×** as long.

## Caveats

- oxipng-ts uses its own built-in pure-JavaScript DEFLATE encoder (LZ77 + lazy matching + dynamic Huffman) rather than libdeflate, so its compressed output is somewhat larger; the Δ size column quantifies that gap per file.
- Both tools start a fresh process per file; oxipng-ts is Node, so its per-file time includes Node startup (34.7 ms) versus native startup (4.3 ms).
- oxipng-ts uses a synchronous encoder on one thread. Native oxipng uses its default thread count (logical CPU count); this benchmark does not force `--threads 1`.
- Both tools receive the same `-o` preset and identical semantics (no `--force`, so a file that cannot be improved is written unchanged).
