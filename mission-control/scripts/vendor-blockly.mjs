#!/usr/bin/env node
/**
 * Copy Blockly's browser build into the yard, so /code/ works with no internet.
 *
 * WHY THIS EXISTS
 *
 * The yard's editor loaded Blockly from unpkg.com. The satellite runs on mobile
 * data at a venue and is expected to keep working when that drops, which is the
 * platform's central promise - and the one page a child actually touches could
 * not load its editor without a working connection to a CDN.
 *
 * There was a service worker meant to cover this. It cached
 * `https://unpkg.com/blockly/blockly.min.js` while the page requested
 * `https://unpkg.com/blockly@13.2.0/blockly.min.js`. Different URLs, so the
 * cache entry never matched the request and had never worked.
 *
 * IT ALSO FIXES A VERSION SPLIT. The yard asked for 13.2.0 while Mission
 * Control bundles 12.5.1, so the two editors that share defineRoverBlocks were
 * running different libraries. This copies the version mission-control actually
 * depends on, which is the one the shared block definitions are tested against.
 *
 * The output IS committed, for the same reason the compiled simulator is: the
 * satellite must stay deployable by git-pull with no Node toolchain on the Pi.
 * `npm run check:vendor` re-runs this and fails if the committed copy has
 * drifted from the installed package.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'blockly');
const outDir = join(root, '..', 'yard', 'satellite', 'static', 'vendor', 'blockly');
const checkOnly = process.argv.includes('--check');

const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version;

/**
 * blockly.min.js is the browser bundle; media/ holds the icons, cursors and the
 * click/delete sounds Blockly plays. Blockly resolves media at runtime from the
 * `media` option, which the templates point at this directory.
 */
const files = [
  { from: join(src, 'blockly.min.js'), to: 'blockly.min.js' },
  ...readdirSync(join(src, 'media'))
    .filter((f) => statSync(join(src, 'media', f)).isFile())
    .map((f) => ({ from: join(src, 'media', f), to: join('media', f) })),
];

mkdirSync(join(outDir, 'media'), { recursive: true });

const stale = [];
for (const { from, to } of files) {
  const target = join(outDir, to);
  const next = readFileSync(from);
  const current = existsSync(target) ? readFileSync(target) : null;

  if (current === null || !current.equals(next)) {
    stale.push(to);
    if (!checkOnly) writeFileSync(target, next);
  }
}

// A note beside the binaries, since nothing about a .min.js says where it came
// from or that editing it is pointless.
const readme = `Vendored from the \`blockly\` npm package, version ${version}.

GENERATED - do not edit. Run \`npm run build:vendor\` in mission-control.

Committed on purpose: the satellite deploys by git-pull with no Node toolchain,
and /code/ must load with no internet. See scripts/vendor-blockly.mjs.
`;
const readmePath = join(outDir, 'README.md');
const readmeStale = !existsSync(readmePath) || readFileSync(readmePath, 'utf8') !== readme;
if (readmeStale) {
  stale.push('README.md');
  if (!checkOnly) writeFileSync(readmePath, readme);
}

if (checkOnly) {
  if (stale.length) {
    console.error(
      `vendor-blockly --check: committed Blockly is out of date (${stale.length} file(s)). ` +
        'Run `npm run build:vendor` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`vendor-blockly --check: up to date (Blockly ${version})`);
} else {
  console.log(`vendor-blockly: wrote Blockly ${version} to ${outDir} (${files.length + 1} files)`);
}
