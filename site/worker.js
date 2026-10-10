import { Options, optimizeFromMemory } from './dist/oxipng-ts.js';

function buildOptions(p) {
  const opts = p.level === 'max' ? Options.maxCompression() : Options.fromPreset(Number(p.level));
  opts.optimizeAlpha = Boolean(p.alpha);
  if (p.strip) opts.strip = { mode: 'safe' };
  if (p.interlace === 'on') opts.interlace = true;
  else if (p.interlace === 'off') opts.interlace = false;
  else opts.interlace = null;
  return opts;
}

self.onmessage = (event) => {
  const { id, buffer, params } = event.data;
  try {
    const input = new Uint8Array(buffer);
    const t0 = performance.now();
    const output = optimizeFromMemory(input, buildOptions(params));
    const timeMs = performance.now() - t0;
    // Copy into a standalone buffer so it can be transferred back.
    const copy = output.slice();
    self.postMessage({ id, output: copy.buffer, timeMs, size: copy.length }, [copy.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
