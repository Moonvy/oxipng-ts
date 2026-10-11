import { run } from '../cli-main.ts';

// Supplied by runtime.ts in the native bundle.
declare function pfArguments(): string[];
declare function pfExit(code: number): void;

pfExit(run(pfArguments()));
