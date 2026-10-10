// Local static hosting and result persistence only. Compression runs in the browser.
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex < 0 ? 8787 : process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
const host = '127.0.0.1';
const origin = `http://${host}:${port}`;
const resultPath = resolve(root, 'benchmark/comparison-round3-browser.json');
const progressPath = resolve(root, 'benchmark/.round3-browser-progress.json');
const samples = (await readdir(resolve(root, 'benchmark/sample'))).filter(name => /\.png$/i.test(name)).sort();
const assets = new Map([
  ['/', ['benchmark/browser-round3.html', 'text/html; charset=utf-8']],
  ['/benchmark/browser-round3.html', ['benchmark/browser-round3.html', 'text/html; charset=utf-8']],
  ['/benchmark/browser-round3.mjs', ['benchmark/browser-round3.mjs', 'text/javascript; charset=utf-8']],
  ['/dist/index.js', ['dist/index.js', 'text/javascript; charset=utf-8']],
  ['/benchmark/baseline-round3/dist/index.js', ['benchmark/baseline-round3/dist/index.js', 'text/javascript; charset=utf-8']],
  ...samples.map(name => [`/benchmark/sample/${name}`, [`benchmark/sample/${name}`, 'image/png']]),
]);
const fingerprint = async path => {
  const bytes = await readFile(resolve(root, path));
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const reply = (res, status, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
};
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== `${host}:${port}` && req.headers.host !== `localhost:${port}`) {
      reply(res, 403, 'Localhost Host required');
      return;
    }
    const path = decodeURIComponent(new URL(req.url, origin).pathname);
    if (req.method === 'GET' && path === '/api/manifest') {
      const [baseline, current, inputs] = await Promise.all([
        fingerprint('benchmark/baseline-round3/dist/index.js'),
        fingerprint('dist/index.js'),
        Promise.all(samples.map(name => fingerprint(`benchmark/sample/${name}`))),
      ]);
      reply(res, 200, JSON.stringify({ baseline, current, samples: inputs.map((input, i) => ({ name: samples[i], ...input })) }), 'application/json');
      return;
    }
    if (req.method === 'POST' && (path === '/api/result' || path === '/api/progress')) {
      const acceptedOrigins = [origin, `http://localhost:${port}`];
      if (!acceptedOrigins.includes(req.headers.origin) || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
        reply(res, 403, 'Same-origin application/json required');
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) { reply(res, 413, 'Result too large'); return; }
        chunks.push(chunk);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (result.label !== 'round3-browser' || result.execution !== 'window-main-thread' || !Array.isArray(result.rows)) {
        reply(res, 400, 'Invalid benchmark result');
        return;
      }
      const target = path === '/api/progress' ? progressPath : resultPath;
      await writeFile(`${target}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
      await rename(`${target}.tmp`, target);
      reply(res, 200, JSON.stringify({ saved: path === '/api/progress' ? 'benchmark/.round3-browser-progress.json' : 'benchmark/comparison-round3-browser.json' }), 'application/json');
      return;
    }
    const asset = assets.get(path);
    if (req.method !== 'GET' || !asset) { reply(res, 404, 'Not found'); return; }
    reply(res, 200, await readFile(resolve(root, asset[0])), asset[1]);
  } catch (error) {
    reply(res, error.code === 'ENOENT' ? 404 : 500, error.message);
  }
});
server.listen(port, host, () => {
  console.log(`Browser benchmark: ${origin}/`);
  console.log('Only the browser runs compression. Results save to benchmark/comparison-round3-browser.json.');
});
