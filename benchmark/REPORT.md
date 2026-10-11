# oxipng-ts benchmark

Generated: 2026-10-11T06:46:05.647Z

- Native: **oxipng 10.2.1** (`oxipng`, startup ≈ 3.3 ms)
- oxipng-ts: **oxipng-ts@0.1.0** CLI (`node dist/cli.js`, startup ≈ 39.4 ms)
- oxipng-ts-porffor: **oxipng-ts 0.1.0** CLI (`/Users/sxcc/四喜茶茶文件/个人文件/AI/Oxipng-ts/oxipng-ts/dist/oxipng-ts-porffor`, startup ≈ 3.1 ms)
- oxipng-ts-scriptc: **oxipng-ts 0.1.0** CLI (`/Users/sxcc/四喜茶茶文件/个人文件/AI/Oxipng-ts/oxipng-ts/dist/oxipng-ts-scriptc`, startup ≈ 4.4 ms; compiler 0.2.8, mode: static (LLVM, no JavaScript engine))
- Host: darwin/arm64, Apple M1, Node v24.21.0
- Options: `-o 2` applied identically to all four tools
- Timing: best of 3 runs (1 warmup), CLI vs CLI (process startup included for all four)
- Input directory: `benchmark/sample` (4 files)

## Output size

| File | Input (B) | Rust (B) | Node (B) | Porffor (B) | ScriptC (B) | TS − Rust (B) | All TS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| IMG_5112.PNG | 1220437 | 808313 | 842167 | 842167 | 842167 | +33854 (4.19%) | identical |
| Image Capture.png | 757550 | 551303 | 582197 | 582197 | 582197 | +30894 (5.60%) | identical |
| Qjiao.png | 827230 | 554704 | 596266 | 596266 | 596266 | +41562 (7.49%) | identical |
| Siri AI.png | 811487 | 559103 | 590521 | 590521 | 590521 | +31418 (5.62%) | identical |
| **Total** | **3616704** | **2473423** | **2611151** | **2611151** | **2611151** | **+137728 (5.57%)** | **identical** |

## CLI time

Ratios show elapsed time relative to the denominator; lower is faster.

| File | Rust | Node | Porffor | ScriptC | Node / Rust | Porffor / Node | ScriptC / Node |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IMG_5112.PNG | 656.4 ms | 851.6 ms | 4615.3 ms | 4552.0 ms | 1.30× | 5.42× | 5.35× |
| Image Capture.png | 750.7 ms | 958.1 ms | 5010.2 ms | 4815.6 ms | 1.28× | 5.23× | 5.03× |
| Qjiao.png | 1001.4 ms | 1151.0 ms | 6296.7 ms | 5878.4 ms | 1.15× | 5.47× | 5.11× |
| Siri AI.png | 882.9 ms | 1149.7 ms | 6136.1 ms | 5802.5 ms | 1.30× | 5.34× | 5.05× |
| **Total** | **3291.4 ms** | **4110.3 ms** | **22058.3 ms** | **21048.6 ms** | **1.25×** | **5.37×** | **5.12×** |

## Summary

- **Output size:** oxipng-ts produced **105.57%** of native oxipng's total — 5.57% larger (+137728 bytes over 4 files).
- **Porffor parity:** all 4 outputs are byte-for-byte identical to Node output. This check is outside the timed region; the benchmark fails on a mismatch.
- **ScriptC parity:** all 4 outputs are byte-for-byte identical to Node output, checked outside the timed region.
- **Time (CLI vs CLI):** Rust 3291.4 ms, Node 4110.3 ms, Porffor 22058.3 ms. Porffor took **5.37×** Node's time and **6.70×** Rust's time.
- **ScriptC time:** 21048.6 ms, **5.12×** Node's time and **6.40×** Rust's time.

## Caveats

- oxipng-ts uses its own built-in pure-JavaScript DEFLATE encoder (LZ77 + cost-based parsing + dynamic Huffman) rather than libdeflate in Node, Porffor, and ScriptC builds; the TS − Rust column quantifies that gap per file.
- All tools start a fresh process per file. Startup floors: Rust 3.3 ms, Node 39.4 ms, Porffor 3.1 ms, ScriptC 4.4 ms. Reported file times include startup; it is not subtracted.
- Node, Porffor, and ScriptC execute the same TypeScript optimization core synchronously on one thread. Rust oxipng uses its default thread count (logical CPU count); this benchmark does not force `--threads 1`.
- The default ScriptC build compiles the CLI and compression core statically through LLVM without a JavaScript engine. Its build gates require zero failed/dynamic statements and no dynamic-engine references in LLVM output. External binary build metadata is shown above when available.
- All tools receive the same `-o` preset and identical semantics (no `--force`, so a file that cannot be improved is written unchanged).
