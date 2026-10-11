# oxipng-ts benchmark

Generated: 2026-10-11T10:46:56.836Z

- Native: **oxipng 10.2.1** (`oxipng`, startup ≈ 3.3 ms)
- oxipng-ts: **oxipng-ts@0.1.0** CLI (`node dist/cli.js`, startup ≈ 38.2 ms)
- oxipng-ts-porffor: **oxipng-ts 0.1.0** CLI (`/Users/sxcc/四喜茶茶文件/个人文件/AI/Oxipng-ts/oxipng-ts/dist/oxipng-ts-porffor`, startup ≈ 3.8 ms)
- oxipng-ts-scriptc: **oxipng-ts 0.1.0** CLI (`/Users/sxcc/四喜茶茶文件/个人文件/AI/Oxipng-ts/oxipng-ts/dist/oxipng-ts-scriptc`, startup ≈ 4.3 ms; compiler 0.2.8, mode: static (LLVM, no JavaScript engine))
- Host: darwin/arm64, Apple M1, Node v24.21.0
- Options: `-o 2` applied identically to all four tools
- Timing: best of 1 runs (0 warmup), CLI vs CLI (process startup included for all four)
- Input directory: `benchmark/sample` (4 files)

## Output size

| File | Input (B) | Rust (B) | Node (B) | Porffor (B) | ScriptC (B) | TS − Rust (B) | All TS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| IMG_5112.PNG | 1220437 | 808313 | 817288 | 817288 | 817288 | +8975 (1.11%) | identical |
| Image Capture.png | 757550 | 551303 | 558294 | 558294 | 558294 | +6991 (1.27%) | identical |
| Qjiao.png | 827230 | 554704 | 562538 | 562538 | 562538 | +7834 (1.41%) | identical |
| Siri AI.png | 811487 | 559103 | 563067 | 563067 | 563067 | +3964 (0.71%) | identical |
| **Total** | **3616704** | **2473423** | **2501187** | **2501187** | **2501187** | **+27764 (1.12%)** | **identical** |

## CLI time

Ratios show elapsed time relative to the denominator; lower is faster.

| File | Rust | Node | Porffor | ScriptC | Node / Rust | Porffor / Node | ScriptC / Node |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IMG_5112.PNG | 657.6 ms | 1474.1 ms | 8381.9 ms | 6511.2 ms | 2.24× | 5.69× | 4.42× |
| Image Capture.png | 774.4 ms | 1815.0 ms | 10504.2 ms | 7804.2 ms | 2.34× | 5.79× | 4.30× |
| Qjiao.png | 1066.7 ms | 2215.2 ms | 13045.4 ms | 9568.6 ms | 2.08× | 5.89× | 4.32× |
| Siri AI.png | 887.5 ms | 2074.1 ms | 12137.3 ms | 8967.5 ms | 2.34× | 5.85× | 4.32× |
| **Total** | **3386.2 ms** | **7578.4 ms** | **44068.8 ms** | **32851.5 ms** | **2.24×** | **5.82×** | **4.33×** |

## Summary

- **Output size:** oxipng-ts produced **101.12%** of native oxipng's total — 1.12% larger (+27764 bytes over 4 files).
- **Porffor parity:** all 4 outputs are byte-for-byte identical to Node output. This check is outside the timed region; the benchmark fails on a mismatch.
- **ScriptC parity:** all 4 outputs are byte-for-byte identical to Node output, checked outside the timed region.
- **Time (CLI vs CLI):** Rust 3386.2 ms, Node 7578.4 ms, Porffor 44068.8 ms. Porffor took **5.82×** Node's time and **13.01×** Rust's time.
- **ScriptC time:** 32851.5 ms, **4.33×** Node's time and **9.70×** Rust's time.

## Caveats

- oxipng-ts uses its own built-in pure-JavaScript DEFLATE encoder (LZ77 + cost-based parsing + dynamic Huffman) rather than libdeflate in Node, Porffor, and ScriptC builds; the TS − Rust column quantifies that gap per file.
- All tools start a fresh process per file. Startup floors: Rust 3.3 ms, Node 38.2 ms, Porffor 3.8 ms, ScriptC 4.3 ms. Reported file times include startup; it is not subtracted.
- Node, Porffor, and ScriptC execute the same TypeScript optimization core synchronously on one thread. Rust oxipng uses its default thread count (logical CPU count); this benchmark does not force `--threads 1`.
- The default ScriptC build compiles the CLI and compression core statically through LLVM without a JavaScript engine. Its build gates require zero failed/dynamic statements and no dynamic-engine references in LLVM output. External binary build metadata is shown above when available.
- All tools receive the same `-o` preset and identical semantics (no `--force`, so a file that cannot be improved is written unchanged).
