// Builds the static landing page: copies the browser bundle and generates the
// demo sample images using the library itself.
import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';

import { BitDepth, NONE, Options, RawImage, RGBA, libdeflater, rgb } from '../dist/js/index.js';
import { syncBenchmarkSite } from './site-benchmark.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'site');
const siteDir = join(root, 'docs');
const distDir = join(siteDir, 'dist');
const samplesDir = join(siteDir, 'samples');

/** A "plain" PNG export: no reductions and a moderate DEFLATE level. */
function plainOptions() {
  const opts = new Options();
  opts.force = true;
  opts.interlace = false;
  opts.filters = [NONE];
  opts.deflater = libdeflater(6);
  opts.bitDepthReduction = false;
  opts.colorTypeReduction = false;
  opts.paletteReduction = false;
  opts.grayscaleReduction = false;
  return opts;
}

function encode(width, height, colorType, data) {
  const raw = new RawImage(width, height, colorType, BitDepth.Eight, data);
  return raw.createOptimizedPng(plainOptions());
}

function gradient(width, height) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const fx = x / (width - 1);
      const fy = y / (height - 1);
      data[i] = Math.round(255 * fx);
      data[i + 1] = Math.round(255 * fy);
      data[i + 2] = Math.round(255 * (0.5 + 0.5 * Math.sin((fx + fy) * Math.PI)));
    }
  }
  return encode(width, height, rgb(), data);
}

function plasma(width, height) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const dx = x - width * 0.5;
      const dy = y - height * 0.5;
      const v =
        Math.sin(x / 42) +
        Math.sin(y / 34) +
        Math.sin((x + y) / 58) +
        Math.sin(Math.sqrt(dx * dx + dy * dy) / 33);
      const t = (v + 4) / 8;
      data[i] = Math.round(255 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2)));
      data[i + 1] = Math.round(255 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 + 2.1)));
      data[i + 2] = Math.round(255 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 + 4.2)));
    }
  }
  return encode(width, height, rgb(), data);
}

function shapes(width, height) {
  const data = new Uint8Array(width * height * 4);
  const colors = [
    [99, 102, 241, 255],
    [34, 211, 238, 255],
    [244, 114, 182, 255],
    [52, 211, 153, 255],
    [251, 191, 36, 255],
    [248, 113, 113, 255],
  ];
  const circles = [
    [0.3, 0.32, 0.2],
    [0.68, 0.3, 0.16],
    [0.5, 0.6, 0.24],
    [0.24, 0.72, 0.14],
    [0.78, 0.68, 0.18],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let color = null;
      for (let c = circles.length - 1; c >= 0; c--) {
        const [cx, cy, r] = circles[c];
        const dx = x - cx * width;
        const dy = y - cy * height;
        if (dx * dx + dy * dy <= r * r * width * height) {
          color = colors[c % colors.length];
          break;
        }
      }
      if (color) {
        data[i] = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
        data[i + 3] = 255;
      }
    }
  }
  return encode(width, height, RGBA, data);
}

async function main() {
  await rm(siteDir, { recursive: true, force: true });
  await cp(sourceDir, siteDir, { recursive: true, filter: (path) =>
    path === sourceDir || !['dist', 'samples', 'benchmark'].includes(path.slice(sourceDir.length + 1).split(/[\\/]/)[0]),
  });
  await writeFile(join(siteDir, '.nojekyll'), '');
  await mkdir(distDir, { recursive: true });
  await mkdir(samplesDir, { recursive: true });

  await bundle({
    entryPoints: [join(sourceDir, 'app.js')],
    outfile: join(siteDir, 'app.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['./dist/oxipng-ts.js'],
  });

  await copyFile(join(root, 'dist', 'js', 'index.js'), join(distDir, 'oxipng-ts.js'));

  // Read the canonical benchmark on every build; never embed measured values
  // into HTML or JS. These copies make the entire site deployable as static files.
  await syncBenchmarkSite(join(root, 'benchmark'), join(siteDir, 'benchmark'));
  console.log('build-site: refreshed benchmark data and source reports');

  const samples = {
    'gradient.png': gradient(960, 600),
    'shapes.png': shapes(720, 720),
    'photo.png': plasma(800, 560),
  };
  for (const [name, bytes] of Object.entries(samples)) {
    await writeFile(join(samplesDir, name), bytes);
    console.log(`  sample ${name} (${(bytes.length / 1024).toFixed(1)} KiB)`);
  }

  console.log('build-site: copied browser bundle to docs/dist/oxipng-ts.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
