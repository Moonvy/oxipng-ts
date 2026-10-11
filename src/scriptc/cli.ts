import { run } from '../cli-main.js';

const code: number = run(process.argv.slice(2));
process.exit(code);
