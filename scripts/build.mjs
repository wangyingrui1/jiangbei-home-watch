import { mkdir, copyFile, cp, access, readdir, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ROOT } from './lib.mjs';
import { validate } from './validate.mjs';

await validate();
const out = resolve(ROOT, 'dist');
// Cleanup is deliberately scoped to the build directory under this repository.
if (out !== resolve(ROOT, 'dist') || !out.startsWith(ROOT + '\\') && !out.startsWith(ROOT + '/')) throw new Error('Unsafe build target');
async function empty(dir) {
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { await empty(path); await rmdir(path); } else await unlink(path);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await empty(out);
await mkdir(out, { recursive: true });
for (const path of ['index.html', 'app.js']) await copyFile(resolve(ROOT, path), resolve(out, path));
for (const path of ['style.css', 'styles.css', 'favicon.svg']) {
  try { await access(resolve(ROOT, path)); await copyFile(resolve(ROOT, path), resolve(out, path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const path of ['assets', 'data']) await cp(resolve(ROOT, path), resolve(out, path), { recursive: true });
console.log('Static site built in dist/.');
