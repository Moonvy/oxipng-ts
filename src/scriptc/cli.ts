import { run } from '../cli-main.ts';

const code: number = run(process.argv.slice(2));
process.exit(code);
