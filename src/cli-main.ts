import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, statSync } from 'node:fs';

import {
  BigEnt,
  Bigrams,
  Brute,
  Entropy,
  MinSum,
  type FilterStrategy,
} from './filters/strategies.ts';
import { rowFilterFromNumber } from './filters/index.ts';
import { DISPLAY_CHUNKS } from './headers.ts';
import { LogLevel, logError, logWarn, setLogLevel, setLogSink } from './log.ts';
import { libdeflater, zopfli } from './deflate/index.ts';
import { Options } from './options.ts';
import { PngError } from './error.ts';
import { collectFiles, inFileToString, optimize, type InFile, type OutFile } from './node.ts';
import { filterSetFrom } from './util/filterSet.ts';

const FORBIDDEN_CHUNKS = ['IHDR', 'IDAT', 'tRNS', 'PLTE', 'IEND'];

interface ParsedCli {
  outFile: OutFile;
  outDir: string | null;
  opts: Options;
  files: string[];
  recursive: boolean;
  json: boolean;
  quiet: boolean;
  verbose: number;
  dryRun: boolean;
  sequential: boolean;
  threads: number | undefined;
}

function buildOptionSpec() {
  return {
    opt: { type: 'string' as const, short: 'o' },
    recursive: { type: 'boolean' as const, short: 'r' },
    dir: { type: 'string' as const },
    out: { type: 'string' as const },
    stdout: { type: 'boolean' as const },
    preserve: { type: 'boolean' as const, short: 'p' },
    'dry-run': { type: 'boolean' as const, short: 'd' },
    strip: { type: 'string' as const },
    'strip-safe': { type: 'boolean' as const, short: 's' },
    keep: { type: 'string' as const },
    alpha: { type: 'boolean' as const, short: 'a' },
    interlace: { type: 'string' as const, short: 'i' },
    scale16: { type: 'boolean' as const },
    verbose: { type: 'boolean' as const, short: 'v', multiple: true },
    quiet: { type: 'boolean' as const, short: 'q' },
    json: { type: 'boolean' as const, short: 'j' },
    filters: { type: 'string' as const, short: 'f' },
    fast: { type: 'boolean' as const },
    zc: { type: 'string' as const },
    nb: { type: 'boolean' as const },
    nc: { type: 'boolean' as const },
    np: { type: 'boolean' as const },
    ng: { type: 'boolean' as const },
    nx: { type: 'boolean' as const },
    nz: { type: 'boolean' as const },
    fix: { type: 'boolean' as const },
    force: { type: 'boolean' as const },
    zopfli: { type: 'boolean' as const, short: 'z' },
    Z: { type: 'boolean' as const },
    zi: { type: 'string' as const },
    ziwi: { type: 'string' as const },
    'brute-level': { type: 'string' as const },
    'brute-lines': { type: 'string' as const },
    timeout: { type: 'string' as const },
    'max-raw-size': { type: 'string' as const },
    threads: { type: 'string' as const, short: 't' },
    sequential: { type: 'boolean' as const },
    help: { type: 'boolean' as const, short: 'h' },
    version: { type: 'boolean' as const, short: 'V' },
  };
}

/** Parse CLI arguments into concrete output settings and {@link Options}. */
export function parseCliArgs(argv: string[]): ParsedCli {
  const spec = buildOptionSpec();
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: spec, allowPositionals: true, strict: true });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }
  const values = parsed.values as Record<string, unknown>;
  const flag = (name: string): boolean => values[name] === true;
  const str = (name: string): string | undefined => (typeof values[name] === 'string' ? (values[name] as string) : undefined);

  if (flag('help')) throw new HelpRequested();
  if (flag('version')) throw new VersionRequested();

  const verbose = Array.isArray(values.verbose) ? (values.verbose as boolean[]).length : 0;
  const quiet = flag('quiet');

  const logLevel = quiet ? LogLevel.Off : verbose === 0 ? LogLevel.Warn : verbose === 1 ? LogLevel.Info : verbose === 2 ? LogLevel.Debug : LogLevel.Trace;
  setLogLevel(logLevel);

  // Optimization preset
  const optArg = str('opt');
  let opts: Options;
  if (optArg === undefined) {
    opts = new Options();
  } else if (optArg === 'max') {
    opts = Options.maxCompression();
  } else {
    const level = Number(optArg);
    if (!Number.isInteger(level) || level < 0 || level > 6) throw new Error(`Invalid optimization level: ${optArg}`);
    opts = Options.fromPreset(level);
  }

  // Apply custom brute settings and remember preset defaults.
  let bruteLines: number | undefined;
  let bruteLevel: number | undefined;
  const rebuiltFilters: FilterStrategy[] = [];
  for (const f of opts.filters) {
    if (f.kind === 'brute') {
      const nl = bruteLines ?? f.numLines;
      const lv = bruteLevel ?? f.level;
      rebuiltFilters.push(Brute(nl, lv));
      bruteLines = nl;
      bruteLevel = lv;
    } else {
      rebuiltFilters.push(f);
    }
  }
  opts.filters = filterSetFrom(rebuiltFilters);

  const bruteLevelArg = str('brute-level');
  const bruteLinesArg = str('brute-lines');
  if (bruteLevelArg !== undefined) {
    const v = Number(bruteLevelArg);
    if (!Number.isInteger(v) || v < 1 || v > 12) throw new Error(`Invalid brute level: ${bruteLevelArg}`);
    bruteLevel = v;
  }
  if (bruteLinesArg !== undefined) {
    const v = Number(bruteLinesArg);
    if (!Number.isInteger(v) || v < 1) throw new Error(`Invalid brute lines: ${bruteLinesArg}`);
    bruteLines = v;
  }
  if (bruteLevelArg !== undefined || bruteLinesArg !== undefined) {
    opts.filters = filterSetFrom(
      opts.filters.map((f) =>
        f.kind === 'brute' ? Brute(bruteLines ?? f.numLines, bruteLevel ?? f.level) : f,
      ),
    );
  }

  const filtersArg = str('filters');
  if (filtersArg !== undefined) {
    const nums = parseNumericRangeOpts(filtersArg, 0, 9);
    opts.filters = filterSetFrom(
      nums.map((f) => {
        if (f <= 4) return { kind: 'basic', filter: rowFilterFromNumber(f) } as FilterStrategy;
        if (f === 5) return MinSum;
        if (f === 6) return Entropy;
        if (f === 7) return Bigrams;
        if (f === 8) return BigEnt;
        return Brute(bruteLines ?? 3, bruteLevel ?? 1);
      }),
    );
  }

  const timeoutArg = str('timeout');
  if (timeoutArg !== undefined) {
    const secs = Number(timeoutArg);
    if (!Number.isFinite(secs) || secs < 0) throw new Error(`Invalid timeout: ${timeoutArg}`);
    opts.timeout = secs;
  }

  const maxSizeArg = str('max-raw-size');
  if (maxSizeArg !== undefined) {
    opts.maxDecompressedSize = parseSize(maxSizeArg);
  }

  const threadsArg = str('threads');
  let threads: number | undefined;
  if (threadsArg !== undefined) {
    const v = Number(threadsArg);
    if (!Number.isInteger(v) || v < 1) throw new Error(`Invalid thread count: ${threadsArg}`);
    threads = v;
  }

  // Output directory
  const dirArg = str('dir');
  let outDir: string | null = null;
  if (dirArg !== undefined) {
    if (!existsSync(dirArg)) {
      try {
        mkdirSync(dirArg, { recursive: true });
      } catch (err) {
        throw new Error(`Could not create output directory ${err}`);
      }
    } else if (!statSync(dirArg).isDirectory()) {
      throw new Error(`${dirArg} is an existing file (not a directory), cannot create directory`);
    }
    outDir = dirArg;
  }

  const dryRun = flag('dry-run');
  const outArg = str('out');
  let outFile: OutFile;
  if (flag('stdout')) outFile = { kind: 'stdout' };
  else if (dryRun) outFile = { kind: 'none' };
  else outFile = { kind: 'path', path: outArg ?? null, preserveAttrs: flag('preserve') };

  // Conflict validation (mirrors clap's conflicts_with).
  const stdout = flag('stdout');
  if (outDir !== null && stdout) throw new Error('the argument --directory cannot be used with --stdout');
  if (outDir !== null && outArg !== undefined) throw new Error('the argument --directory cannot be used with --out');
  if (outArg !== undefined && stdout) throw new Error('the argument --out cannot be used with --stdout');

  opts.optimizeAlpha = flag('alpha');
  opts.scale16 = flag('scale16');
  if (flag('fast')) opts.fastEvaluation = true;
  opts.force = flag('force');
  opts.fixErrors = flag('fix');
  opts.bitDepthReduction = !flag('nb');
  opts.colorTypeReduction = !flag('nc');
  opts.paletteReduction = !flag('np');
  opts.grayscaleReduction = !flag('ng');
  if (flag('nx')) {
    opts.bitDepthReduction = false;
    opts.colorTypeReduction = false;
    opts.paletteReduction = false;
    opts.grayscaleReduction = false;
  }
  opts.idatRecoding = !flag('nz');

  const interlaceArg = str('interlace');
  if (interlaceArg !== undefined) {
    opts.interlace = interlaceArg === 'off' || interlaceArg === '0' ? false : interlaceArg === 'on' || interlaceArg === '1' ? true : null;
  } else if (flag('nx')) {
    opts.interlace = null;
  } else {
    opts.interlace = false;
  }

  // Strip / keep
  const keepArg = str('keep');
  if (keepArg !== undefined) {
    const names = new Set<string>();
    for (const raw of keepArg.split(',')) {
      const x = raw.trim();
      if (x === '') continue;
      if (x === 'display') {
        for (const c of DISPLAY_CHUNKS) names.add(c);
        continue;
      }
      if (x.length !== 4) throw new Error(`Invalid chunk name ${x}`);
      if (FORBIDDEN_CHUNKS.includes(x)) throw new Error(`${x} chunk is controlled internally and may not be explicitly kept`);
      names.add(x);
    }
    opts.strip = { mode: 'keep', names };
  }

  const stripArg = str('strip');
  if (stripArg !== undefined) {
    if (stripArg === 'safe') opts.strip = { mode: 'safe' };
    else if (stripArg === 'all') opts.strip = { mode: 'all' };
    else {
      const names = new Set<string>();
      for (const raw of stripArg.split(',')) {
        const x = raw.trim();
        if (x === '') continue;
        if (x === 'safe' || x === 'all') throw new Error("'safe' or 'all' presets for --strip should be used by themselves");
        if (x.length !== 4) throw new Error(`Invalid chunk name ${x}`);
        if (FORBIDDEN_CHUNKS.includes(x)) throw new Error(`${x} chunk is not allowed to be stripped`);
        names.add(x);
      }
      opts.strip = { mode: 'strip', names };
    }
  }
  if (flag('strip-safe')) opts.strip = { mode: 'safe' };

  if (flag('zopfli') || flag('Z')) {
    const iterationCount = str('zi') !== undefined ? Number(str('zi')) : 15;
    const ziwi = str('ziwi') !== undefined ? Number(str('ziwi')) : Number.MAX_SAFE_INTEGER;
    if (!Number.isInteger(iterationCount) || iterationCount < 1) throw new Error('Invalid --zi value');
    opts.deflater = zopfli({ iterationCount, iterationsWithoutImprovement: ziwi });
  }

  const zcArg = str('zc');
  if (zcArg !== undefined) {
    const v = Number(zcArg);
    if (!Number.isInteger(v) || v < 0 || v > 12) throw new Error(`Invalid compression level: ${zcArg}`);
    opts.deflater = libdeflater(v);
  }

  return {
    outFile,
    outDir,
    opts,
    files: parsed.positionals,
    recursive: flag('recursive'),
    json: flag('json'),
    quiet,
    verbose,
    dryRun,
    sequential: flag('sequential') || threads === 1,
    threads,
  };
}

class HelpRequested extends Error {}
class VersionRequested extends Error {}

function parseNumericRangeOpts(input: string, minValue: number, maxValue: number): number[] {
  const single = Number(input);
  if (Number.isInteger(single) && input.trim() !== '' && single >= minValue && single <= maxValue) return [single];

  const range = input.split('-');
  if (range.length === 2) {
    const first = Number(range[0]);
    const second = Number(range[1]);
    if (Number.isInteger(first) && Number.isInteger(second) && minValue <= first && first < second && second <= maxValue) {
      const out: number[] = [];
      for (let i = first; i <= second; i++) out.push(i);
      return out;
    }
    throw new Error('Invalid option for filters');
  }

  const list = input.split(',');
  if (list.length > 1) {
    const out: number[] = [];
    for (const value of list) {
      const v = Number(value);
      if (!Number.isInteger(v) || v < minValue || v > maxValue) throw new Error('Invalid option for filters');
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }

  throw new Error('Invalid option for filters');
}

function parseSize(input: string): number {
  const match = /^\s*([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)\s*$/.exec(input);
  if (!match) throw new Error(`Invalid size: ${input}`);
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    '': 1,
    b: 1,
    k: 1024,
    kb: 1024,
    kib: 1024,
    m: 1024 * 1024,
    mb: 1024 * 1024,
    mib: 1024 * 1024,
    g: 1024 * 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    gib: 1024 * 1024 * 1024,
  };
  const multiplier = multipliers[unit];
  if (multiplier === undefined) throw new Error(`Invalid size unit: ${unit}`);
  return Math.floor(value * multiplier);
}

function formatBytes(count: number, includeRaw: boolean): string {
  const K = 1024;
  const M = 1024 * 1024;
  const G = 1024 * 1024 * 1024;
  const format3sf = (value: number): string => {
    const abs = Math.abs(value);
    if (abs < 9.995) return value.toFixed(2);
    if (abs < 99.95) return value.toFixed(1);
    return value.toFixed(0);
  };
  const abs = Math.abs(count);
  let formatted: string;
  if (abs < K) formatted = `${count} bytes`;
  else if (abs < M) formatted = `${format3sf(count / K)} KiB`;
  else if (abs < G) formatted = `${format3sf(count / M)} MiB`;
  else formatted = `${format3sf(count / G)} GiB`;
  if (includeRaw && abs >= K) return `${formatted} (${count} bytes)`;
  return formatted;
}

function jsonEscape(string: string): string {
  // Emit ASCII escapes for controls and UTF-16 code units. Besides covering
  // every JSON control character, this avoids alpha 17 JSON.stringify losing
  // Unicode when its escape path converts a string to Porffor's byte strings.
  let escaped = '';
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code === 0x22) escaped += '\\"';
    else if (code === 0x5c) escaped += '\\\\';
    else if (code < 0x20 || code >= 0x7f) escaped += '\\u' + code.toString(16).padStart(4, '0');
    else escaped += string[i];
  }
  return escaped;
}

function outFileToJsonString(input: InFile, output: OutFile): string {
  if (output.kind === 'none') return 'null';
  if (output.kind === 'path') {
    return `"${jsonEscape(output.path ?? inFileToString(input))}"`;
  }
  return 'null';
}

const HELP_TEXT = `oxipng-ts ${'0.1.0'}

A lossless PNG/APNG compression optimizer.

Usage: oxipng-ts [OPTIONS] <FILES>...

Arguments:
  <FILES>...  File(s) to compress (use '-' for stdin)

Options:
  -o, --opt <level>          Optimization level (0-6, or max) [default: 2]
  -r, --recursive            Recurse input directories, optimizing all PNG files
      --dir <directory>      Write output file(s) to <directory>
      --out <file>           Write output file to <file>
      --stdout               Write output to stdout
  -p, --preserve             Preserve file permissions and timestamps if possible
  -d, --dry-run              Do not write any files, only show compression results
  -s                         Strip safely-removable chunks (same as '--strip safe')
      --strip <mode>         Strip metadata (safe, all, or comma-separated list)
      --keep <list>          Strip all metadata except in the comma-separated list
  -a, --alpha                Perform additional alpha channel optimization
  -i, --interlace <mode>     Set PNG interlacing (off, on, keep) [default: off]
      --scale16              Forcibly reduce 16-bit images to 8-bit (lossy)
  -v, --verbose              Show per-file info (use multiple times for more detail)
  -q, --quiet                Suppress all output messages
  -j, --json                 Print results as JSON
  -f, --filters <list>       Filters to try (0-9)
      --fast                 Use fast filter evaluation
      --zc <level>           Deflate compression level (0-12)
      --nb                   Do not change bit depth
      --nc                   Do not change color type
      --np                   Do not change color palette
      --ng                   Do not change to or from grayscale
      --nx                   Do not perform any transformations
      --nz                   Do not recompress unless transformations occur
      --fix                  Disable checksum validation
      --force                Write the output even if it is larger than the input
  -z, --zopfli               Use the much slower but stronger Zopfli compressor
      --zi <iterations>      Number of Zopfli iterations [default: 15]
      --brute-level <level>  Compression level for the Brute filter strategy
      --brute-lines <lines>  Number of lines to compress at once with Brute
      --timeout <secs>       Maximum amount of time to spend on optimizations
      --max-raw-size <bytes> Skip image if the decompressed size exceeds this limit
  -t, --threads <num>        Accepted for oxipng compatibility (runs single-threaded)
      --sequential           Process multiple files sequentially
  -h, --help                 Print help
  -V, --version              Print version
`;

const VERSION = 'oxipng-ts 0.1.0';

/** Run the CLI with the given arguments (excluding node and the script path). */
export function run(argv: string[]): number {
  // Install before parsing: native console.error does not target stderr.
  setLogSink((level, message) => {
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(`\r${message}\n`);
    else process.stderr.write(`${message}\n`);
  });
  let parsed: ParsedCli;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof HelpRequested) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }
    if (err instanceof VersionRequested) {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    logError(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const usingStdin = parsed.files.length === 1 && parsed.files[0] === '-';
  let outFile = parsed.outFile;
  if (usingStdin && parsed.outDir !== null) {
    logError('Cannot use --dir when reading from stdin.');
    return 1;
  }
  if (usingStdin && outFile.kind === 'path' && outFile.path === null) {
    outFile = { kind: 'stdout' };
  }
  const usingStdout = outFile.kind === 'stdout';
  if (usingStdout && parsed.json) {
    logError('Cannot use --json when writing to stdout.');
    return 1;
  }

  const files: Array<[InFile, OutFile]> = usingStdin
    ? [[{ kind: 'stdin' }, outFile]]
    : collectFiles(parsed.files, parsed.outDir, outFile, parsed.recursive, true);

  const isVerbose = parsed.verbose > 0;
  if (isVerbose && !usingStdout) {
    process.stdout.write(`${VERSION}\n\n`);
  }

  const printSummary = !parsed.quiet && !usingStdout;
  const totalFiles = files.length;

  const results: Array<{ ok: true; insize: number; outsize: number } | { ok: false; error: unknown }> = [];
  for (const [input, output] of files) {
    try {
      const r = optimize(input, output, parsed.opts);
      results.push({ ok: true, insize: r[0], outsize: r[1] });
    } catch (err) {
      if (err instanceof PngError && (err.kind === 'ChunkPreventsChanges' || err.kind === 'InflatedDataTooLong')) {
        logWarn(`${inFileToString(input)}: Skipped: ${err.message}`);
      } else {
        logError(`${inFileToString(input)}: ${err instanceof Error ? err.message : String(err)}`);
      }
      results.push({ ok: false, error: err });
    }
  }

  let numSucceeded = 0;
  let numNotOptimized = 0;
  let numFailed = 0;
  let totalIn = 0;
  let totalOut = 0;
  for (const result of results) {
    if (result.ok) {
      numSucceeded += 1;
      totalIn += result.insize;
      totalOut += result.outsize;
      if (!parsed.opts.force && result.insize === result.outsize) numNotOptimized += 1;
    } else if (
      !(result.error instanceof PngError) ||
      (result.error.kind !== 'ChunkPreventsChanges' && result.error.kind !== 'InflatedDataTooLong')
    ) {
      numFailed += 1;
    }
  }

  if (parsed.json) {
    process.stdout.write('{"results":[');
    let first = true;
    results.forEach((result, i) => {
      if (!first) process.stdout.write(',');
      first = false;
      const [input] = files[i];
      process.stdout.write(`{"input":"${jsonEscape(inFileToString(input))}",`);
      if (result.ok) {
        process.stdout.write(
          '"status":"success","output":' +
            outFileToJsonString(input, files[i][1]) +
            ',"insize":' +
            result.insize +
            ',"outsize":' +
            result.outsize +
            '}',
        );
      } else {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        process.stdout.write('"status":"error","error":"' + jsonEscape(message) + '"}');
      }
    });
    process.stdout.write(']}\n');
  } else if (printSummary) {
    const inBytes = formatBytes(totalIn, true);
    const outBytes = formatBytes(totalOut, true);
    const saved = totalIn - totalOut;
    const savedBytes = formatBytes(saved, false);
    const percent = totalIn > 0 ? (saved / totalIn) * 100 : 0;
    if (isVerbose) process.stdout.write('--------------------\n');
    process.stdout.write(`Files processed: ${numSucceeded}/${totalFiles}   \n`);
    process.stdout.write(`Input size: ${inBytes}\n`);
    process.stdout.write(`Output size: ${outBytes}\n`);
    process.stdout.write(`Total saved: ${savedBytes} (${percent.toFixed(2)}%)\n`);
    if (numNotOptimized === 1) process.stdout.write('(1 file could not be optimized further)\n');
    else if (numNotOptimized > 1) process.stdout.write(`(${numNotOptimized} files could not be optimized further)\n`);
    if (parsed.dryRun) process.stdout.write('Dry run, no changes saved\n');
  }

  if (numSucceeded > 0) return 0;
  if (numFailed > 0) return 1;
  return 3;
}

