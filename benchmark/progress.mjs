import { clearLine, cursorTo } from 'node:readline';
import { performance } from 'node:perf_hooks';

export function duration(ms) {
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s`;
}

// Keep timing/progress separate: callers start their measurement after begin()
// and finish it before end(). Pipes receive plain, append-only logs.
export function createProgress(total, stream = process.stdout) {
  let completed = 0;
  let timer;
  let current;
  const started = performance.now();
  const tty = Boolean(stream.isTTY);
  const clear = () => {
    if (tty && current) { clearLine(stream, 0); cursorTo(stream, 0); }
  };
  const render = () => {
    if (!current) return;
    const elapsed = performance.now() - current.started;
    const message = `  [${completed}/${total} · ${Math.floor(completed / total * 100)}%] ${duration(elapsed)}${elapsed >= 30_000 ? ' · 仍在运行' : ''} · ${current.label}`;
    if (tty) {
      clear();
      stream.write(message.slice(0, Math.max(20, (stream.columns || 120) - 1)));
    } else {
      stream.write(message + '\n');
    }
  };
  return {
    begin(label) {
      this.end();
      current = { label, started: performance.now() };
      render();
      timer = setInterval(render, tty ? 1000 : 15_000);
      timer.unref();
    },
    end() {
      clearInterval(timer);
      clear();
      current = null;
    },
    complete() { completed++; },
    log(message) { this.end(); stream.write(message + '\n'); },
    get elapsed() { return performance.now() - started; },
  };
}
