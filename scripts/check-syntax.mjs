import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
import { inlineScripts, readIndex } from '../tests/helpers/dashboard.mjs';

const html = readIndex();
const scripts = inlineScripts(html);
for (const { source, line } of scripts) {
  new Script(source, { filename: 'index.html', lineOffset: line - 1 });
}
console.log(`JavaScript syntax OK: ${scripts.length} inline script(s) in index.html`);

function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(path);
    else if (/\.(?:c?js|mjs)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
checkDirectory('scripts');
checkDirectory('tests');
console.log('JavaScript syntax OK: scripts/ and tests/');
