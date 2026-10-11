import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from './cli-main.ts';

export { parseCliArgs, run } from './cli-main.ts';

const thisFile = realpathSync(fileURLToPath(import.meta.url));
const entry = process.argv[1] ? realpathSync(resolve(process.argv[1])) : '';
if (entry === thisFile) {
  process.exitCode = run(process.argv.slice(2));
}
