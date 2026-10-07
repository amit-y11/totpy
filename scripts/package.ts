// Builds and zips dist/ for the Chrome Web Store: release/totpy-<version>.zip

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

execFileSync(process.execPath, ['scripts/build.ts'], { stdio: 'inherit' });

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8')) as { version: string };
const out = resolve(`release/totpy-${version}.zip`);
mkdirSync('release', { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-rq', out, '.', '-x', '*.DS_Store', '*.map'], {
  cwd: 'dist',
  stdio: 'inherit',
});
console.log(out);
