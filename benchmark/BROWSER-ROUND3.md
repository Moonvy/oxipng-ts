# Round 3 browser comparison

Build `dist/` and save the baseline at `benchmark/baseline-round3/dist/index.js`,
then run from the repository root:

```sh
node benchmark/browser-server.mjs
```

`dist/` and saved baseline builds may be ignored by Git. Before modifying the
encoder, create the baseline snapshot explicitly:

```sh
npm run build
mkdir -p benchmark/baseline-round3/dist
cp dist/index.js benchmark/baseline-round3/dist/index.js
```

Keep that snapshot unchanged, make the source changes, and run `npm run build`
again to produce the current `dist/index.js`. To recreate the historical baseline
from a clean checkout, export commit `71e2a48d` to a temporary directory, reuse
the checkout's installed dependencies, build there, and copy its bundle:

```sh
baseline_tmp=$(mktemp -d)
git archive 71e2a48d | tar -x -C "$baseline_tmp"
ln -s "$PWD/node_modules" "$baseline_tmp/node_modules"
(cd "$baseline_tmp" && npm run build)
mkdir -p benchmark/baseline-round3/dist
cp "$baseline_tmp/dist/index.js" benchmark/baseline-round3/dist/index.js
rm -rf "$baseline_tmp"
npm run build
```

Open http://127.0.0.1:8787/ and click **Run benchmark**. This serves local files
only; Node never imports either encoder or performs compression. The service
binds to 127.0.0.1, serves an explicit file allowlist, and only permits same-origin
JSON POSTs to the fixed output `benchmark/comparison-round3-browser.json`.
Each completed sample/preset also updates the small progress file
`benchmark/.round3-browser-progress.json` through `/api/progress`.
Change the port with `--port 8788`.

Clicking Run returns control and waits five seconds before importing either
encoder or starting compression. The page displays “Preparing — starting in
5 seconds.” during this delay. Override only if needed with `startDelayMs=5000`.

Defaults: presets 2 and 6, all four real PNG samples, one warmup and three
measured rounds per sample/preset. Baseline/current ordering alternates each
round. Options and a fresh input copy are prepared before `performance.now()`;
only synchronous `oxipngSync` execution is timed on the window main thread.
The page yields between calls to paint progress. Every warmup and measured
output must preserve its input, equal its counterpart byte-for-byte, remain
deterministic across rounds, and decode to the original Canvas RGBA pixels.
Canvas provides an independent browser decoder, with the usual color
management, 8-bit RGBA, and alpha premultiplication behavior.

The page disables Worker, SharedWorker, and WebAssembly before module imports.
Any use throws and fails the run, even if the encoder catches the exception.
SHA-256 fingerprints identify both builds and inputs; file fingerprints are
checked again after the run. Keep the tab in the foreground, avoid running
other heavy tasks, and use the same browser and machine for comparisons.
During measurement, do not automate DOM, accessibility, screenshots, or browser
state reads: those operations can interfere with browser execution and timing.
After clicking Run, monitor the progress/result files from the filesystem until
the run ends. Keep the browser otherwise untouched during the measurement.
Reopen/reload the page after rebuilding `dist/` so the browser module cache
does not retain an earlier build.

URL examples:

```text
http://127.0.0.1:8787/?presets=2,6&runs=3&warmup=1
http://127.0.0.1:8787/?presets=2&runs=1&warmup=0&samples=Qjiao.png
http://127.0.0.1:8787/?presets=2,6&runs=3&warmup=1&autorun=1
```

Successful runs save the fixed JSON output and expose a download link. The
result contains browser/machine metadata, SHA-256 fingerprints, every timing,
medians, speedups, output sizes, and validation flags. Automation can read
`window.benchmarkDone`, `window.benchmarkError`, `window.benchmarkSaved`, and
`window.benchmarkResult`, or invoke `window.runBenchmark()`. Read browser state
only before measurement or after the final result file is saved. During the run,
read the progress file, which contains only status and completed summary rows.
Timing uses an
arithmetic midpoint for medians with even run counts. A failure appears on the
page and in `window.benchmarkError`, and never overwrites the saved result.
