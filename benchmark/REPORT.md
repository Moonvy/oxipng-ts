# oxipng-ts benchmark

Generated: 2026-10-11T05:49:19.589Z

- Native: **oxipng 10.2.1** (`oxipng`, startup ≈ 3.2 ms)
- oxipng-ts: **oxipng-ts@0.1.0** CLI (`node dist/cli.js`, startup ≈ 39.5 ms)
- oxipng-ts-porffor: **oxipng-ts 0.1.0** CLI (`/Users/sxcc/四喜茶茶文件/个人文件/AI/Oxipng-ts/oxipng-ts/dist/oxipng-ts-porffor`, startup ≈ 3.7 ms)
- oxipng-ts-scriptc: **oxipng-ts 0.1.0** CLI (`/Users/sxcc/四喜茶茶文件/个人文件/AI/Oxipng-ts/oxipng-ts/dist/oxipng-ts-scriptc`, startup ≈ 4.1 ms; compiler 0.2.8, mode: static (LLVM, no JavaScript engine))
- Host: darwin/arm64, Apple M1, Node v24.21.0
- Options: `-o 2` applied identically to all four tools
- Timing: best of 1 runs (0 warmup), CLI vs CLI (process startup included for all four)
- Input directory: `benchmark/sample` (4 files)

## Output size

| File | Input (B) | Rust (B) | Node (B) | Porffor (B) | ScriptC (B) | TS − Rust (B) | All TS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| IMG_5112.PNG | 1220437 | 808313 | 846944 | 846944 | 846944 | +38631 (4.78%) | identical |
| Image Capture.png | 757550 | 551303 | 596603 | 596603 | 596603 | +45300 (8.22%) | identical |
| Qjiao.png | 827230 | 554704 | 615570 | 615570 | 615570 | +60866 (10.97%) | identical |
| Siri AI.png | 811487 | 559103 | 614713 | 614713 | 614713 | +55610 (9.95%) | identical |
| **Total** | **3616704** | **2473423** | **2673830** | **2673830** | **2673830** | **+200407 (8.10%)** | **identical** |

## CLI time

Ratios show elapsed time relative to the denominator; lower is faster.

| File | Rust | Node | Porffor | ScriptC | Node / Rust | Porffor / Node | ScriptC / Node |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IMG_5112.PNG | 655.7 ms | 874.5 ms | 5419.5 ms | 4282.0 ms | 1.33× | 6.20× | 4.90× |
| Image Capture.png | 759.5 ms | 925.1 ms | 5627.2 ms | 4542.6 ms | 1.22× | 6.08× | 4.91× |
| Qjiao.png | 1009.2 ms | 1378.3 ms | 8385.8 ms | 6556.6 ms | 1.37× | 6.08× | 4.76× |
| Siri AI.png | 912.7 ms | 1294.0 ms | 8251.7 ms | 6316.8 ms | 1.42× | 6.38× | 4.88× |
| **Total** | **3337.0 ms** | **4471.9 ms** | **27684.2 ms** | **21697.9 ms** | **1.34×** | **6.19×** | **4.85×** |

## Summary

- **Output size:** oxipng-ts produced **108.10%** of native oxipng's total — 8.10% larger (+200407 bytes over 4 files).
- **Porffor parity:** all 4 outputs are byte-for-byte identical to Node output. This check is outside the timed region; the benchmark fails on a mismatch.
- **ScriptC parity:** all 4 outputs are byte-for-byte identical to Node output, checked outside the timed region.
- **Time (CLI vs CLI):** Rust 3337.0 ms, Node 4471.9 ms, Porffor 27684.2 ms. Porffor took **6.19×** Node's time and **8.30×** Rust's time.
- **ScriptC time:** 21697.9 ms, **4.85×** Node's time and **6.50×** Rust's time.

## Caveats

- oxipng-ts uses its own built-in pure-JavaScript DEFLATE encoder (LZ77 + lazy matching + dynamic Huffman) rather than libdeflate in Node, Porffor, and ScriptC builds; the TS − Rust column quantifies that gap per file.
- All tools start a fresh process per file. Startup floors: Rust 3.2 ms, Node 39.5 ms, Porffor 3.7 ms, ScriptC 4.1 ms. Reported file times include startup; it is not subtracted.
- Node, Porffor, and ScriptC execute the same TypeScript optimization core synchronously on one thread. Rust oxipng uses its default thread count (logical CPU count); this benchmark does not force `--threads 1`.
- The default ScriptC build compiles the CLI and compression core statically through LLVM without a JavaScript engine. Its build gates require zero failed/dynamic statements and no dynamic-engine references in LLVM output. External binary build metadata is shown above when available.
- All tools receive the same `-o` preset and identical semantics (no `--force`, so a file that cannot be improved is written unchanged).
