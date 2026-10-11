import { parse, render } from 'sugar-high/core';
import * as shellLanguage from 'sugar-high/lang/shell';
import * as typescriptLanguage from 'sugar-high/lang/typescript';

const $ = (id) => document.getElementById(id);
const els = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  status: $('status'),
  results: $('results'),
  level: $('level'),
  interlace: $('interlace'),
  alpha: $('alpha'),
  strip: $('strip'),
  statOriginal: $('statOriginal'),
  statOptimized: $('statOptimized'),
  statSaved: $('statSaved'),
  statTime: $('statTime'),
  barFill: $('barFill'),
  compare: $('compare'),
  imgOriginal: $('imgOriginal'),
  imgOptimized: $('imgOptimized'),
  compareRange: $('compareRange'),
  download: $('download'),
  reset: $('reset'),
};

let currentRequest = 0;
let activeWorker = null;
let activeWorkerCancel = null;

const codeSources = new WeakMap();
const codeLanguages = { shell: shellLanguage, typescript: typescriptLanguage };
for (const code of document.querySelectorAll('.code-card code[data-lang]')) {
  codeSources.set(code, window.siteI18n.sourceText(code));
}
function highlightExamples() {
  for (const code of document.querySelectorAll('.code-card code[data-lang]')) {
    const language = codeLanguages[code.dataset.lang];
    if (!language) continue;
    const source = window.siteI18n.translate(codeSources.get(code));
    const previewSource = source.split('\n').filter(line => line.trim().length > 0).join('\n');
    code.innerHTML = render(parse(previewSource, language)).replace(/\n(?=<span class="sh__line)/g, '');
    code.classList.add('sh');
  }
}
highlightExamples();
document.addEventListener('languagechange', highlightExamples);

/* -------------------------------------------------------------- compression --- */

function cancelActiveCompression() {
  activeWorkerCancel?.();
}

function optimizeInWorker(buffer, params) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./compression.worker.js', import.meta.url), { type: 'module' });
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      if (activeWorkerCancel === cancel) activeWorkerCancel = null;
      callback(value);
    };
    const cancel = () => finish(resolve, null);

    activeWorker = worker;
    activeWorkerCancel = cancel;
    worker.onmessage = ({ data }) => {
      if (data?.type === 'result') finish(resolve, data);
      else if (data?.type === 'error') finish(reject, new Error(data.message || '压缩失败'));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(reject, new Error(event.message || '压缩工作线程出错'));
    };
    worker.onmessageerror = () => finish(reject, new Error('无法读取工作线程的压缩结果'));

    try {
      worker.postMessage({ type: 'optimize', buffer, params }, [buffer]);
    } catch (error) {
      finish(reject, error);
    }
  });
}

/* ------------------------------------------------------------------ utils --- */

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[i]}`;
}

function setStatus(html) {
  els.status.innerHTML = html;
  els.status.style.display = '';
  els.results.hidden = true;
}

function clearObjectUrls() {
  if (els.imgOriginal.src) URL.revokeObjectURL(els.imgOriginal.src);
  if (els.imgOptimized.src) URL.revokeObjectURL(els.imgOptimized.src);
  if (els.download.getAttribute('href')) URL.revokeObjectURL(els.download.href);
  els.download.removeAttribute('href');
  els.imgOptimized.onload = null;
}

function showError(message, detail = '') {
  setStatus('<p class="error"></p><p class="muted"></p>');
  els.status.children[0].textContent = message;
  els.status.children[1].textContent = detail;
}

/* -------------------------------------------------------------- optimize ---- */

function readParams() {
  return {
    level: els.level.value,
    interlace: els.interlace.value,
    alpha: els.alpha.checked,
    strip: els.strip.checked,
  };
}

async function handleFile(file, requestId = ++currentRequest) {
  if (!file) return;
  if (requestId !== currentRequest) return;
  cancelActiveCompression();
  const isPng = /\.(png|apng)$/i.test(file.name) || file.type === 'image/png' || file.type === 'image/apng';
  if (!isPng && file.type !== '') {
    showError('请选择 PNG 或 APNG 图片。', `当前文件类型：${file.type || '未知'}`);
    return;
  }

  const params = readParams();
  clearObjectUrls();
  const originalUrl = URL.createObjectURL(file);
  els.imgOriginal.src = originalUrl;
  els.imgOptimized.removeAttribute('src');

  setStatus('<div class="spinner"></div><p>正在本地优化…</p><button class="btn ghost cancel-compression" data-cancel-compression type="button">取消压缩</button>');

  try {
    const arrayBuffer = await file.arrayBuffer();
    if (requestId !== currentRequest) return;
    const result = await optimizeInWorker(arrayBuffer, params);
    if (requestId !== currentRequest) return;
    if (!result) return;
    const { output, timeMs, size } = result;
    const optimizedBlob = new Blob([output], { type: 'image/png' });
    const optimizedUrl = URL.createObjectURL(optimizedBlob);
    els.imgOptimized.src = optimizedUrl;
    els.imgOptimized.onload = () => {
      els.compareRange.value = 50;
      els.compare.style.setProperty('--pos', '50%');
    };

    renderResult(file, size, timeMs, optimizedBlob);
  } catch (err) {
    if (requestId !== currentRequest) return;
    showError('这张图片暂时无法优化。', err instanceof Error ? err.message : String(err));
  }
}

async function loadSample(name) {
  const requestId = ++currentRequest;
  cancelActiveCompression();
  try {
    const res = await fetch(`./samples/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error('未找到样本图片');
    const blob = await res.blob();
    await handleFile(new File([blob], name, { type: 'image/png' }), requestId);
  } catch (err) {
    if (requestId !== currentRequest) return;
    showError('暂时无法加载样本。', err instanceof Error ? err.message : String(err));
  }
}

function renderResult(file, optimizedSize, timeMs, optimizedBlob) {
  const originalSize = file.size;
  const saved = originalSize - optimizedSize;
  const percent = originalSize > 0 ? (saved / originalSize) * 100 : 0;

  els.statOriginal.textContent = formatBytes(originalSize);
  els.statOptimized.textContent = formatBytes(optimizedSize);
  els.statTime.textContent = timeMs < 1000 ? `${Math.round(timeMs)} ms` : `${(timeMs / 1000).toFixed(2)} s`;

  if (saved <= 0) {
    els.statSaved.textContent = '无需进一步压缩';
    els.barFill.style.width = '0%';
  } else {
    els.statSaved.textContent = `${formatBytes(saved)} · ${percent.toFixed(1)}%`;
    els.barFill.style.width = `${Math.max(2, Math.min(100, percent))}%`;
  }

  const base = (file.name || 'image.png').replace(/\.(png|apng)$/i, '');
  els.download.href = URL.createObjectURL(optimizedBlob);
  els.download.download = `${base}.optimized.png`;

  els.status.style.display = 'none';
  els.results.hidden = false;
}

/* ----------------------------------------------------------------- events --- */

els.dropzone.addEventListener('click', () => els.fileInput.click());
els.dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.fileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) handleFile(file);
  els.fileInput.value = '';
});

['dragenter', 'dragover'].forEach((type) =>
  els.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((type) =>
  els.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('drag');
  }),
);
els.dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  if (els.dropzone.contains(e.target)) return;
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) {
    handleFile(file);
    document.getElementById('demo').scrollIntoView({ behavior: 'smooth' });
  }
});

document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.files;
  if (items && items[0]) handleFile(items[0]);
});

document.querySelectorAll('[data-sample]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await loadSample(btn.dataset.sample);
    } finally {
      btn.disabled = false;
    }
  }),
);

els.compareRange.addEventListener('input', () => {
  els.compare.style.setProperty('--pos', `${els.compareRange.value}%`);
});

els.reset.addEventListener('click', () => {
  currentRequest++;
  cancelActiveCompression();
  clearObjectUrls();
  els.imgOriginal.removeAttribute('src');
  els.imgOptimized.removeAttribute('src');
  setStatus('<p class="placeholder">选一张图片，继续轻装上路。</p>');
  els.fileInput.click();
});

els.status.addEventListener('click', (event) => {
  if (!event.target.closest('[data-cancel-compression]')) return;
  currentRequest++;
  cancelActiveCompression();
  clearObjectUrls();
  els.imgOriginal.removeAttribute('src');
  els.imgOptimized.removeAttribute('src');
  setStatus('<p class="placeholder">已取消压缩。</p><p class="muted">可以重新选择图片继续。</p>');
});

document.querySelectorAll('.copy').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const target = document.getElementById(`code-${btn.dataset.copy}`);
    try {
      await navigator.clipboard.writeText(window.siteI18n.translate(codeSources.get(target) ?? target.textContent));
      btn.textContent = '已复制';
      setTimeout(() => (btn.textContent = '复制'), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }),
);

// Keep the designed empty state until a file is selected.

// Deep-link a sample, e.g. /?sample=shapes.png — handy for sharing and testing.
const requestedSample = new URLSearchParams(location.search).get('sample');
if (requestedSample) {
  const name = requestedSample.split('/').pop();
  loadSample(name);
}
