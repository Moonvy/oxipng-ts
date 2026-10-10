const params = new URLSearchParams(location.search);
const integer = (name, fallback, min, max) => {
  const value = Number(params.get(name) ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}: expected ${min}..${max}`);
  return value;
};
const runs = integer('runs', 3, 1, 100);
const warmup = integer('warmup', 1, 0, 100);
const startDelayMs = integer('startDelayMs', 5000, 0, 60000);
const presets = (params.get('presets') ?? '2,6').split(',').map(Number);
if (!presets.length || presets.some(value => !Number.isInteger(value) || value < 0 || value > 6)) throw new Error('Invalid presets');
const selectedSamples = (params.get('samples') ?? '').split(',').filter(Boolean);
const $ = id => document.getElementById(id);
const log = message => { $('log').textContent += `${message}\n`; $('log').scrollTop = $('log').scrollHeight; };
$('config').textContent = `Presets: ${presets.join(', ')} · measured runs: ${runs} · warmups: ${warmup} · alternating order · startup delay: ${startDelayMs / 1000}s. Configure with ?presets=2,6&runs=3&warmup=1 (optional samples=name1,name2, autorun=1, startDelayMs=5000).`;

// Install these before importing either build, so accidental dependencies fail loudly.
const forbiddenCalls = [];
const forbidden = name => {
  forbiddenCalls.push(name);
  throw new Error(`${name} is disabled: benchmark requires pure JS on the window main thread`);
};
for (const name of ['Worker', 'SharedWorker']) {
  Object.defineProperty(globalThis, name, { value: function () { return forbidden(name); }, configurable: false, writable: false });
}
Object.defineProperty(globalThis, 'WebAssembly', {
  value: new Proxy({}, { get: (_, key) => forbidden(`WebAssembly.${String(key)}`) }),
  configurable: false, writable: false,
});

const equalBytes = (a, b, context) => {
  if (a.length !== b.length) throw new Error(`${context}: length differs (${a.length} vs ${b.length})`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) throw new Error(`${context}: byte ${i} differs (${a[i]} vs ${b[i]})`);
};
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
const decode = async bytes => {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D context unavailable');
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
  } finally { URL.revokeObjectURL(url); }
};
const verifyPixels = async (output, original, label) => {
  const decoded = await decode(output);
  if (decoded.width !== original.width || decoded.height !== original.height) throw new Error(`${label}: dimensions differ`);
  equalBytes(decoded.pixels, original.pixels, `${label}: decoded Canvas RGBA`);
};
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const i = sorted.length >> 1;
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
const paint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
const getJSON = async url => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
};
const cell = (tr, value) => { const td = document.createElement('td'); td.textContent = value; tr.append(td); };
let downloadURL;
window.benchmarkResult = null;
window.benchmarkDone = false;
const publishProgress = async (status, result, startedAt, error) => {
  const progress = {
    label: 'round3-browser', execution: 'window-main-thread', startedAt,
    updatedAt: new Date().toISOString(), status,
    rows: (result?.rows ?? []).map(({ name, preset, baselineMs, currentMs, speedup, currentBytes }) => ({ name, preset, baselineMs, currentMs, speedup, currentBytes })),
    ...(error ? { error } : {}),
  };
  const response = await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(progress) });
  if (!response.ok) throw new Error(`Progress save failed: HTTP ${response.status}`);
};

async function runBenchmark() {
  $('run').disabled = true;
  $('rows').replaceChildren();
  $('log').textContent = '';
  $('download').hidden = true;
  $('status').classList.remove('error');
  window.benchmarkDone = false;
  window.benchmarkError = null;
  window.benchmarkSaved = false;
  $('progress').value = 0;
  const startedAt = new Date().toISOString();
  let result;
  try {
    if (window !== globalThis || typeof document === 'undefined') throw new Error('A window main thread is required');
    $('status').textContent = `Preparing — starting in ${startDelayMs / 1000} seconds.`;
    await publishProgress('preparing', null, startedAt);
    await new Promise(resolve => setTimeout(resolve, startDelayMs));
    $('status').textContent = 'Loading and fingerprinting builds and inputs…';
    const manifest = await getJSON('/api/manifest');
    const [baseline, current] = await Promise.all([
      import(`/benchmark/baseline-round3/dist/index.js?sha256=${manifest.baseline.sha256}`),
      import(`/dist/index.js?sha256=${manifest.current.sha256}`),
    ]);
    const samples = manifest.samples.filter(sample => !selectedSamples.length || selectedSamples.includes(sample.name));
    if (!samples.length || selectedSamples.some(name => !samples.some(sample => sample.name === name))) throw new Error('Unknown or empty sample selection');
    const modules = [baseline, current];
    const labels = ['baseline', 'current'];
    result = {
      label: 'round3-browser', execution: 'window-main-thread', startedAt,
      userAgent: navigator.userAgent, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency,
      url: location.href, runs, warmup, startDelayMs, presets, samples: samples.map(sample => sample.name),
      timing: 'performance.now; synchronous compression only; median; alternating baseline/current order; yields between calls; options and input copy prepared outside timing',
      validation: 'every output: exact baseline/current bytes, deterministic across rounds, independent browser Image + Canvas RGBA comparison against original; input immutability',
      limitations: 'Canvas checks rendered 8-bit RGBA; browser color management and alpha premultiplication apply; PNG encoded bytes are independently required to match exactly',
      disabledAPIs: ['Worker', 'SharedWorker', 'WebAssembly'], manifest, rows: [], calls: [],
    };
    window.benchmarkResult = result;
    $('progress').max = presets.length * samples.length * (warmup + runs) * 2;
    $('progress').value = 0;
    for (const preset of presets) for (const sample of samples) {
      const response = await fetch(`/${sample.path.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${sample.name}: HTTP ${response.status}`);
      const input = new Uint8Array(await response.arrayBuffer());
      if (await digest(input) !== sample.sha256) throw new Error(`${sample.name}: input fingerprint changed`);
      const original = await decode(input);
      const times = [[], []];
      let reference;
      let outputs;
      for (let round = 0; round < warmup + runs; round++) {
        const measured = round >= warmup;
        const order = round % 2 === 0 ? [0, 1] : [1, 0];
        outputs = [];
        for (const index of order) {
          const label = `${sample.name} · preset ${preset} · ${measured ? `run ${round - warmup + 1}/${runs}` : `warmup ${round + 1}/${warmup}`} · ${labels[index]}`;
          $('status').textContent = label;
          await paint();
          const copy = input.slice();
          const options = modules[index].Options.fromPreset(preset);
          const start = performance.now();
          const output = modules[index].oxipngSync(copy, options);
          const ms = performance.now() - start;
          if (!(output instanceof Uint8Array)) throw new Error(`${label}: expected synchronous Uint8Array`);
          equalBytes(copy, input, `${label}: input mutation`);
          if (forbiddenCalls.length) throw new Error(`Forbidden API used: ${forbiddenCalls.join(', ')}`);
          if (measured) times[index].push(ms);
          outputs[index] = output;
          result.calls.push({ name: sample.name, preset, round, measured, build: labels[index], ms, bytes: output.length });
          await verifyPixels(output, original, label);
          $('progress').value++;
          log(`${label}: ${ms.toFixed(2)} ms, ${output.length} bytes, pixels verified`);
        }
        equalBytes(outputs[0], outputs[1], `${sample.name} preset ${preset}: baseline/current parity`);
        if (reference) equalBytes(outputs[0], reference, `${sample.name} preset ${preset}: deterministic output`);
        else reference = outputs[0].slice();
      }
      const baselineMs = median(times[0]);
      const currentMs = median(times[1]);
      const row = {
        preset, name: sample.name, inputBytes: input.length, width: original.width, height: original.height,
        baselineBytes: outputs[0].length, currentBytes: outputs[1].length,
        baselineMs, currentMs, speedup: baselineMs / currentMs,
        baselineTimes: times[0], currentTimes: times[1], identical: true, pixelsIdentical: true,
        inputUnchanged: true, outputSHA256: await digest(outputs[0]),
      };
      result.rows.push(row);
      const tr = document.createElement('tr');
      [row.name, preset, baselineMs.toFixed(2), currentMs.toFixed(2), `${row.speedup.toFixed(3)}×`, row.currentBytes, 'Exact bytes + Canvas pixels'].forEach(value => cell(tr, value));
      $('rows').append(tr);
      await publishProgress('running', result, startedAt);
    }
    const manifestAfter = await getJSON('/api/manifest');
    if (JSON.stringify(manifestAfter) !== JSON.stringify(manifest)) throw new Error('Builds or input files changed during benchmark');
    result.finishedAt = new Date().toISOString();
    result.passed = true;
    result.forbiddenCalls = forbiddenCalls.slice();
    const json = JSON.stringify(result, null, 2);
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(new Blob([`${json}\n`], { type: 'application/json' }));
    $('download').href = downloadURL;
    $('download').download = 'comparison-round3-browser.json';
    $('download').hidden = false;
    try {
      const saved = await fetch('/api/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
      if (!saved.ok) throw new Error(`HTTP ${saved.status}`);
      const persistence = await saved.json();
      $('status').textContent = `Completed ${result.rows.length} comparisons; all validations passed. Saved ${persistence.saved}.`;
      window.benchmarkSaved = true;
      await publishProgress('completed', result, startedAt);
    } catch (error) {
      window.benchmarkSaved = false;
      $('status').textContent = `Validations passed, but result save failed (${error.message}). Use Download JSON.`;
    }
  } catch (error) {
    $('status').classList.add('error');
    $('status').textContent = `Failed: ${error.message}`;
    window.benchmarkError = error.stack || error.message;
    if (result) { result.passed = false; result.error = window.benchmarkError; }
    try { await publishProgress('failed', result, startedAt, error.message); }
    catch (progressError) { log(progressError.message); }
    log(window.benchmarkError);
    console.error(error);
  } finally {
    window.benchmarkDone = true;
    $('run').disabled = false;
  }
}
$('run').addEventListener('click', runBenchmark);
window.runBenchmark = runBenchmark;
if (params.get('autorun') === '1') runBenchmark();
