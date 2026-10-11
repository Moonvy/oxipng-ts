import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { Deadline } from './deadline.ts';
import { PngError, type OptimizationResult } from './error.ts';
import { logInfo, logWarn } from './log.ts';
import { Options } from './options.ts';
import { isFullyOptimized, optimizePng } from './optimize.ts';
import { PngData } from './png/index.ts';

/** Where to read an image from. */
export type InFile = { kind: 'path'; path: string } | { kind: 'stdin' };

/** Where to write the optimized image. */
export type OutFile =
  | { kind: 'none' }
  | { kind: 'path'; path: string | null; preserveAttrs: boolean }
  | { kind: 'stdout' };

export function inFileFromPath(path: string): InFile {
  return { kind: 'path', path };
}

export function outFileFromPath(path: string): OutFile {
  return { kind: 'path', path, preserveAttrs: false };
}

export function inFileToString(input: InFile): string {
  return input.kind === 'path' ? input.path : 'stdin';
}

function readInput(input: InFile): Uint8Array {
  if (input.kind === 'stdin') {
    return new Uint8Array(readFileSync(0));
  }
  try {
    return new Uint8Array(readFileSync(input.path));
  } catch (err) {
    throw PngError.readFailed(input.path, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Perform optimization on the input file using the options provided.
 * Returns the original and optimized file sizes.
 */
export function optimize(input: InFile, output: OutFile, opts: Options): OptimizationResult {
  logInfo(`Processing: ${inFileToString(input)}`);
  const deadline = new Deadline(opts.timeout, logWarn);

  const inData = readInput(input);
  const png = PngData.fromSlice(inData, opts);

  let optimizedOutput = optimizePng(png, inData, opts, deadline);
  const inLength = inData.length;

  if (isFullyOptimized(inLength, optimizedOutput.length, opts)) {
    if (
      output.kind === 'path' &&
      input.kind === 'path' &&
      (output.path === null || output.path === input.path)
    ) {
      logInfo(`Could not optimize further, no change written: ${inFileToString(input)}`);
      return [inLength, inLength];
    }
    optimizedOutput = inData;
  }

  const savings = formatSavings(inLength, optimizedOutput.length);

  if (output.kind === 'none') {
    logInfo(`${savings}: Dry run, no output`);
  } else if (output.kind === 'stdout' || (output.kind === 'path' && output.path === null && input.kind === 'stdin')) {
    process.stdout.write(optimizedOutput);
    logInfo(`${savings}: stdout`);
  } else if (output.kind === 'path') {
    const inputMetadata = output.preserveAttrs && input.kind === 'path' ? safeStat(input.path) : null;
    const outputPath = output.path ?? (input.kind === 'path' ? input.path : null);
    if (outputPath === null) throw PngError.writeFailed('stdout', 'no output path');
    try {
      const dir = dirname(outputPath);
      if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
      writeFileSync(outputPath, optimizedOutput);
    } catch (err) {
      throw PngError.writeFailed(outputPath, err instanceof Error ? err.message : String(err));
    }
    if (inputMetadata) {
      try {
        utimesSync(outputPath, inputMetadata.atime, inputMetadata.mtime);
        chmodSync(outputPath, inputMetadata.mode);
      } catch (err) {
        logWarn(`Unable to preserve attributes on ${outputPath}: ${err}`);
      }
    }
    logInfo(`${savings}: ${outputPath}`);
  }

  return [inLength, optimizedOutput.length];
}

function safeStat(path: string): { atime: Date; mtime: Date; mode: number } | null {
  try {
    const s = statSync(path);
    return { atime: s.atime, mtime: s.mtime, mode: s.mode };
  } catch (err) {
    logWarn(`Unable to read metadata from ${path}: ${err}`);
    return null;
  }
}

function formatSavings(input: number, output: number): string {
  if (input >= output) {
    const percent = ((input - output) / input) * 100;
    return `${output} bytes (${percent.toFixed(2)}% smaller)`;
  }
  const percent = ((output - input) / input) * 100;
  return `${output} bytes (${percent.toFixed(2)}% larger)`;
}

/** Recursively collect input/output file pairs, mirroring oxipng's CLI behaviour. */
export function collectFiles(
  inputs: string[],
  outDir: string | null,
  outFile: OutFile,
  recursive: boolean,
  topLevel = true,
): Array<[InFile, OutFile]> {
  const pairs: Array<[InFile, OutFile]> = [];
  for (const input of inputs) {
    let isDir = false;
    try {
      isDir = statSync(input).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir) {
      if (recursive) {
        try {
          const entries = readdirSync(input).map((name) => `${input}/${name}`);
          pairs.push(...collectFiles(entries, outDir, outFile, recursive, false));
        } catch (err) {
          logWarn(`${input}: ${err}`);
        }
      } else {
        logWarn(`${input} is a directory, skipping`);
      }
      continue;
    }

    if (!topLevel) {
      const lower = input.toLowerCase();
      if (!lower.endsWith('.png') && !lower.endsWith('.apng')) continue;
    }

    let out: OutFile = outFile;
    if (outDir !== null && outFile.kind === 'path') {
      const base = input.split('/').pop() ?? input;
      out = { kind: 'path', path: `${outDir}/${base}`, preserveAttrs: outFile.preserveAttrs };
    }
    pairs.push([inFileFromPath(input), out]);
  }
  return pairs;
}

export { optimizeFromMemory, Options } from './index.ts';
