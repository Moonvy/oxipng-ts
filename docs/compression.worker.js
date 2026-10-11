import { Options, optimizeFromMemory } from './dist/oxipng-ts.js';

self.addEventListener('message', ({ data }) => {
  if (data?.type !== 'optimize') return;

  try {
    const { buffer, params } = data;
    const options = params.level === 'max'
      ? Options.maxCompression()
      : Options.fromPreset(Number(params.level));
    options.optimizeAlpha = Boolean(params.alpha);
    if (params.strip) options.strip = { mode: 'safe' };
    if (params.interlace === 'on') options.interlace = true;
    else if (params.interlace === 'off') options.interlace = false;
    else options.interlace = null;

    const startedAt = performance.now();
    const output = optimizeFromMemory(new Uint8Array(buffer), options);
    const outputBuffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    self.postMessage({
      type: 'result',
      output: outputBuffer,
      timeMs: performance.now() - startedAt,
      size: output.byteLength,
    }, [outputBuffer]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
