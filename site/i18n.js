// Shared translations for static content and dynamically rendered UI.
(() => {
  const translations = {
  "跳到主要内容": "Skip to main content",
  "oxipng-ts 首页": "oxipng-ts home",
  "主导航": "Main navigation",
  "性能实测": "Benchmarks",
  "本地压缩": "Local compression",
  "开始使用": "Get started",
  "PNG 无损压缩。": "Lossless PNG compression.",
  "TypeScript 实现。": "Built with TypeScript.",
  "将 oxipng 从 Rust 迁移到 TypeScript，支持浏览器和 Nodejs。并可编译为二进制文件。": "oxipng ported from Rust to TypeScript. Runs in browsers and Node.js, and compiles to native binaries.",
  "开始压缩": "Compress an image",
  "GitHub 仓库": "GitHub repository",
  "在 GitHub 打开 oxipng-ts 仓库": "Open the oxipng-ts repository on GitHub",
  "查看 benchmark": "View benchmarks",
  "Node.js 耗时 / Rust": "Node.js time / Rust",
  "Node.js 尺寸比 Rust": "Node.js size vs. Rust",
  "纯 TS": "Pure TS",
  "TypeScript 压缩核心": "TypeScript compression core",
  "核心代码 · gzip": "Core code · gzip",
  "PNG 压缩速度": "PNG compression speed",
  "速度对比": "Compression speed",
  "正在读取测量结果…": "Loading measurements…",
  "各实现的相对速度示意": "Relative speed of each implementation",
  "正在读取 benchmark…": "Loading benchmarks…",
  "产品特点": "Features",
  "无损压缩": "Lossless compression",
  "优化过滤、色深、调色板与 DEFLATE 编码。": "Optimizes filters, bit depth, palettes, and DEFLATE encoding.",
  "零运行时依赖": "Zero runtime dependencies",
  "无需 WASM 或原生插件。": "No WASM or native plugins required.",
  "性能测试": "Performance benchmarks",
  "各构建目标使用相同样本和压缩预设。": "All build targets use the same samples and compression preset.",
  "比较样本": "Sample",
  "全部样本": "All samples",
  "重新读取最新 benchmark 数据": "Reload the latest benchmark data",
  "刷新数据": "Refresh data",
  "正在加载实测环境…": "Loading benchmark environment…",
  "压缩耗时实际数值与相对最快项倍率": "Compression times and ratios relative to the fastest implementation",
  "各实现实际压缩耗时与相对最快项倍率": "Compression times and ratios relative to the fastest implementation",
  "输出尺寸实际数值与相对最小尺寸倍率": "Output sizes and ratios relative to the smallest output",
  "启动时间实际数值与相对最快项倍率": "Startup times and ratios relative to the fastest implementation",
  "压缩耗时": "Compression time",
  "输出文件尺寸": "Output size",
  "启动时间": "Startup time",
  "读取实测结果后显示": "Waiting for measurements",
  "毫秒": "ms",
  "秒": "s",
  "测量方法": "Methodology",
  "测量口径随 benchmark 数据一同更新。": "The methodology is updated with the benchmark data.",
  "Rust 使用默认线程数；TypeScript 的各构建目标使用同一套 TypeScript 压缩核心，单线程执行。文件无法进一步缩小时保留原始字节。这里比较的是完整 PNG 优化流程，不只是 DEFLATE 内核。": "Rust uses its default thread count. All TypeScript build targets share the same compression core and run on a single thread. Original bytes are retained when no further size reduction is possible. These benchmarks measure the full PNG optimization pipeline, including DEFLATE.",
  "结果取决于图片内容和运行环境。这组 CLI 实测不代表浏览器内的运行速度，也不与 API 基准计时混用。": "Results depend on image content and the runtime environment. These CLI measurements do not represent browser performance and are separate from API benchmarks.",
  "数据来源：benchmark": "Source: benchmarks",
  "原始 JSON": "Raw JSON",
  "完整测量报告": "Full benchmark report",
  "优化前后对比": "Optimization comparison",
  "选择 PNG / APNG，或使用样本。文件在浏览器中处理。": "Choose a PNG / APNG or try a sample. Files are processed in your browser.",
  "选择或拖入 PNG 图片": "Choose or drop a PNG image",
  "把 PNG 拖到这里": "Drop a PNG here",
  "选择文件": "choose a file",
  "或": "Or",
  " · 也支持粘贴图片": " · You can also paste an image",
  "样本": "Samples",
  "渐变": "Gradient",
  "透明图形": "Transparent shapes",
  "彩色纹理": "Color texture",
  "压缩预设": "Compression preset",
  "0 · 最快": "0 · Fastest",
  "1 · 轻量": "1 · Light",
  "2 · 默认": "2 · Default",
  "3 · 全部变换": "3 · All transforms",
  "4 · 更细致": "4 · Thorough",
  "5 · 深度优化": "5 · Deep optimization",
  "6 · 最大压缩": "6 · Maximum compression",
  "交错扫描": "Interlacing",
  "关闭": "Off",
  "保留原设置": "Keep original",
  "开启": "On",
  "优化完全透明像素": "Optimize fully transparent pixels",
  "移除非必要元数据": "Strip nonessential metadata",
  "透明像素优化可能改变不可见的 RGB 值；移除元数据会丢弃部分附加信息。高预设处理时间更长。": "Transparent pixel optimization may change invisible RGB values. Stripping metadata removes some additional information. Higher presets take longer.",
  "等待选择图片": "Waiting for an image",
  "压缩后可预览和下载。": "Preview and download after compression.",
  "原始尺寸": "Original size",
  "优化后": "Optimized",
  "减少体积": "Size saved",
  "本机耗时": "Local processing time",
  "优化前的图片": "Original image",
  "优化后的图片": "Optimized image",
  "原始": "Original",
  "拖动分界线比较优化前后的图片": "Drag the divider to compare the original and optimized images",
  "拖动查看优化前后。": "Drag to compare before and after.",
  "下载优化图片": "Download optimized image",
  "再试一张": "Try another image",
  "安装与调用": "Install and use",
  "支持 CLI、ESM 和 CJS。": "Supports CLI, ESM, and CJS.",
  "复制": "Copy",
  "已复制": "Copied",
  "# 优化单张图片": "# Optimize a single image",
  "# 批量优化，输出到指定目录": "# Optimize a batch and write to an output directory",
  "PNG / APNG 优化器": "PNG / APNG optimizer",
  "压缩失败": "Compression failed",
  "压缩工作线程出错": "Compression worker failed",
  "无法读取工作线程的压缩结果": "Could not read the compression worker result",
  "请选择 PNG 或 APNG 图片。": "Please choose a PNG or APNG image.",
  "当前文件类型：": "Current file type: ",
  "未知": "Unknown",
  "正在本地优化…": "Optimizing locally…",
  "取消压缩": "Cancel compression",
  "这张图片暂时无法优化。": "This image could not be optimized.",
  "未找到样本图片": "Sample image not found",
  "暂时无法加载样本。": "Could not load the sample.",
  "无需进一步压缩": "Already optimized",
  "选一张图片，继续轻装上路。": "Choose another image to compress.",
  "已取消压缩。": "Compression canceled.",
  "可以重新选择图片继续。": "Choose another image to continue.",
  "原始输入": "Original input",
  "速率": "speed",
  "最快为 1.00×": "Fastest = 1.00×",
  "实测更新": "Updated",
  " 字节": " bytes",
  "未记录 CPU": "CPU not recorded",
  "未记录系统": "OS not recorded",
  "暂时显示上次读取的结果，可再次刷新。": "Showing the previous results. Try refreshing again.",
  "请生成网站数据后刷新，或查看测量报告。": "Generate the site data and refresh, or view the benchmark report.",
  "暂时无法读取实测数据": "Benchmark data unavailable",
  "benchmark 缺少有效的样本或生成时间": "Benchmark samples or timestamp are invalid",
  "benchmark 测量选项无效": "Invalid benchmark options",
  "benchmark 样本名称无效": "Invalid benchmark sample name",
  "启动时间来自旧版 --version 测量。": "Startup time comes from legacy --version measurements."
};
  translations['oxipng-ts — PNG 无损压缩'] = 'oxipng-ts — Lossless PNG compression';
  translations['TypeScript PNG / APNG 优化器，支持本地压缩，提供 Rust、Node.js、Porffor 和 ScriptC 的 benchmark 对比。'] = 'A TypeScript PNG / APNG optimizer with local compression and benchmarks comparing Rust, Node.js, Porffor, and ScriptC.';
  const storageKey = 'oxipng-ts-language';
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch {}
  let language = ['zh', 'en'].includes(saved) ? saved
    : ((navigator.languages?.[0] || navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en');
  const ordered = Object.entries(translations).sort((a, b) => b[0].length - a[0].length);
  function english(source) {
    let text = source
      .replace(/全部 (\d+) 张图片/g, 'All $1 images')
      .replace(/原始 ([\d.]+ KiB)/g, 'Original $1')
      .replace(/数据读取失败（HTTP (\d+)）/g, 'Failed to load data (HTTP $1)')
      .replace(/benchmark 中的 (.+) 无效/g, 'Invalid benchmark value: $1')
      .replace(/(.+)：Node 输出比原始输入减少 /g, '$1: Node output is smaller than the original by ')
      .replace(/；体积比 Rust ([大小]) ([\d.]+)%，(总耗时|耗时)为 Rust 的 ([\d.]+)×。/g,
        (_, direction, size, time, ratio) => `; output is ${size}% ${direction === '大' ? 'larger' : 'smaller'} than Rust, and ${time === '总耗时' ? 'total time' : 'time'} is ${ratio}× Rust's.`)
      .replace(/每张图片无预热测量 (\d+) 次，剔除耗时最低的一次，平均其余 (\d+) 次。/g, '$1 runs per image without warmup; the fastest run is discarded and the remaining $2 runs are averaged. ')
      .replace(/每张图片预热 (\d+) 次，正式测量 (\d+) 次，取其中最快的一次。/g, '$1 warmup runs and $2 measured runs per image; the fastest measured run is used. ')
      .replace(/启动时间另以 1×1 PNG 压缩 (\d+) 次，取最快值。/g, 'Startup time is measured separately with $1 runs compressing a 1×1 PNG; the fastest run is used.')
      .replace(/；TypeScript 构建：/g, '; TypeScript builds: ')
      .replace(/全部样本的耗时为各图片单文件结果之和，计入进程启动；单张图片显示实际耗时，均使用 -o (\d) 预设。/g, 'Aggregate time is the sum of individual image runs, including process startup. Individual samples show measured time. All use preset -o $1. ');
    for (const [zh, en] of ordered) {
      // Single-character words are only translated as complete text nodes.
      if (zh.length === 1) { if (text.trim() === zh) text = text.replace(zh, en); }
      else text = text.split(zh).join(en);
    }
    return /[\u3400-\u9fff]/.test(text) ? text : text.replace(/：/g, ': ').replace(/、/g, ', ').replace(/。/g, '. ');
  }
  const records = new WeakMap();
  function update(target, key, value, write) {
    let record = records.get(target);
    if (!record) { record = {}; records.set(target, record); }
    const previous = record[key];
    const source = previous && value === previous.rendered ? previous.source : value;
    const rendered = language === 'en' ? english(source) : source;
    record[key] = { source, rendered };
    if (value !== rendered) write(rendered);
  }
  let observer;
  function apply() {
    observer?.disconnect();
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('script, style, #languageToggle')) continue;
      update(node, 'text', node.nodeValue, value => { node.nodeValue = value; });
    }
    for (const node of document.querySelectorAll('[aria-label], [alt], [title], meta[name="description"]')) {
      for (const attribute of ['aria-label', 'alt', 'title', 'content']) {
        if (!node.hasAttribute(attribute)) continue;
        update(node, attribute, node.getAttribute(attribute), value => node.setAttribute(attribute, value));
      }
    }
    const button = document.getElementById('languageToggle');
    button.textContent = language === 'en' ? '中文' : 'English';
    button.lang = language === 'en' ? 'zh-CN' : 'en';
    button.setAttribute('aria-label', language === 'en' ? '切换到中文' : 'Switch to English');
    observer?.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'alt', 'title', 'content'] });
  }
  window.siteI18n = { sourceText: node => Array.from(node.childNodes, child => child.nodeType === Node.TEXT_NODE ? (records.get(child)?.text?.source ?? child.textContent) : child.textContent).join(''), translate: text => language === 'en' ? english(text) : text, get language() { return language; } };
  document.getElementById('languageToggle').addEventListener('click', () => {
    language = language === 'en' ? 'zh' : 'en';
    try { localStorage.setItem(storageKey, language); } catch {}
    apply();
    document.dispatchEvent(new Event('languagechange'));
  });
  apply();
  observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'alt', 'title', 'content'] });
})();
