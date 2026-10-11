# oxipng-ts presets vs UPNG.js

Generated: 2026-10-11T17:08:20.665Z

- oxipng-ts 0.1.1, CLI; presets passed as `-o 0` through `-o 3`.
- upng-js 2.1.0, lossless encoding with `cnum=0`; source metadata is not preserved.
- Best of 5 runs after 1 warmup runs; fresh Node process per measurement, including startup, read, encode and write.
- PNG dimensions and decoded pixels are checked for every result outside the timed interval.

## Results

| File | Input | -o 0 size / time | -o 1 size / time | -o 2 size / time | -o 3 size / time | UPNG size / time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Anime.png | 1220437 B | 872135 B / 278.4 ms | 818115 B / 936.2 ms | 833135 B / 842.3 ms | 812309 B / 1901.5 ms | 1017290 B / 430.9 ms |
| Game.png | 1666457 B | 1470745 B / 392.2 ms | 1401819 B / 1405.6 ms | 1427779 B / 1283.2 ms | 1395749 B / 3008.4 ms | 1611154 B / 527.7 ms |
| Icon0.png | 811487 B | 650346 B / 367.5 ms | 572440 B / 1290.2 ms | 580339 B / 1211.1 ms | 553872 B / 2348.9 ms | 657515 B / 595.5 ms |
| Icon1.png | 757550 B | 620073 B / 310.9 ms | 559564 B / 1137.9 ms | 572382 B / 1102.7 ms | 557248 B / 2200.9 ms | 644109 B / 437.3 ms |
| Icon2.png | 827230 B | 656854 B / 367.2 ms | 576064 B / 1515.2 ms | 579562 B / 1275.5 ms | 562093 B / 2539.6 ms | 695269 B / 641.7 ms |
| Web.png | 1337550 B | 1016536 B / 637.4 ms | 903216 B / 1920.9 ms | 913112 B / 2405.9 ms | 892368 B / 4336.5 ms | 987771 B / 512.6 ms |
| icon-samll.png | 8563 B | 6381 B / 54.5 ms | 6313 B / 79.8 ms | 6376 B / 83.7 ms | 6291 B / 114.7 ms | 6101 B / 69.7 ms |
| icon-small2.png | 78637 B | 45891 B / 109.8 ms | 41634 B / 290.5 ms | 42300 B / 344.3 ms | 41135 B / 554.1 ms | 45946 B / 139.3 ms |
| **Total** | **6707911 B** | **5338961 B / 2517.8 ms (-5.76%)** | **4879165 B / 8576.2 ms (-13.87%)** | **4954985 B / 8548.6 ms (-12.54%)** | **4821065 B / 17004.7 ms (-14.90%)** | **5665155 B / 3354.6 ms** |

Size percentage is relative to UPNG.js; negative means smaller. oxipng-ts retains the input PNG format and can preserve metadata, while UPNG.js decodes and re-encodes pixels.
