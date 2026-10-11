import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeBenchmark } from '../site/benchmark-data.js';

export const BENCHMARK_FILES = [
  'results.json', 'REPORT.md', 'PERFORMANCE.md', 'README.md',
  'core-results.json', 'core-level4-results.json', 'adaptive-results.json',
  'adaptive-level4-results.json', 'rust-level4-results.json', 'adaptive-baseline.patch',
];

export async function syncBenchmarkSite(sourceDir, targetDir) {
  const results = await readFile(join(sourceDir, 'results.json'), 'utf8');
  normalizeBenchmark(JSON.parse(results));
  await mkdir(targetDir, { recursive: true });
  await writeFile(join(targetDir, 'results.json'), results);
  for (const name of BENCHMARK_FILES.slice(1)) {
    await copyFile(join(sourceDir, name), join(targetDir, name));
  }
}
