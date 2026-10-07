// Builds the extension into dist/, the folder Chrome loads.
//
//   node scripts/build.ts           production build
//   node scripts/build.ts --watch   rebuild on change, with source maps
//
// Output is bundled but not minified, so reviewers can read what ships.

import { cpSync, mkdirSync, rmSync, watch } from 'node:fs';
import * as esbuild from 'esbuild';

const WATCH = process.argv.includes('--watch');
const OUT = 'dist';

// Static files copied as-is: source path -> path inside dist/.
const STATIC: [string, string][] = [
  ['src/manifest.json', 'manifest.json'],
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
  ['src/options/options.html', 'options/options.html'],
  ['src/options/options.css', 'options/options.css'],
  ['src/ui/common.css', 'ui/common.css'],
  ['icons', 'icons'],
  ['LICENSE', 'LICENSE'],
  ['node_modules/jsqr/LICENSE', 'licenses/jsQR.txt'],
];

function copyStatic(): void {
  for (const [from, to] of STATIC) {
    cpSync(from, `${OUT}/${to}`, { recursive: true });
  }
}

const options: esbuild.BuildOptions = {
  entryPoints: {
    background: 'src/background.ts',
    'popup/popup': 'src/popup/popup.ts',
    'options/options': 'src/options/options.ts',
  },
  outdir: OUT,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome116',
  // fillCode() and friends are serialized with toString() and injected into
  // pages, so the output must not reference helpers like __name.
  keepNames: false,
  minify: false,
  legalComments: 'eof',
  sourcemap: WATCH ? 'linked' : false,
  logLevel: 'info',
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyStatic();

if (WATCH) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  for (const dir of ['src', 'icons']) {
    watch(dir, { recursive: true }, (_event, file) => {
      if (file && !file.endsWith('.ts')) copyStatic();
    });
  }
  console.log('Watching for changes. Reload the extension in chrome://extensions after edits.');
} else {
  await esbuild.build(options);
}
