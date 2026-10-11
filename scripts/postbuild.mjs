#!/usr/bin/env node
// Ensures the CLI bundle is directly executable by prepending a shebang and
// setting the executable bit. Bundlers do not always preserve the source shebang.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(root, 'dist', 'js', 'cli.js');

try {
  let contents = await readFile(cliPath, 'utf8');
  if (!contents.startsWith('#!')) {
    contents = `#!/usr/bin/env node\n${contents}`;
  }
  await writeFile(cliPath, contents);
  await chmod(cliPath, 0o755);
  console.log('postbuild: prepared dist/js/cli.js');
} catch (err) {
  if (err.code === 'ENOENT') {
    console.warn('postbuild: dist/js/cli.js not found, skipping');
  } else {
    throw err;
  }
}
