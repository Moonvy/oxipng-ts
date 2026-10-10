# 优化验证报告（第一轮）

第二轮结果见 [OPTIMIZATION-ROUND2.md](./OPTIMIZATION-ROUND2.md)。以下保留第一轮测量记录。

日期：2026-10-10（Asia/Taipei）。基线是上一轮计划保存的优化前构建，已复制到 `benchmark/baseline/dist/`，避免依赖临时目录。

## 已完成的改动

- 批次 1：保留并完成 DEFLATE 的共享 Huffman scratch、位反转表、合并 bit writes、zlib 单缓冲和 Adler-32 展开循环。修复 lazy lookahead 重复插入同一位置造成哈希链自环的问题；缓存前瞻匹配时保持基线的插入顺序。
- 批次 2：输出写入时执行 maxSize 熔断；把内部熔断转换为公开的 `PngError/DeflatedDataTooLong`；初始输出分配受限于尺寸上限。将 PLTE/tRNS 开销从候选压缩上限中扣除，仍允许尺寸相同的候选参与原有排序。保存胜出候选的过滤数据供最终压缩复用，检查 optimizeAlpha 兼容性。head 使用 generation 标记避免每次清空整张表，并处理 generation 回绕。
- 批次 3：过滤/反过滤热循环中内联 Paeth；Entropy evaluator 复用直方图。关闭透明像素改写时直接读取原始行，省去行复制与 bestRaw 快照；按需分配启发式 scratch；返回独占过滤缓冲的有效视图，避免最终整图复制。开启透明像素改写时保留所需的可写副本。

head 的 generation 标签增加约 128 KiB 常驻 scratch；过滤缓存只保留胜出候选，最终压缩取用后释放引用。透明像素改写路径仍使用副本，以保持输入不可变。

## 验证

| 阶段 | 构建/类型检查 | 测试 |
| --- | --- | --- |
| 批次 1（修正后） | 通过 | 358/358 |
| 批次 2 | 通过 | 362/362 |
| 批次 3 | 通过 | 362/362 |
| 最终（新增管线回归检查） | 通过 | 368/368，10 个测试文件 |

新增回归检查覆盖：精确尺寸上限、raw/zlib 熔断错误、熔断后的 scratch 复用、非零 byteOffset、跨 32 KiB 窗口和 256 KiB 块、候选包含 palette 开销的尺寸相等边界、过滤缓存与 optimizeAlpha 兼容性、Adam7/16 位过滤后原始数据不变。

`node benchmark/deflate-parity.mjs` 检查了全部 0–12 压缩级别的 130 个 raw/zlib 流；全部与优化前基线逐字节相同，并通过 Node zlib 独立解压。

`benchmark/compare.mjs` 在预设 2、6 上对四张真实样本分别检查输入与两个构建输出的 PNG 像素，解码使用独立的 pngjs；任意像素差异或单文件尺寸增加都会失败。各批次原始结果保存在 `comparison-batch1.json`、`comparison-batch2.json`、`comparison-final.json`。

## 复现

```sh
npm run build
npm run typecheck
npm test
node benchmark/deflate-parity.mjs
node benchmark/compare.mjs --label final --runs 3
node benchmark/compare.mjs --label isolated --presets 2 --runs 3
node benchmark/filters.mjs
node benchmark/run.mjs --opt 2 --runs 5 --warmup 1
```

构建同时更新了浏览器站点的 bundle。API benchmark 在同一 Node 进程内交替运行两个构建，使用一次 warmup 和三次测量的中位数；CLI benchmark 包括进程启动，使用五次测量的最短值。两种计时不能直接混用。中间批次计时为探索性测量，存在其他验证进程同时运行；预设 2 另做了独立复测（`comparison-isolated.json`），下方主要性能结论采用该结果；预设 6 计时包含部分并行验证期间的测量，仅供参考。四个样本的结果不能代表所有 PNG 或所有硬件。

## 性能结果

以下耗时为每张图片中位数的总和，单位 ms。输出在所有批次均与基线逐字节一致。

| 构建 | 预设 | 基线耗时 | 优化后耗时 | 耗时减少 | 输出总字节 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 批次 1 | 2 | 7274.1 | 5242.0 | 27.9% | 2673830 |
| 批次 1 | 6 | 61917.7 | 43221.7 | 30.2% | 2628235 |
| 批次 2 | 2 | 7467.0 | 5393.5 | 27.8% | 2673830 |
| 批次 2 | 6 | 62558.2 | 44535.4 | 28.8% | 2628235 |
| 最终完整对比 | 2 | 7610.6 | 5586.1 | 26.6% | 2673830 |
| 最终完整对比 | 6 | 58395.4 | 41865.7 | 28.3% | 2628235 |
| 最终独立复测 | 2 | 6907.4 | 4950.3 | 28.3% | 2673830 |

预设 2 独立复测使用 1 次 warmup、3 次测量的中位数，四张图片全部通过 pngjs 像素比较。

| 图片 | 基线 ms | 优化后 ms | 耗时减少 | 输出字节（前后相同） |
| --- | ---: | ---: | ---: | ---: |
| IMG_5112.PNG | 1233.3 | 919.3 | 25.5% | 846944 |
| Image Capture.png | 1378.8 | 989.4 | 28.2% | 596603 |
| Qjiao.png | 2201.2 | 1551.3 | 29.5% | 615570 |
| Siri AI.png | 2094.1 | 1490.4 | 28.8% | 614713 |

过滤专项（Qjiao.png，关闭 optimizeAlpha，2 次 warmup、9 次测量的中位数；每个策略输出逐字节相同）：

| 策略 | 基线 ms | 优化后 ms | 耗时减少 |
| --- | ---: | ---: | ---: |
| PAETH | 17.17 | 12.10 | 29.5% |
| Entropy | 56.54 | 51.28 | 9.3% |
| Bigrams | 59.84 | 55.73 | 6.9% |

最终 CLI 对比（预设 2，5 次测量取最短值，1 次 warmup，包括启动）：native oxipng 总耗时 2700.1 ms，oxipng-ts 总耗时 5297.9 ms，后者为前者的 1.96 倍。TS 输出仍比 native 大 8.10%，这轮性能优化没有改变输出大小。native 使用默认线程数，TS 编码器同步运行；已修正旧报告“双方均为单线程”的不准确说明。详见 [REPORT.md](./REPORT.md) 与 [results.json](./results.json)。
