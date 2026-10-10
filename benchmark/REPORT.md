# oxipng-ts benchmark

Generated: 2026-10-10T14:08:45.927Z

- Native: **oxipng 10.2.1** (`oxipng`, startup ≈ 3.4 ms)
- oxipng-ts: **oxipng-ts@0.1.0** CLI (`node dist/cli.js`, startup ≈ 31.1 ms)
- Options: `-o 2` applied identically to both
- Timing: best of 5 runs (1 warmup), CLI vs CLI (process startup included for both)
- Input directory: `benchmark/sample` (4 files)

## Results

| File | Input | oxipng (B) | oxipng-ts (B) | Δ size | oxipng | oxipng-ts | speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IMG_5112.PNG | 1220437 | 808313 | 846944 | +38631 (4.78%) | 557.9 ms | 851.7 ms | 1.53× |
| Image Capture.png | 757550 | 551303 | 596603 | +45300 (8.22%) | 625.0 ms | 956.4 ms | 1.53× |
| Qjiao.png | 827230 | 554704 | 615570 | +60866 (10.97%) | 836.5 ms | 1362.9 ms | 1.63× |
| Siri AI.png | 811487 | 559103 | 614713 | +55610 (9.95%) | 736.1 ms | 1336.3 ms | 1.82× |
| **Total** | **3616704** | **2473423** | **2673830** | **+200407 (8.10%)** | **2755.5 ms** | **4507.2 ms** | **1.64×** |

## Summary

- **Output size:** oxipng-ts produced **108.10%** of native oxipng's total — 8.10% larger (+200407 bytes over 4 files).
- **Time (CLI vs CLI):** native 2755.5 ms vs oxipng-ts 4507.2 ms — oxipng-ts took **1.64×** as long.

## Caveats

- oxipng-ts uses its own built-in pure-JavaScript DEFLATE encoder (LZ77 + lazy matching + dynamic Huffman) rather than libdeflate, so its compressed output is somewhat larger; the Δ size column quantifies that gap per file.
- Both tools start a fresh process per file; oxipng-ts is Node, so its per-file time includes Node startup (31.1 ms) versus native startup (3.4 ms).
- oxipng-ts uses a synchronous encoder on one thread. Native oxipng uses its default thread count (logical CPU count); this benchmark does not force `--threads 1`.
- Both tools receive the same `-o` preset and identical semantics (no `--force`, so a file that cannot be improved is written unchanged).
