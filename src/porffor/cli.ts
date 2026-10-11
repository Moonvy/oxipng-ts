import { run } from '../cli-main.js';

// Supplied by runtime.ts in the native bundle.
declare function pfArguments(): string[];
declare function pfExit(code: number): void;

pfExit(run(pfArguments()));
