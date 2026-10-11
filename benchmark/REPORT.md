# oxipng-ts benchmark

Generated: 2026-10-11T15:04:30.796Z

- Rust: **oxipng 10.2.1** (`oxipng`, startup ≈ 5.5 ms)
- Node: **oxipng-ts 0.1.0** (`/usr/local/bin/node /Users/yarna/Project/Test/oxipng-ts/dist/js/cli.js`, startup ≈ 39.6 ms)
- Host: darwin/arm64, Apple M3 Pro, Node v26.7.0
- Options: `-o 2` applied identically to all 2 tools
- Timing: 3 fresh processes per image, no warmup; discard the fastest run and average the remaining 2, with startup included
- Startup: best of 3 fresh processes compressing the 1×1 PNG at `test/files/fully_optimized.png`; no warmup
- Native builds: automatically discovered in `dist/bin`; explicit binary environment overrides take precedence
- Input directory: `benchmark/sample` (8 files)

## Output size

| File | Input (B) | Rust (B) | Node (B) | TS − Rust (B) | All TS bytes |
| --- | ---: | ---: | ---: | ---: | --- |
| Anime.png | 1220437 | 808313 | 831762 | +23449 (2.90%) | Node only |
| Game.png | 4107582 | 3683431 | 3861490 | +178059 (4.83%) | Node only |
| Icon0.png | 811487 | 559103 | 580339 | +21236 (3.80%) | Node only |
| Icon1.png | 757550 | 551303 | 571901 | +20598 (3.74%) | Node only |
| Icon2.png | 827230 | 554704 | 579562 | +24858 (4.48%) | Node only |
| Web.png | 1337550 | 878403 | 909096 | +30693 (3.49%) | Node only |
| icon-samll.png | 8563 | 6098 | 6373 | +275 (4.51%) | Node only |
| icon-small2.png | 78637 | 38827 | 42002 | +3175 (8.18%) | Node only |
| **Total** | 9149036 | 7080182 | 7382525 | +302343 (4.27%) | Node only |

## CLI time

Per-file columns show measured elapsed time. The Total row sums each engine's per-image times; ratios compare those summed elapsed times, so longer-running images contribute more.

| File | Rust | Node | Node / Rust |
| --- | ---: | ---: | ---: |
| Anime.png | 581.2 ms | 911.3 ms | 1.57× |
| Game.png | 3676.6 ms | 6204.0 ms | 1.69× |
| Icon0.png | 782.7 ms | 1243.7 ms | 1.59× |
| Icon1.png | 671.3 ms | 1188.8 ms | 1.77× |
| Icon2.png | 895.7 ms | 1373.9 ms | 1.53× |
| Web.png | 1070.2 ms | 2770.6 ms | 2.59× |
| icon-samll.png | 16.2 ms | 95.2 ms | 5.87× |
| icon-small2.png | 135.4 ms | 360.5 ms | 2.66× |
| **Total** | 7829.4 ms | 14148.0 ms | 1.81× |

## Summary

- **Output size:** Node output is 104.27% of Rust (+302343 bytes).

## Caveats

- All TypeScript targets execute the same built-in DEFLATE core synchronously on one thread. Rust uses libdeflate and its default thread count; this benchmark does not force `--threads 1`.
- Each file starts a fresh process. Startup is reported separately and is not subtracted from file times.
- All tools receive the same preset without `--force`; inputs that cannot be improved are written unchanged.
- Only available native builds are measured. Missing builds are omitted, and explicitly configured binaries must run successfully.
- Compiler version and mode come from adjacent `.build.json` files when available; external binaries without metadata are reported as unknown.
