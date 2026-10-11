# 默认 `-o 2`：匹配内部插入预算

本轮以当前默认 `-o 2`（含上一轮滤镜评分与解析预算）为基线，要求检查集中每张图的最终 PNG 输出增幅不超过 2%。有效匹配搜索仍使用深度 64，仅减少被跳过的长匹配内部位置的树维护搜索。

## 最终策略

- 仅 `fastOptimal && level === 11` 启用，默认 `Options`、预设 2 和 CLI `-o 2` 自动生效。显式 `--zc 11`、`libdeflater(11)` 和其他预设保持原输出。
- 每个块复用已有字节直方图：若一个字节占至少 87.5%，或出现频率至少 1/1024 的字节种类不超过 16，内部插入保留深度 64；其余块使用深度 24。
- 所有位置仍插入哈希和匹配树，保留窗口、块尾、缓存满处理。滤镜、匹配搜索深度、解析轮数、低熵解析保护和精确输出上限沿用原行为。
- 不增加公共 API、CLI 参数或运行时依赖；浏览器、同步 API 和 Node CLI 共用实现。

## 参数筛选

基线 CPU profile（Game、Web、Icon0、icon-small2）中，`insertTree` 占约 41.8% 的采样时间，`cacheMatches` 占约 13.4%。这用于定位热点，不作为提速结果。

先测试内部深度 48、32、16、8。统一降深度使渐变退步；深度 8 的 Icon2 也超过 2%。只保护高占比字节仍无法保护转成索引色的形状图，因此补充常见字节种类保护。保护后的深度 16 在部分索引色夹具增大 2.11%，淘汰；深度 32 通过，但更慢。补测中间值 24 后，175 张有效夹具全部满足限制。

五轮扩展集复测中，深度 24 比深度 32 的总中位数耗时少约 3.59%，八图少约 4.23%，超过预定的 2% 近似同速阈值，因此选择 24。所有单张大图均未出现超过 5% 的耗时退步。

## 五轮 API 复测

Apple M1，darwin/arm64，Node v24.21.0。相同 esbuild 配置的临时 API bundle，预热一次、测量五次，轮换并交替候选顺序；逐图取中位数后求和。像素与输出一致性检查在计时之外。参数筛选 bundle 的输出指纹均已与实际生产构建核对。

| 范围 | 基线 | 深度 24 | 耗时减少 | 总输出 | 体积增幅 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 八张主样本 | 15.120 s | 13.203 s | 12.68% | 7,382,525 → 7,395,281 B | 0.173% |
| 主样本＋九张扩展图 | 18.324 s | 16.356 s | 10.74% | 7,922,695 → 7,935,891 B | 0.167% |

| 图片 | 原输出 B | 新输出 B | 增幅 | 原耗时 ms | 新耗时 ms | 耗时减少 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Anime.png | 831,762 | 833,135 | 0.17% | 971.9 | 898.4 | 7.57% |
| Game.png | 3,861,490 | 3,868,075 | 0.17% | 6864.1 | 5441.6 | 20.72% |
| Icon0.png | 580,339 | 580,339 | 0.00% | 1334.8 | 1332.7 | 0.16% |
| Icon1.png | 571,901 | 572,382 | 0.08% | 1249.2 | 1222.6 | 2.13% |
| Icon2.png | 579,562 | 579,562 | 0.00% | 1405.0 | 1411.9 | -0.49% |
| Web.png | 909,096 | 913,112 | 0.44% | 2989.3 | 2613.6 | 12.57% |
| icon-samll.png | 6,373 | 6,376 | 0.05% | 20.4 | 16.5 | 19.09% |
| icon-small2.png | 42,002 | 42,300 | 0.71% | 285.7 | 265.3 | 7.12% |
| generated/gradient.png | 24,141 | 24,141 | 0.00% | 859.2 | 857.7 | 0.18% |
| generated/shapes.png | 3,966 | 3,966 | 0.00% | 190.7 | 190.8 | -0.06% |
| generated/photo.png | 222,579 | 222,579 | 0.00% | 456.3 | 451.9 | 0.98% |
| fixture/palette_8_should_be_palette_8.png | 30,688 | 30,796 | 0.35% | 135.7 | 123.3 | 9.14% |
| fixture/rgb_trns_8_should_be_palette_8.png | 30,688 | 30,796 | 0.35% | 124.1 | 114.7 | 7.59% |
| fixture/rgba_16_should_be_rgba_16.png | 82,292 | 82,404 | 0.14% | 708.3 | 701.3 | 0.98% |
| fixture/interlaced_rgba_16_should_be_rgba_16.png | 82,292 | 82,404 | 0.14% | 711.6 | 700.4 | 1.57% |
| fixture/small_files.png | 89 | 89 | 0.00% | 0.3 | 0.2 | 16.02% |
| fixture/apng_file.png | 63,435 | 63,435 | 0.00% | 17.4 | 12.7 | 27.04% |

## 体积、无损与回归检查

- 全部 175 张有效 PNG 夹具满足单图 2% 限制；最大增幅 1.65%（`fixture/interlaced_palette_8_should_be_palette_8.png`，13,865 → 14,094 B）。原始 CRC 损坏的 `corrupted_header.png`、`fix_errors.png` 单独记录为跳过。夹具扫描的单轮时间不作为稳定速度证据。
- 独立 pngjs 解码检查全部像素、完整 16 位精度、APNG 每帧像素与控制信息。五轮输出逐字节一致。
- 构建后执行 192 次 PNG 检查（175 个夹具＋17 图扩展集，部分重复），所有输出 SHA-256 与筛选候选完全一致；另外核对预设 0、1、3–6 和显式等级 11 的七项基线兼容检查。
- 新增渐变与低色数形状输出指纹保护，以及匹配内部插入跨窗口／块尾、短尾、非零数组偏移、输入不变、尺寸试算与精确上限、其他等级预算隔离测试。
- `npm run build:ts` 和 `npm run typecheck` 通过。ScriptC 原生重建成功：3908 个语句、0 失败、0 动态。Porffor 编译器未安装，对应原生 CLI 和运行时测试跳过，源码适配测试通过。
- 完整 `npm test`：547 项通过、32 项跳过、2 项失败。两项失败均来自未修改的 `test/site-benchmark.test.js`，其断言假定现有报告包含 Porffor/ScriptC 数据，而用户当前报告为 Rust/Node 最小报告；没有把全套描述为全部通过。

**2% 是上述检查集的实测限制，不是任意输入的运行时硬保证。** 不额外运行旧编码器；像素无损与原有输出上限持续有效。

## 构建后实际 CLI 复测

使用原 `benchmark:min` 口径：零预热、每图启动新进程三次，剔除最快值后平均其余两次，逐图求和。八图耗时包含进程启动与文件读写；启动值用 1×1 PNG 单独测三次取最快。基线和当前 CLI 顺序运行，API 交替复测仍是主要提速依据。

| 八图 CLI | 基线 | 当前 | 耗时减少 |
| --- | ---: | ---: | ---: |
| 逐图平均耗时之和 | 15.393 s | 13.826 s | 10.18% |
| 启动最快值 | 42.1 ms | 43.5 ms | — |
| 输出字节 | 7,382,525 B | 7,395,281 B | 增大 0.173% |

| 图片 | 基线 CLI ms | 当前 CLI ms | 新输出 B |
| --- | ---: | ---: | ---: |
| Anime.png | 1084.6 | 962.7 | 833,135 |
| Game.png | 6625.7 | 5367.9 | 3,868,075 |
| Icon0.png | 1386.8 | 1398.5 | 580,339 |
| Icon1.png | 1304.6 | 1295.3 | 572,382 |
| Icon2.png | 1516.4 | 1606.7 | 579,562 |
| Web.png | 2992.7 | 2720.6 | 913,112 |
| icon-samll.png | 98.8 | 103.0 | 6,376 |
| icon-small2.png | 383.8 | 371.3 | 42,300 |

Rust 同轮参考：总输出 7,080,182 B，耗时约 8.9 s，启动约 3.1 ms。
两组 CLI 的八图输出大小和 SHA-256 均与各自 API 数据完全相同；16 项 CLI 指纹核对保存在生产构建核对记录中。
- [基线 CLI 报告](o2-insertion-cli-before/REPORT.md)、[原始数据](o2-insertion-cli-before/results.json)
- [当前 CLI 报告](o2-insertion-cli-current/REPORT.md)、[原始数据](o2-insertion-cli-current/results.json)

```sh
# 先在修改前保存完整 dist/js 目录；传入真实绝对路径，避免 /tmp 符号链接影响 CLI 入口判断。
node benchmark/run.mjs --minimal --runs 3 --warmup 0 --node-cli /absolute/path/to/saved/js/cli.js --output-dir benchmark/o2-insertion-cli-before
npm run benchmark:min -- --output-dir benchmark/o2-insertion-cli-current
```

## 复现与数据

```sh
node benchmark/tune.mjs --corpus extended --runs 5 --warmup 1 --candidates insertion-before,insertion-24-symbols16,insertion-32-symbols16 --output benchmark/o2-insertion-results.json
node benchmark/tune.mjs --corpus fixtures-all --runs 1 --warmup 0 --candidates insertion-before,insertion-24-symbols16 --output benchmark/o2-insertion-24-fixtures.json
npm run build:ts
npm run typecheck
npm test
```

- [五轮 API 记录](o2-insertion-results.json)、[深度 24 全夹具记录](o2-insertion-24-fixtures.json)、[生产构建核对](o2-insertion-production-verification.json)
- [固定深度初筛](o2-insertion-screen.json)、[字节占比保护初筛](o2-insertion-guard-screen.json)、[字节种类保护夹具筛选](o2-insertion-fixture-screen.json)
- 初始源码基线 bundle SHA-256：`0f2d2d8ca50780a4931fcaf38c9b6abd7f841c04059e48a26021130584705429`。生产构建 SHA-256 保存在核对记录中。
- 筛选报告中的 `budgetFailures` 保留淘汰原因，脚本在完成所有比较后以非零状态报告超限。最终复测和深度 24 夹具报告均无超限。
- 本轮新增基准脚本 `--node-cli PATH` 选项，用于保存的构建前后 CLI 比较；产品 CLI 参数不变。原有 `benchmark/REPORT.md`、`benchmark/results.json` 未覆盖。
