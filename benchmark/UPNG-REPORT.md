# oxipng-ts presets vs UPNG.js

Generated: 2026-10-11T07:30:45.931Z

- oxipng-ts 0.1.0, CLI; presets passed as `-o 0` through `-o 3`.
- upng-js 2.1.0, lossless encoding with `cnum=0`; source metadata is not preserved.
- Best of 3 runs after 1 warmup runs; fresh Node process per measurement, including startup, read, encode and write.
- PNG dimensions and decoded pixels are checked for every result outside the timed interval.

## Results

| File | Input | -o 0 size / time | -o 1 size / time | -o 2 size / time | -o 3 size / time | UPNG size / time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| IMG_5112.PNG | 1220437 B | 872135 B / 281.8 ms | 848910 B / 535.0 ms | 846944 B / 910.2 ms | 841490 B / 1802.5 ms | 1017290 B / 392.4 ms |
| Image Capture.png | 757550 B | 620073 B / 312.7 ms | 600060 B / 544.5 ms | 596603 B / 964.0 ms | 595257 B / 1801.9 ms | 644109 B / 418.5 ms |
| Qjiao.png | 827230 B | 656854 B / 376.3 ms | 632220 B / 767.4 ms | 615570 B / 1377.0 ms | 615138 B / 2515.0 ms | 695269 B / 587.5 ms |
| Siri AI.png | 811487 B | 650346 B / 375.7 ms | 626697 B / 742.6 ms | 614713 B / 1368.7 ms | 605497 B / 2407.8 ms | 657515 B / 584.4 ms |
| **Total** | **3616704 B** | **2799408 B / 1346.5 ms (-7.13%)** | **2707887 B / 2589.6 ms (-10.16%)** | **2673830 B / 4619.8 ms (-11.29%)** | **2657382 B / 8527.3 ms (-11.84%)** | **3014183 B / 1982.8 ms** |

Size percentage is relative to UPNG.js; negative means smaller. oxipng-ts retains the input PNG format and can preserve metadata, while UPNG.js decodes and re-encodes pixels.
