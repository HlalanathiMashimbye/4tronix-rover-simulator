#!/usr/bin/env node
/**
 * Copy Mission Control's design tokens into the yard, so both apps share one look.
 *
 * WHY THIS EXISTS
 *
 * Send to Rover moves the operator from Mission Control to the yard console
 * on the satellite, and the two looked like different apps. The yard's
 * yard-base.css carried a hand-copied set of Mission Control's tokens, taken
 * from the dark theme once and never updated: Mission Control went on to add
 * the light "Paper & Ink" theme, which most laptops show, and the yard never
 * got it. An operator on a light-mode laptop pressed Send and landed on a dark
 * space theme.
 *
 * WHAT IT DOES
 *
 * Reads the three token blocks in mission-control/src/app/globals.css -
 * `:root` (the dark fallback before a theme is chosen), `[data-theme="dark"]`
 * and `[data-theme="light"]` - and writes their custom properties to
 * yard/satellite/static/yard-theme.css, which yard-base.css imports.
 *
 * Everything in those blocks is copied except the height of Mission Control's
 * navbar and tab bar, which describe its own page rather than its look. Two
 * more things come across because the yard's components are built from them:
 * the radius scale from `@theme inline` (--radius-lg is a button, --radius-3xl
 * a panel), and the `clay` utility's shadow, as --shadow-clay, which is the
 * lift on every Mission Control card and primary button.
 *
 * The output IS committed, for the same reason the simulator and Blockly are:
 * the satellite deploys by git pull and has no Node toolchain. `npm run
 * check:yard-theme` rebuilds it and fails if the committed copy differs, so a
 * colour changed in Mission Control cannot silently stay the old colour in the
 * yard.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src', 'app', 'globals.css');
const target = join(root, '..', 'yard', 'satellite', 'static', 'yard-theme.css');
const checkOnly = process.argv.includes('--check');

const BLOCKS = [':root', '[data-theme="dark"]', '[data-theme="light"]'];

/** Mission Control's page chrome, not its palette. */
const NOT_COPIED = new Set(['--app-chrome', '--app-bottom-chrome']);

const css = readFileSync(source, 'utf8');

/**
 * The declarations inside one top-level block, comments removed.
 *
 * Matched from the selector at the start of a line, so `[data-theme="light"]
 * body::before` further down the file is never mistaken for the token block.
 * None of these blocks nests braces, so the first `}` closes it.
 */
function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`^${escaped}\\s*\\{`, 'm').exec(css);
  if (!open) throw new Error(`build-yard-theme: no \`${selector} {\` block in globals.css`);
  const start = open.index + open[0].length;
  const body = css.slice(start, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '');

  return body
    .split(';')
    .map((part) => part.trim().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')'))
    .filter((part) => part.startsWith('--'))
    .map((part) => {
      const colon = part.indexOf(':');
      return { name: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() };
    })
    .filter(({ name }) => !NOT_COPIED.has(name));
}

/** The value of one property inside a block, e.g. the clay utility's box-shadow. */
function property(selector, prop) {
  const block = declarationsOf(selector);
  const found = block.find(({ name }) => name === prop);
  if (!found) throw new Error(`build-yard-theme: \`${selector}\` has no ${prop}`);
  return found.value;
}

// Every declaration in a block, custom property or not. declarations() keeps
// the custom properties; the clay utility is a plain box-shadow.
function declarationsOf(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`^${escaped}\\s*\\{`, 'm').exec(css);
  if (!open) throw new Error(`build-yard-theme: no \`${selector} {\` block in globals.css`);
  const start = open.index + open[0].length;
  return css.slice(start, css.indexOf('}', start))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((part) => part.trim().replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')'))
    .filter((part) => part.includes(':'))
    .map((part) => {
      const colon = part.indexOf(':');
      return { name: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim() };
    });
}

let out = `/*
 * GENERATED FILE - DO NOT EDIT.
 * Mission Control's design tokens - both colour themes, the radius scale and
 * the clay shadow - copied from mission-control/src/app/globals.css by
 * mission-control/scripts/build-yard-theme.mjs. Change them there and run
 * \`npm run build:yard-theme\`; CI fails while this copy is out of date.
 */
`;

for (const selector of BLOCKS) {
  out += `\n${selector} {\n`;
  for (const { name, value } of declarations(selector)) out += `  ${name}: ${value};\n`;
  if (selector === ':root') {
    for (const { name, value } of declarationsOf('@theme inline')) {
      if (name.startsWith('--radius-')) out += `  ${name}: ${value};\n`;
    }
    out += `  --shadow-clay: ${property('@utility clay', 'box-shadow')};\n`;
  }
  out += '}\n';
}

let before = null;
try {
  before = readFileSync(target, 'utf8');
} catch { /* first run */ }

if (checkOnly) {
  if (before !== out) {
    console.error(
      'build-yard-theme --check: yard/satellite/static/yard-theme.css is out of date with globals.css.\n' +
      'Run `npm run build:yard-theme` and commit the result.'
    );
    process.exit(1);
  }
  console.log('build-yard-theme --check: up to date');
} else {
  writeFileSync(target, out);
  console.log(`build-yard-theme: wrote ${target}`);
}
