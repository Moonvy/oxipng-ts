import { Options, optimizeFromMemory } from './dist/oxipng-ts.js';

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

let worker = null;
let nextId = 1;
const pending = new Map();
let currentFile = null;

/* ---------------------------------------------------------------- worker ---- */

function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (event.data.error) entry.reject(new Error(event.data.error));
      else entry.resolve({ output: event.data.output, timeMs: event.data.timeMs, size: event.data.size });
    };
    worker.onerror = () => {
      // Fall back to the main thread for any queued work.
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function optimizeInWorker(buffer, params) {
  const w = getWorker();
  if (!w) return optimizeOnMainThread(buffer, params);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Transfer the buffer; the caller keeps its own copy for previewing.
    w.postMessage({ id, buffer, params }, [buffer]);
  });
}

function optimizeOnMainThread(buffer, params) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const opts = params.level === 'max' ? Options.maxCompression() : Options.fromPreset(Number(params.level));
      opts.optimizeAlpha = Boolean(params.alpha);
      if (params.strip) opts.strip = { mode: 'safe' };
      if (params.interlace === 'on') opts.interlace = true;
      else if (params.interlace === 'off') opts.interlace = false;
      else opts.interlace = null;
      const t0 = performance.now();
      const output = optimizeFromMemory(new Uint8Array(buffer), opts);
      resolve({ output: output.buffer, timeMs: performance.now() - t0, size: output.length });
    }, 30);
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

async function handleFile(file) {
  if (!file) return;
  const isPng = /\.(png|apng)$/i.test(file.name) || file.type === 'image/png' || file.type === 'image/apng';
  if (!isPng && file.type !== '') {
    setStatus(`<p class="error">That looks like a ${file.type || 'unknown'} file. Please choose a PNG or APNG.</p>`);
    return;
  }

  currentFile = file;
  clearObjectUrls();
  const originalUrl = URL.createObjectURL(file);
  els.imgOriginal.src = originalUrl;
  els.imgOptimized.removeAttribute('src');

  setStatus('<div class="spinner"></div><p>Optimizing locally…</p>');

  const arrayBuffer = await file.arrayBuffer();
  try {
    const { output, timeMs, size } = await optimizeInWorker(arrayBuffer, readParams());
    const optimizedBlob = new Blob([output], { type: 'image/png' });
    const optimizedUrl = URL.createObjectURL(optimizedBlob);
    els.imgOptimized.src = optimizedUrl;
    els.imgOptimized.onload = () => {
      els.compareRange.value = 50;
      els.compare.style.setProperty('--pos', '50%');
    };

    renderResult(file.size, size, timeMs, optimizedBlob);
  } catch (err) {
    setStatus(`<p class="error">Could not optimize this image.</p><p class="muted">${err.message}</p>`);
  }
}

function renderResult(originalSize, optimizedSize, timeMs, optimizedBlob) {
  const saved = originalSize - optimizedSize;
  const percent = originalSize > 0 ? (saved / originalSize) * 100 : 0;

  els.statOriginal.textContent = formatBytes(originalSize);
  els.statOptimized.textContent = formatBytes(optimizedSize);
  els.statTime.textContent = timeMs < 1000 ? `${Math.round(timeMs)} ms` : `${(timeMs / 1000).toFixed(2)} s`;

  if (saved <= 0) {
    els.statSaved.textContent = 'Already optimal';
    els.barFill.style.width = '0%';
  } else {
    els.statSaved.textContent = `${formatBytes(saved)} · ${percent.toFixed(1)}%`;
    els.barFill.style.width = `${Math.max(2, Math.min(100, percent))}%`;
  }

  const base = (currentFile && currentFile.name ? currentFile.name : 'image.png').replace(/\.(png|apng)$/i, '');
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
      const res = await fetch(`./samples/${btn.dataset.sample}`);
      const blob = await res.blob();
      const file = new File([blob], btn.dataset.sample, { type: 'image/png' });
      await handleFile(file);
    } finally {
      btn.disabled = false;
    }
  }),
);

els.compareRange.addEventListener('input', () => {
  els.compare.style.setProperty('--pos', `${els.compareRange.value}%`);
});

els.reset.addEventListener('click', () => {
  currentFile = null;
  clearObjectUrls();
  els.imgOriginal.removeAttribute('src');
  els.imgOptimized.removeAttribute('src');
  if (els.download.href) URL.revokeObjectURL(els.download.href);
  els.download.removeAttribute('href');
  setStatus('<p class="placeholder">Your results will appear here.</p>');
  els.fileInput.click();
});

document.querySelectorAll('.copy').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const target = document.getElementById(`code-${btn.dataset.copy}`);
    try {
      await navigator.clipboard.writeText(target.textContent);
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = original), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }),
);

setStatus('<p class="placeholder">Your results will appear here.</p>');

// Deep-link a sample, e.g. /?sample=shapes.png — handy for sharing and testing.
const requestedSample = new URLSearchParams(location.search).get('sample');
if (requestedSample) {
  const name = requestedSample.split('/').pop();
  fetch(`./samples/${encodeURIComponent(name)}`)
    .then((res) => {
      if (!res.ok) throw new Error('sample not found');
      return res.blob();
    })
    .then((blob) => handleFile(new File([blob], name, { type: 'image/png' })))
    .catch(() => {});
}
