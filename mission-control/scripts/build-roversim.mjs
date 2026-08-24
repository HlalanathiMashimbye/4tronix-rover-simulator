#!/usr/bin/env node
/**
 * Build the shared rover simulator into ES modules the yard satellite serves.
 *
 * WHY THIS EXISTS
 * The monitor page (yard/satellite/templates/monitor.html) animates a fake
 * rover on the same canvas that normally shows the camera. Rather than write
 * a second physics + renderer in JavaScript-for-the-satellite, it loads the
 * compiled output of mission-control's own simulator, so both surfaces move
 * identically because they are running identical code.
 *
 * WHAT IT DOES
 *   1. tsc -p tsconfig.roversim.json  -> plain ES2020 modules
 *   2. rewrites tsc's extensionless relative imports ('./rover-physics') to
 *      './rover-physics.js', which is what a browser's native module loader
 *      requires and what tsc does not emit for a "module": "ES2020" target
 *   3. stamps a header saying the files are generated
 *
 * roverBlockly.ts is built here too. The yard editor (code.html) used to carry
 * its own copy of all 16 block definitions, the toolbox and the Python
 * generator - byte-identical to the TypeScript, kept in step by a comment in
 * each copy asking humans to mirror their changes. It now imports this output,
 * so a block can only be defined once.
 *
 * The output IS committed, so the satellite stays deployable by git-pull with
 * no Node toolchain on the Pi. `npm run check:roversim` re-runs the build and
 * fails if the committed output differs, so the copy cannot silently drift
 * from the TypeScript it came from.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '..', 'yard', 'satellite', 'static', 'roversim');
const checkOnly = process.argv.includes('--check');

const HEADER = `// GENERATED FILE - DO NOT EDIT.
// Built from mission-control/src/lib by scripts/build-roversim.mjs.
// Edit the TypeScript source and re-run \`npm run build:roversim\`.
`;

// --- 1. Compile -------------------------------------------------------------
const before = new Map();
try {
  for (const f of readdirSync(outDir)) {
    before.set(f, readFileSync(join(outDir, f), 'utf8'));
  }
} catch { /* first run - no output dir yet */ }

execFileSync('npx', ['tsc', '-p', 'tsconfig.roversim.json'], { cwd: root, stdio: 'inherit' });

// --- 3. Make the emitted modules browser-loadable ---------------------------
// tsc leaves relative imports extensionless; a browser resolving
// './rover-physics' asks the server for a file of that exact name and 404s.
const written = [];
for (const file of readdirSync(outDir).filter((f) => f.endsWith('.js'))) {
  const path = join(outDir, file);
  let src = readFileSync(path, 'utf8');
  src = src.replace(/(\bfrom\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (m, a, spec, b) =>
    spec.endsWith('.js') ? m : `${a}${spec}.js${b}`
  );
  if (!src.startsWith('// GENERATED FILE')) src = HEADER + src;
  writeFileSync(path, src);
  written.push(file);
}

// --- 4. In --check mode, fail if the committed output is stale ---------------
if (checkOnly) {
  const changed = written.filter((f) => before.get(f) !== readFileSync(join(outDir, f), 'utf8'));
  if (changed.length || before.size !== written.length) {
    console.error(
      'build-roversim --check: committed simulator output is out of date ' +
      `(${changed.join(', ') || 'file list changed'}).\n` +
      'Run `npm run build:roversim` and commit the result.'
    );
    process.exit(1);
  }
  console.log(`build-roversim --check: up to date (${written.length} modules)`);
} else {
  console.log(`build-roversim: wrote ${written.length} modules to ${outDir}`);
}
