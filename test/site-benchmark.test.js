import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeBenchmark, raceMetrics } from '../site/benchmark-data.js';
import { BENCHMARK_FILES, syncBenchmarkSite } from '../scripts/site-benchmark.mjs';
import { createSiteServer } from '../scripts/serve-site.mjs';

const report = JSON.parse(readFileSync(new URL('../benchmark/results.json', import.meta.url), 'utf8'));
const dirs = [], servers = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'oxipng-site-test-'));
  dirs.push(root);
  const source = join(root, 'benchmark'), site = join(root, 'site');
  mkdirSync(source); mkdirSync(site);
  writeFileSync(join(site, 'index.html'), '<h1>site</h1>');
  for (const name of BENCHMARK_FILES) writeFileSync(join(source, name), name === 'results.json' ? JSON.stringify(report) : `source ${name}`);
  return { source, site };
}

describe('website benchmark data', () => {
  it('derives chart totals from every canonical sample without stored UI numbers', () => {
    const data = normalizeBenchmark(report);
    expect(data.all.inputBytes).toBe(report.totals.originalBytes);
    const expected = [
      [report.totals.nativeBytes, report.totals.nativeMs],
      [report.totals.tsBytes, report.totals.tsCliMs],
      [report.totals.porfforBytes, report.totals.porfforMs],
      [report.totals.scriptcBytes, report.totals.scriptcMs],
    ];
    data.all.engines.forEach((engine, index) => {
      expect(engine.bytes).toBe(expected[index][0]);
      expect(engine.ms).toBeCloseTo(expected[index][1], 6);
    });
    expect(data.rows.length).toBe(report.rows.length);
    expect(data.matchingTs).toBe(true);
  });

  it('updates chart values, options, provenance and animation when the report changes', () => {
    const changed = structuredClone(report);
    changed.generatedAt = new Date(Date.parse(report.generatedAt) + 60000).toISOString();
    changed.options.opt = '4';
    changed.rows[0].nativeMs *= 2;
    changed.rows[0].tsSize -= 100;
    changed.rows[0].porfforMatchesTs = false;
    const before = normalizeBenchmark(report), after = normalizeBenchmark(changed);
    expect(after.generatedAt).toBe(changed.generatedAt);
    expect(after.options.opt).toBe('4');
    expect(after.all.engines[0].ms - before.all.engines[0].ms).toBeCloseTo(report.rows[0].nativeMs);
    expect(after.all.engines[1].bytes).toBe(before.all.engines[1].bytes - 100);
    expect(after.matchingTs).toBe(false);
    expect(raceMetrics(after.all.engines)[1].durationMs).not.toBe(raceMetrics(before.all.engines)[1].durationMs);
  });

  it('uses inverse elapsed time for rate and a uniform playback multiplier', () => {
    const engines = normalizeBenchmark(report).all.engines;
    const normal = raceMetrics(engines), faster = raceMetrics(engines, 4);
    normal.forEach((engine, index) => {
      expect(engine.rate / normal[0].rate).toBeCloseTo(normal[0].ms / engine.ms);
      expect(engine.durationMs / normal[0].durationMs).toBeCloseTo(engine.ms / normal[0].ms);
      expect(faster[index].durationMs).toBeCloseTo(engine.durationMs / 4);
      expect(faster[index].rate).toBe(engine.rate);
    });
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid timing %s instead of animating fabricated data', ms => {
    const bad = structuredClone(report);
    bad.rows[0].nativeMs = ms;
    expect(() => normalizeBenchmark(bad)).toThrow();
  });
  it('rejects missing measurements and empty reports', () => {
    const bad = structuredClone(report);
    delete bad.rows[0].scriptcSize;
    expect(() => normalizeBenchmark(bad)).toThrow();
    expect(() => normalizeBenchmark({ ...report, rows: [] })).toThrow();
  });

  it('refreshes static site copies on each build, including all cited artifacts', async () => {
    const { source, site } = sandbox();
    const output = join(site, 'benchmark');
    await syncBenchmarkSite(source, output);
    for (const name of BENCHMARK_FILES) expect(readFileSync(join(output, name))).toEqual(readFileSync(join(source, name)));
    const next = structuredClone(report);
    next.rows[0].tsSize -= 12;
    writeFileSync(join(source, 'results.json'), JSON.stringify(next));
    await syncBenchmarkSite(source, output);
    expect(JSON.parse(readFileSync(join(output, 'results.json'))).rows[0].tsSize).toBe(next.rows[0].tsSize);
  });

  it('serves updated canonical results without rebuilding and disables stale caching', async () => {
    const { source, site } = sandbox();
    writeFileSync(join(site, 'benchmark.json'), 'stale snapshot');
    const server = createSiteServer({ siteDir: site, benchmarkDir: source });
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const first = await fetch(`${base}/benchmark/results.json`);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect((await first.json()).generatedAt).toBe(report.generatedAt);
    const next = structuredClone(report);
    next.generatedAt = new Date(Date.parse(report.generatedAt) + 60000).toISOString();
    writeFileSync(join(source, 'results.json'), JSON.stringify(next));
    expect((await (await fetch(`${base}/benchmark/results.json`)).json()).generatedAt).toBe(next.generatedAt);
    expect(await (await fetch(`${base}/`)).text()).toBe('<h1>site</h1>');
    expect((await fetch(`${base}/missing`)).status).toBe(404);
    expect((await fetch(`${base}/..%2Fbenchmark%2Fresults.json`)).status).toBe(403);
  });
});
