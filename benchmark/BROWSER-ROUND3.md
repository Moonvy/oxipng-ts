# Round 3 browser comparison

Build `dist/` and save the baseline at `benchmark/baseline-round3/dist/index.js`,
then run from the repository root:

```sh
node benchmark/browser-server.mjs
```

The same harness also supports later rounds without changing the page URL or
the HTML/JavaScript filenames. The server defaults to round 3; select round 4
with:

```sh
node benchmark/browser-server.mjs --round 4
```

This reads `benchmark/baseline-round4/dist/index.js`, saves final results to
`benchmark/comparison-round4-browser.json`, and writes progress to
`benchmark/.round4-browser-progress.json`. Create that baseline snapshot before
changing the encoder, using the same build-and-copy procedure below with
`baseline-round4` as the destination. Existing round-3 outputs stay separate.
The manifest supplies the round, label, build URLs and output filenames; the
browser selects its imports and download filename from that manifest. Restart
the server with the chosen `--round`, then reload the page before running.

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
JSON POSTs to fixed output paths selected by `--round`: the final result is
`benchmark/comparison-roundN-browser.json`, and each completed sample/preset
updates `benchmark/.roundN-browser-progress.json` through `/api/progress`.
The default is round 3 (`N=3`).
Change the port with `--port 8788`.

Clicking Run returns control and waits five seconds before importing either
encoder or starting compression. The page displays “Preparing — starting in
5 seconds.” during this delay. Override only if needed with `startDelayMs=5000`.

Defaults: presets 2 and 6, all four real PNG samples, one warmup and three
measured rounds per sample/preset. Baseline/current ordering alternates each
round. Options and a fresh input copy are prepared before `performance.now()`;
only synchronous `oxipngSync` execution is timed on the window main thread.
The page yields between calls with `setTimeout(0)`, avoiding background-tab
`requestAnimationFrame` suspension. Every warmup and measured
output must preserve its input, equal its counterpart byte-for-byte, remain
deterministic across rounds, and decode to the original Canvas RGBA pixels.
Canvas provides an independent browser decoder, with the usual color
management, 8-bit RGBA, and alpha premultiplication behavior.

The page disables Worker, SharedWorker, and WebAssembly before module imports.
Any use throws and fails the run, even if the encoder catches the exception.
SHA-256 fingerprints identify both builds and inputs; file fingerprints are
checked again after the run. Select the benchmark tab in the native browser UI
and keep that tab selected throughout the run. Merely obtaining a tab through an
extension or calling extension `getAX` does not select it in the native browser.
After the startup delay, the harness requires `document.visibilityState` to be
`visible` at startup, before and after every compression call, and at completion.
Any hidden visibility event invalidates the entire run even if the tab later
becomes visible. Results include visibility events and per-call states; the
progress file includes their compact summary. A visibility failure writes
`failed` progress and does not replace the final result file. Avoid running
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
