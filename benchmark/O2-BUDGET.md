# 默认 `-o 2`：5% 体积预算优化

已将新的解析预算应用到默认 `Options`、`Options.fromPreset(2)` 和 CLI `-o 2`。本轮以修改前的默认 `-o 2`（已含上一轮滤镜评分优化）为体积基准，要求检查集中**每张图片**增幅不超过 5%。

## 参数选择

- 保留 NONE、SUB、Entropy、Bigrams 四种滤镜，以及等级 11 的匹配搜索深度 64。
- 每个块先测贪心解析的实际编码位数；如果不少于原块字节数（压缩体积约为原数据的 1/8 或以上），仅做一轮 Huffman 成本解析。
- 高度重复、压缩率很高的数据块保留三轮，保护渐变、小图和低熵内容。每轮仍在实际编码结果更小时才采纳。
- 颜色／位深／调色板转换的评分模型保持原预算；其他预设不启用新解析预算。尺寸试算和最终输出使用相同预算，仍执行原输出大小上限。
- CLI 显式 `--zc 11`、API `libdeflater(11)` 保留三轮；`libdeflater(11, true)` 启用预算。

初筛尝试深度 64／0 轮、64／1 轮、32／1 轮和按符号分布选择深度。零轮体积退步明显；深度 32 使生成渐变图增大 36.72%、形状图增大 10.51%。按分布选择深度没有明显额外速度收益。最终保留深度 64，加上低熵块三轮保护。初筛单轮时间只用于排除方案。

## 三轮复测

Apple M3 Pro，Node v26.7.0，2026-10-11。相同构建选项的同步 API，每种方案预热一次、测量三次；按轮次轮换执行顺序，使用各图中位数之和。PNG 校验在计时之外，不含 CLI 启动。

| 范围 | 修改前 | 修改后 | 耗时减少 | 总体积 | 体积增幅 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 原四张图片（现已重命名） | 5.466 s | 4.442 s | 18.73% | 2,501,187 → 2,563,564 B | 2.49% |
| 当前八张主样本 | 15.483 s | 13.614 s | 12.07% | 7,215,141 → 7,382,525 B | 2.32% |
| 主样本＋额外九图 | 18.639 s | 16.567 s | 11.12% | 7,749,050 → 7,922,695 B | 2.24% |

样本目录在本轮变为八张图片：Anime、Game、Icon0–2、Web 和两张小图。历史七图报告不能直接与本轮汇总相减。额外九图包含生成渐变／形状／plasma、索引色、透明色、16 位、交错、小图和 APNG；`generated/photo.png` 实际是生成的 plasma 图。

| 图片 | 原输出 B | 新输出 B | 体积增幅 | 原耗时 ms | 新耗时 ms | 耗时减少 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Anime.png | 817,288 | 831,762 | 1.77% | 1047.6 | 890.9 | 14.97% |
| Game.png | 3,768,706 | 3,861,490 | 2.46% | 6919.2 | 6106.7 | 11.74% |
| Icon0.png | 563,067 | 580,339 | 3.07% | 1596.2 | 1246.3 | 21.92% |
| Icon1.png | 558,294 | 571,901 | 2.44% | 1309.8 | 1079.0 | 17.62% |
| Icon2.png | 562,538 | 579,562 | 3.03% | 1512.1 | 1225.6 | 18.94% |
| Web.png | 897,822 | 909,096 | 1.26% | 2782.1 | 2758.3 | 0.86% |
| icon-samll.png | 6,291 | 6,373 | 1.30% | 22.0 | 20.6 | 5.99% |
| icon-small2.png | 41,135 | 42,002 | 2.11% | 293.9 | 286.8 | 2.43% |
| generated/gradient.png | 24,141 | 24,141 | 0.00% | 774.0 | 776.9 | -0.38% |
| generated/shapes.png | 3,966 | 3,966 | 0.00% | 174.4 | 180.7 | -3.57% |
| generated/photo.png | 218,698 | 222,579 | 1.77% | 566.1 | 414.8 | 26.72% |
| fixture/palette_8_should_be_palette_8.png | 30,176 | 30,688 | 1.70% | 151.6 | 132.0 | 12.89% |
| fixture/rgb_trns_8_should_be_palette_8.png | 30,176 | 30,688 | 1.70% | 126.0 | 115.5 | 8.35% |
| fixture/rgba_16_should_be_rgba_16.png | 82,148 | 82,292 | 0.18% | 660.1 | 672.1 | -1.82% |
| fixture/interlaced_rgba_16_should_be_rgba_16.png | 82,148 | 82,292 | 0.18% | 650.2 | 645.7 | 0.68% |
| fixture/small_files.png | 89 | 89 | 0.00% | 0.2 | 0.2 | 11.73% |
| fixture/apng_file.png | 62,367 | 63,435 | 1.71% | 53.3 | 14.5 | 72.77% |

## 体积与无损检查

- 17 张复测图单图最大增幅 3.07%；另外扫描 `test/files` 全部 PNG，175 张有效夹具单图最大增幅 4.31%（`fixture/interlaced_rgba_8_should_be_grayscale_alpha_8.png`，86,583 → 90,316 B）。全部低于 5%。
- 夹具扫描跳过两张原输入已损坏的图片：`corrupted_header.png`、`fix_errors.png`，原因保存在 JSON。
- 独立 pngjs 解码逐像素比较；16 位保留完整精度，APNG 检查每帧像素、帧控制、帧数及循环参数。三轮输出也逐字节一致。
- 渐变图、形状图、89 B 小图、1,924 B 调色板夹具和 31,683 B RGBA 夹具仍保持原输出体积。
- 部分高度可压缩图片没有速度收益，几毫秒波动不作为改善依据。

**5% 是上述检查集的实测限制，未对任意新图片提供硬性保证。** 要强制相对旧编码结果不超过 5%，必须额外运行旧编码器并比较，这会抵消此次减少解析的速度收益。像素无损和原有输出大小限制仍然有效。

## 构建后 CLI 复测

每张图启动新 Node 进程，包含启动、文件读写；零预热、每图三次，按每图中位数求和。两个参数组顺序运行，因此 CPU 状态漂移可能影响差值；API 的轮换复测是主要速度依据。

| 当前八图 | 修改前 `-o 2 --zc 11` | 修改后 `-o 2` | 耗时减少 |
| --- | ---: | ---: | ---: |
| 中位数之和 | 16.449 s | 13.726 s | 16.55% |
| 最快值之和 | 15.233 s | 13.488 s | 11.46% |

八图输出 7,215,141 → 7,382,525 B，增幅 2.32%。两个参数组的 CLI 输出均与各自 API 复测的 SHA-256 完全一致。
[CLI 三轮原始记录](o2-budget-cli.json)。

## 构建与回归验证

- `npm run build:ts`、`npm run typecheck` 通过。
- 新增四项预算测试：预设隔离／配置比较、无损与精确大小上限、低熵块保留三轮、空与短数据。
- `npm test -- --exclude test/site-benchmark.test.js` 中 552 项通过、4 项跳过，12 项原生 CLI 对照因旧二进制失败。重新构建 ScriptC、Porffor 后，两个原生 CLI 套件及 Porffor 适配套件共 62 项全部通过。
- `site-benchmark.test.js` 沿用此前排除：已有页面断言失败及当前沙箱监听端口 EPERM，与压缩参数无关；没有将全套测试描述为全部通过。
- 原生重建同时更新了 Porffor 的字读取检查数量（17 → 20）：上一轮独立树插入增加了三处有边界保护的读取，仍统一经过检查过的原生读取函数。

## 复现与数据

```sh
node benchmark/tune.mjs --corpus extended --runs 3 --warmup 1 --candidates budget-before,budget-current --output benchmark/o2-budget-results.json
node benchmark/tune.mjs --corpus fixtures-all --runs 1 --warmup 0 --candidates budget-before,budget-current --output benchmark/o2-budget-fixtures.json
npm run build:ts
node benchmark/presets.mjs --runs 3 --profiles budget-before,budget-current --output benchmark/o2-budget-cli.json
```

- 复测脚本在 `budget-before` / `budget-current` 配对运行时逐图检查 5% 上限，超出即失败。
- [三轮 API 明细](o2-budget-results.json)
- [175 张夹具明细](o2-budget-fixtures.json)
- [固定深度初筛](o2-budget-screen.json)、[按分布选择深度初筛](o2-budget-adaptive-screen.json)
- [上一轮滤镜评分优化](DEFAULT-O2.md)、[0–6 预设历史对比](PRESETS.md)
