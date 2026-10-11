import { normalizeBenchmark, raceMetrics, formatBytes, formatSeconds } from './benchmark-data.js';

const $ = id => document.getElementById(id);
const panel = $('racePanel');
const lanes = $('raceLanes');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let data = null;
let request = 0;
let running = !reducedMotion.matches;
let inView = true;
let trackObserver = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setRunning() {
  panel.classList.toggle('is-running', running && inView && !document.hidden);
}

function selected() {
  return data.rows.find(row => row.id === $('benchmarkFile').value) ?? data.all;
}

function renderRace(row) {
  trackObserver?.disconnect();
  const metrics = raceMetrics(row.engines);
  const slowestMs = Math.max(...metrics.map(engine => engine.ms));
  const fragment = document.createDocumentFragment();
  for (const engine of metrics) {
    const lane = element('div', 'race-lane');
    lane.style.setProperty('--engine-color', engine.color);
    lane.style.setProperty('--duration', `${engine.durationMs}ms`);
    lane.style.setProperty('--time-width', `${engine.ms / slowestMs * 100}%`);
    const heading = element('div', 'lane-heading');
    const name = element('span', 'lane-name');
    name.append(element('i', 'lane-mark'), element('span', '', engine.label));
    heading.append(name, element('small', '', `${formatSeconds(engine.ms)} · ${engine.rate.toFixed(2)}× 速率`));
    const track = element('div', 'race-track');
    track.setAttribute('aria-hidden', 'true');
    track.append(element('span', 'race-ball'));
    lane.append(heading, track);
    fragment.append(lane);
  }
  lanes.replaceChildren(fragment);
  const updateTravel = () => {
    for (const track of lanes.querySelectorAll('.race-track')) {
      track.style.setProperty('--travel', `${Math.max(0, track.clientWidth - 42)}px`);
    }
  };
  updateTravel();
  trackObserver = new ResizeObserver(updateTravel);
  for (const track of lanes.querySelectorAll('.race-track')) trackObserver.observe(track);
  $('raceSelection').textContent = `${row.name} · 最快为 1.00×`;
  $('racePreset').textContent = `PRESET ${data.options.opt}`;
  setRunning();
}

function scaleMaximum(value) {
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const factor = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(n => n >= normalized) ?? 10;
  return factor * power;
}

function formatRatio(ratio) {
  return `${ratio.toFixed(ratio < 10 ? 2 : 1)}×`;
}

function renderRatioChart(container, measured, valueOf, formatActual) {
  const values = measured.map(valueOf).filter(value => Number.isFinite(value) && value > 0);
  const best = values.length ? Math.min(...values) : 0;
  const max = scaleMaximum(values.length ? Math.max(...values) : 1);
  const fragment = document.createDocumentFragment();
  for (const engine of measured) {
    const value = valueOf(engine);
    const ratio = Number.isFinite(value) && value > 0 && best > 0 ? value / best : null;
    const chartRow = element('div', `chart-row${engine.id === 'input' ? ' input-row' : ''}`);
    chartRow.style.setProperty('--engine-color', engine.color);
    const label = element('div', 'chart-row-label');
    const labelCopy = element('span', 'chart-label-copy');
    labelCopy.append(element('span', 'chart-engine-name', engine.label));
    label.append(element('i', 'legend-swatch'), labelCopy);
    const rail = element('div', 'chart-rail');
    if (ratio !== null) {
      const bar = element('div', 'chart-bar');
      const barWidth = value / max;
      bar.style.setProperty('--bar-width', `${barWidth * 100}%`);
      const actual = element(
        'span',
        `chart-actual${barWidth > 0.5 ? ' chart-actual-before' : ''}`,
        formatActual(value),
      );
      bar.append(
        element('span', 'chart-bar-fill'),
        actual,
      );
      rail.append(bar);
    }
    chartRow.append(
      label,
      rail,
      element('div', 'chart-value', ratio === null ? '—' : formatRatio(ratio)),
    );
    if (ratio !== null) chartRow.title = `${engine.label}：${formatActual(value)} · ${formatRatio(ratio)}`;
    fragment.append(chartRow);
  }
  const axis = element('div', 'chart-axis');
  const ticks = element('div', 'axis-ticks');
  for (let i = 0; i <= 2; i++) {
    const tick = max * i / 2;
    ticks.append(element('span', '', formatActual(tick)));
  }
  axis.append(element('span'), ticks, element('span'));
  fragment.append(axis);
  container.replaceChildren(fragment);
}

function renderChart(container, row, kind) {
  if (kind === 'time') {
    container.setAttribute('aria-label', '各实现实际压缩耗时与相对最快项倍率');
    $('timeUnit').textContent = '秒';
    renderRatioChart(
      container,
      row.engines,
      engine => engine.ms,
      formatSeconds,
    );
    return;
  }
  const measured = [
    { label: '原始输入', id: 'input', color: '#d9ddcf', bytes: row.inputBytes }, ...row.engines,
  ];
  renderRatioChart(container, measured, engine => engine.bytes, formatBytes);
}

function renderStartupChart(startups) {
  renderRatioChart(
    $('startupChart'),
    startups,
    engine => engine.startupMs,
    value => `${value.toFixed(value < 10 ? 2 : 1)} ms`,
  );
}

function renderSelection() {
  const row = selected();
  renderRace(row);
  renderChart($('timeChart'), row, 'time');
  renderChart($('sizeChart'), row, 'size');
  const node = row.engines.find(engine => engine.id === 'node');
  const rust = row.engines.find(engine => engine.id === 'rust');
  const extra = (node.bytes / rust.bytes - 1) * 100;
  const ratio = node.ms / rust.ms;
  const insight = $('benchmarkInsight');
  const copy = element('p');
  copy.append(document.createTextNode(`${row.name}：Node 输出比原始输入减少 `),
    element('strong', '', `${((1 - node.bytes / row.inputBytes) * 100).toFixed(1)}%`),
    document.createTextNode(`；体积比 Rust ${extra >= 0 ? '大' : '小'} ${Math.abs(extra).toFixed(2)}%，${row.id === 'all' ? '总耗时' : '耗时'}为 Rust 的 ${ratio.toFixed(2)}×。`));
  insight.replaceChildren(element('span', 'insight-icon', '↗'), copy);
}

function renderData(next) {
  const oldSelection = data ? selected().name : null;
  data = next;
  const select = $('benchmarkFile');
  select.replaceChildren();
  for (const row of [data.all, ...data.rows]) {
    const option = element('option', '', row.name);
    option.value = row.id;
    select.append(option);
  }
  select.value = data.rows.find(row => row.name === oldSelection)?.id ?? 'all';
  select.disabled = false;
  const node = data.all.engines.find(engine => engine.id === 'node');
  const rust = data.all.engines.find(engine => engine.id === 'rust');
  const sizeDifference = (node.bytes / rust.bytes - 1) * 100;
  const timeRatio = node.ms / rust.ms;
  $('heroTimeRatio').textContent = `${timeRatio.toFixed(2)}×`;
  $('heroTimeRatio').title = `${data.all.name}：Node.js ${formatSeconds(node.ms)} / Rust oxipng ${formatSeconds(rust.ms)}`;
  $('heroSizeDifference').textContent = `${sizeDifference > 0 ? '+' : ''}${sizeDifference.toFixed(2)}%`;
  $('heroSizeDifference').title = `${data.all.name}：Node.js ${node.bytes.toLocaleString('zh-CN')} 字节 / Rust oxipng ${rust.bytes.toLocaleString('zh-CN')} 字节`;
  const env = data.environment;
  $('benchmarkContext').textContent = `${env.cpu} / ${env.platform}${env.arch ? ` ${env.arch}` : ''} · ${env.node ? `Node ${env.node} · ` : ''}${data.rows.length} PNG · -o ${data.options.opt}`;
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(data.generatedAt));
  $('benchmarkDate').textContent = `实测更新 ${date} (UTC+8)`;
  const builds = data.all.engines.filter(engine => engine.id !== 'rust').map(engine => engine.label).join('、');
  const imageTiming = data.options.timeAggregation === 'drop-fastest-mean'
    ? `每张图片无预热测量 ${data.options.runs} 次，剔除耗时最低的一次，平均其余 ${data.options.runs - 1} 次。`
    : `每张图片预热 ${data.options.warmup} 次，正式测量 ${data.options.runs} 次，取其中最快的一次。`;
  const startupMethod = Number.isInteger(data.options.startupRuns)
    ? `启动时间另以 1×1 PNG 压缩 ${data.options.startupRuns} 次，取最快值。`
    : '启动时间来自旧版 --version 测量。';
  $('benchmarkMethod').textContent = `${data.versions.rust}；TypeScript 构建：${builds}。${imageTiming}全部样本的耗时为各图片单文件结果之和，计入进程启动；单张图片显示实际耗时，均使用 -o ${data.options.opt} 预设。${startupMethod}`;
  renderStartupChart(data.startups);
  renderSelection();
}

async function refreshData() {
  const id = ++request;
  const button = $('benchmarkRefresh');
  button.disabled = true;
  $('benchmarkStatus').textContent = '';
  try {
    const response = await fetch('./benchmark/results.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`数据读取失败（HTTP ${response.status}）`);
    const next = normalizeBenchmark(await response.json());
    if (id !== request) return;
    renderData(next);
  } catch (error) {
    if (id !== request) return;
    $('benchmarkStatus').textContent = `${error.message}。${data ? '暂时显示上次读取的结果，可再次刷新。' : '请生成网站数据后刷新，或查看测量报告。'}`;
    if (!data) lanes.replaceChildren(element('p', 'loading-note', '暂时无法读取实测数据'));
  } finally {
    if (id === request) button.disabled = false;
  }
}

$('benchmarkFile').addEventListener('change', renderSelection);
$('benchmarkRefresh').addEventListener('click', refreshData);
reducedMotion.addEventListener('change', () => { running = !reducedMotion.matches; setRunning(); });
document.addEventListener('visibilitychange', setRunning);
new IntersectionObserver(entries => { inView = entries[0].isIntersecting; setRunning(); }, { threshold: 0 }).observe(panel);
setRunning();
refreshData();
