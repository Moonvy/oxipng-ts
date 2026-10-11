# oxipng-ts benchmark

Generated: 2026-10-11T16:32:22.288Z

- Rust: **oxipng 10.2.1** (`oxipng`, startup ≈ 4.5 ms)
- Node: **oxipng-ts 0.1.0** (`/usr/local/bin/node /Users/yarna/Project/Test/oxipng-ts/dist/js/cli.js`, startup ≈ 37.2 ms)
- Porffor: **oxipng-ts 0.1.0** (`/Users/yarna/Project/Test/oxipng-ts/dist/bin/oxipng-ts-porffor`, startup ≈ 3.2 ms; compiler unknown, mode: unknown (external binary))
- ScriptC: **oxipng-ts 0.1.0** (`/Users/yarna/Project/Test/oxipng-ts/dist/bin/oxipng-ts-scriptc`, startup ≈ 3.8 ms; compiler 0.2.8, mode: static (LLVM, no JavaScript engine))
- Host: darwin/arm64, Apple M3 Pro, Node v26.7.0
- Options: `-o 2` applied identically to all 4 tools
- Timing: 3 fresh processes per image, no warmup; discard the fastest run and average the remaining 2, with startup included
- Startup: best of 3 fresh processes compressing the 1×1 PNG at `test/files/fully_optimized.png`; no warmup
- Native builds: automatically discovered in `dist/bin`; explicit binary environment overrides take precedence
- Input directory: `benchmark/sample` (8 files)

## Output size

| File | Input (B) | Rust (B) | Node (B) | Porffor (B) | ScriptC (B) | TS − Rust (B) | All TS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Anime.png | 1220437 | 808313 | 833135 | 833135 | 833135 | +24822 (3.07%) | identical |
| Game.png | 1666457 | 1383200 | 1427779 | 1427779 | 1427779 | +44579 (3.22%) | identical |
| Icon0.png | 811487 | 559103 | 580339 | 580339 | 580339 | +21236 (3.80%) | identical |
| Icon1.png | 757550 | 551303 | 572382 | 572382 | 572382 | +21079 (3.82%) | identical |
| Icon2.png | 827230 | 554704 | 579562 | 579562 | 579562 | +24858 (4.48%) | identical |
| Web.png | 1337550 | 878403 | 913112 | 913112 | 913112 | +34709 (3.95%) | identical |
| icon-samll.png | 8563 | 6098 | 6376 | 6376 | 6376 | +278 (4.56%) | identical |
| icon-small2.png | 78637 | 38827 | 42300 | 42300 | 42300 | +3473 (8.94%) | identical |
| **Total** | 6707911 | 4779951 | 4954985 | 4954985 | 4954985 | +175034 (3.66%) | identical |

## CLI time

Ratios compare summed elapsed time across all images; lower is faster.

| File | Rust | Node | Porffor | ScriptC | Node / Rust | Porffor / Node | ScriptC / Node |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Anime.png | 570.0 ms | 817.5 ms | 4404.2 ms | 3168.0 ms | 1.43× | 5.39× | 3.88× |
| Game.png | 847.5 ms | 1246.2 ms | 6634.6 ms | 4673.1 ms | 1.47× | 5.32× | 3.75× |
| Icon0.png | 744.6 ms | 1154.7 ms | 6529.4 ms | 4174.6 ms | 1.55× | 5.65× | 3.62× |
| Icon1.png | 634.6 ms | 1077.3 ms | 5609.1 ms | 3833.0 ms | 1.70× | 5.21× | 3.56× |
| Icon2.png | 850.4 ms | 1214.6 ms | 7094.7 ms | 4430.1 ms | 1.43× | 5.84× | 3.65× |
| Web.png | 940.6 ms | 2258.0 ms | 11292.8 ms | 8147.8 ms | 2.40× | 5.00× | 3.61× |
| icon-samll.png | 14.4 ms | 79.4 ms | 73.0 ms | 56.2 ms | 5.52× | 0.92× | 0.71× |
| icon-small2.png | 126.2 ms | 313.7 ms | 1192.4 ms | 773.6 ms | 2.49× | 3.80× | 2.47× |
| **Total** | 4728.2 ms | 8161.3 ms | 42830.0 ms | 29256.5 ms | 1.73× | 5.25× | 3.58× |

## Summary

- **Output size:** Node output is 103.66% of Rust (+175034 bytes).
- **Porffor parity:** all 8 outputs are byte-for-byte identical to Node, checked outside the timed region; the benchmark fails on a mismatch.
- **Porffor time:** 42830.0 ms, **5.25×** Node and **9.06×** Rust.
- **ScriptC parity:** all 8 outputs are byte-for-byte identical to Node, checked outside the timed region; the benchmark fails on a mismatch.
- **ScriptC time:** 29256.5 ms, **3.58×** Node and **6.19×** Rust.

## Caveats

- All TypeScript targets execute the same built-in DEFLATE core synchronously on one thread. Rust uses libdeflate and its default thread count; this benchmark does not force `--threads 1`.
- Each file starts a fresh process. Startup is reported separately and is not subtracted from file times.
- All tools receive the same preset without `--force`; inputs that cannot be improved are written unchanged.
- Only available native builds are measured. Missing builds are omitted, and explicitly configured binaries must run successfully.
- Compiler version and mode come from adjacent `.build.json` files when available; external binaries without metadata are reported as unknown.
