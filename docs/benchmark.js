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
  $('raceToggle').textContent = running ? '暂停动画' : '播放动画';
  $('raceToggle').setAttribute('aria-pressed', String(running));
}

function selected() {
  return data.rows.find(row => row.id === $('benchmarkFile').value) ?? data.all;
}

function renderRace(row) {
  trackObserver?.disconnect();
  const metrics = raceMetrics(row.engines, Number($('raceSpeed').value));
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
  $('raceToggle').disabled = false;
  $('raceReset').disabled = false;
  setRunning();
}

function scaleMaximum(value) {
  const power = 10 ** Math.floor(Math.log10(value));
  const normalized = value / power;
  const factor = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(n => n >= normalized) ?? 10;
  return factor * power;
}

function renderChart(container, row, kind) {
  const isTime = kind === 'time';
  const measured = isTime ? row.engines : [
    { label: '原始输入', id: 'input', color: '#d9ddcf', bytes: row.inputBytes }, ...row.engines,
  ];
  const valueOf = engine => isTime ? engine.ms / 1000 : engine.bytes / 1048576;
  const max = scaleMaximum(Math.max(...measured.map(valueOf)));
  const fragment = document.createDocumentFragment();
  for (const engine of measured) {
    const chartRow = element('div', `chart-row${engine.id === 'input' ? ' input-row' : ''}`);
    chartRow.style.setProperty('--engine-color', engine.color);
    const label = element('div', 'chart-row-label');
    label.append(element('i', 'legend-swatch'), element('span', '', engine.label));
    const rail = element('div', 'chart-rail');
    rail.setAttribute('aria-hidden', 'true');
    const bar = element('div', 'chart-bar');
    bar.style.setProperty('--bar-width', `${valueOf(engine) / max * 100}%`);
    rail.append(bar);
    const value = element('div', 'chart-value', valueOf(engine).toFixed(isTime && engine.ms < 10 ? 3 : 2));
    value.append(element('small', '', isTime ? ' s' : ' MiB'));
    chartRow.title = `${engine.label}：${isTime ? formatSeconds(engine.ms) : `${engine.bytes.toLocaleString('zh-CN')} 字节`}`;
    chartRow.append(label, rail, value);
    fragment.append(chartRow);
  }
  const axis = element('div', 'chart-axis');
  const ticks = element('div', 'axis-ticks');
  for (let i = 0; i <= 4; i++) {
    const n = max * i / 4;
    ticks.append(element('span', '', n.toLocaleString('zh-CN', { maximumFractionDigits: max < 0.01 ? 4 : 2 })));
  }
  axis.append(element('span'), ticks, element('span'));
  fragment.append(axis);
  container.replaceChildren(fragment);
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
    document.createTextNode(`；体积比 Rust ${extra >= 0 ? '大' : '小'} ${Math.abs(extra).toFixed(2)}%，耗时为 Rust 的 ${ratio.toFixed(2)}×。`));
  insight.replaceChildren(element('span', 'insight-icon', '↗'), copy);
  $('sizeCaption').textContent = `原始输入 ${formatBytes(row.inputBytes)}。`;
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
  $('heroTimeRatio').textContent = `${(node.ms / rust.ms).toFixed(2)}×`;
  $('heroTimeRatio').title = `${data.all.name}：Node.js ${formatSeconds(node.ms)} / Rust oxipng ${formatSeconds(rust.ms)}`;
  $('heroSizeDifference').textContent = `${sizeDifference > 0 ? '+' : ''}${sizeDifference.toFixed(2)}%`;
  $('heroSizeDifference').title = `${data.all.name}：Node.js ${node.bytes.toLocaleString('zh-CN')} 字节 / Rust oxipng ${rust.bytes.toLocaleString('zh-CN')} 字节`;
  const env = data.environment;
  $('benchmarkContext').textContent = `${env.cpu} / ${env.platform}${env.arch ? ` ${env.arch}` : ''} · ${env.node ? `Node ${env.node} · ` : ''}${data.rows.length} PNG · -o ${data.options.opt}`;
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(data.generatedAt));
  $('benchmarkDate').textContent = `实测更新 ${date} (UTC+8)`;
  const builds = data.all.engines.filter(engine => engine.id !== 'rust').map(engine => engine.label).join('、');
  $('benchmarkMethod').textContent = `${data.versions.rust}；TypeScript 构建：${builds}。每张图片预热 ${data.options.warmup} 次，正式测量 ${data.options.runs} 次，取其中最快的一次。全部样本的耗时为这些单文件结果之和，计入进程启动；均使用 -o ${data.options.opt} 预设。`;
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
$('raceToggle').addEventListener('click', () => { running = !running; setRunning(); });
$('raceReset').addEventListener('click', () => { if (data) renderRace(selected()); });
$('raceSpeed').addEventListener('change', () => { if (data) renderRace(selected()); });
reducedMotion.addEventListener('change', () => { running = !reducedMotion.matches; setRunning(); });
document.addEventListener('visibilitychange', setRunning);
new IntersectionObserver(entries => { inView = entries[0].isIntersecting; setRunning(); }, { threshold: 0 }).observe(panel);
setRunning();
refreshData();
