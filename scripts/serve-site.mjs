// Static preview, with benchmark references read directly from their source.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCHMARK_FILES } from './site-benchmark.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
  '.patch': 'text/plain; charset=utf-8',
};

export function createSiteServer({ siteDir = join(root, 'docs'), benchmarkDir = join(root, 'benchmark') } = {}) {
  siteDir = resolve(siteDir);
  return createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const reportName = urlPath.startsWith('/benchmark/') ? urlPath.slice('/benchmark/'.length) : '';
      if (BENCHMARK_FILES.includes(reportName)) {
        const body = await readFile(join(benchmarkDir, reportName));
        res.writeHead(200, { 'content-type': TYPES[extname(reportName)], 'cache-control': 'no-store' });
        res.end(body);
        return;
      }
      let filePath = normalize(join(siteDir, urlPath));
      if (filePath !== siteDir && !filePath.startsWith(`${siteDir}${sep}`)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      let info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) {
        filePath = join(filePath, 'index.html');
        info = await stat(filePath).catch(() => null);
      }
      if (!info?.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(await readFile(filePath));
    } catch (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain' }).end(String(err));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5199);
  createSiteServer().listen(port, () => console.log(`oxipng-ts landing page: http://localhost:${port}/`));
}
