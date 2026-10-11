import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './cli-main.js';

export { parseCliArgs, run } from './cli-main.js';

const thisFile = fileURLToPath(import.meta.url);
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === resolve(thisFile)) {
  process.exitCode = run(process.argv.slice(2));
}
