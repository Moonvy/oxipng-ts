# oxipng-ts benchmark

Generated: 2026-10-11T15:46:16.733Z

- Rust: **oxipng 10.2.1** (`oxipng`, startup ≈ 3.1 ms)
- Node: **oxipng-ts 0.1.0** (`/Users/sxcc/.vite-plus/js_runtime/node/24.21.0/bin/node /Users/sxcc/四喜茶茶文件/个人文件/AI/Oxipng-ts/oxipng-ts/dist/js/cli.js`, startup ≈ 43.5 ms)
- Host: darwin/arm64, Apple M1, Node v24.21.0
- Options: `-o 2` applied identically to all 2 tools
- Timing: 3 fresh processes per image, no warmup; discard the fastest run and average the remaining 2, with startup included
- Startup: best of 3 fresh processes compressing the 1×1 PNG at `test/files/fully_optimized.png`; no warmup
- Native builds: automatically discovered in `dist/bin`; explicit binary environment overrides take precedence
- Input directory: `benchmark/sample` (8 files)

## Output size

| File | Input (B) | Rust (B) | Node (B) | TS − Rust (B) | All TS bytes |
| --- | ---: | ---: | ---: | ---: | --- |
| Anime.png | 1220437 | 808313 | 833135 | +24822 (3.07%) | Node only |
| Game.png | 4107582 | 3683431 | 3868075 | +184644 (5.01%) | Node only |
| Icon0.png | 811487 | 559103 | 580339 | +21236 (3.80%) | Node only |
| Icon1.png | 757550 | 551303 | 572382 | +21079 (3.82%) | Node only |
| Icon2.png | 827230 | 554704 | 579562 | +24858 (4.48%) | Node only |
| Web.png | 1337550 | 878403 | 913112 | +34709 (3.95%) | Node only |
| icon-samll.png | 8563 | 6098 | 6376 | +278 (4.56%) | Node only |
| icon-small2.png | 78637 | 38827 | 42300 | +3473 (8.94%) | Node only |
| **Total** | 9149036 | 7080182 | 7395281 | +315099 (4.45%) | Node only |

## CLI time

Ratios compare summed elapsed time across all images; lower is faster.

| File | Rust | Node | Node / Rust |
| --- | ---: | ---: | ---: |
| Anime.png | 681.7 ms | 962.7 ms | 1.41× |
| Game.png | 4206.6 ms | 5367.9 ms | 1.28× |
| Icon0.png | 881.8 ms | 1398.5 ms | 1.59× |
| Icon1.png | 748.4 ms | 1295.3 ms | 1.73× |
| Icon2.png | 1003.0 ms | 1606.7 ms | 1.60× |
| Web.png | 1210.1 ms | 2720.6 ms | 2.25× |
| icon-samll.png | 15.0 ms | 103.0 ms | 6.87× |
| icon-small2.png | 150.0 ms | 371.3 ms | 2.48× |
| **Total** | 8896.5 ms | 13825.9 ms | 1.55× |

## Summary

- **Output size:** Node output is 104.45% of Rust (+315099 bytes).

## Caveats

- All TypeScript targets execute the same built-in DEFLATE core synchronously on one thread. Rust uses libdeflate and its default thread count; this benchmark does not force `--threads 1`.
- Each file starts a fresh process. Startup is reported separately and is not subtracted from file times.
- All tools receive the same preset without `--force`; inputs that cannot be improved are written unchanged.
- Only available native builds are measured. Missing builds are omitted, and explicitly configured binaries must run successfully.
- Compiler version and mode come from adjacent `.build.json` files when available; external binaries without metadata are reported as unknown.
