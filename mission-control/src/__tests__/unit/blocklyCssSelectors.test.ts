/**
 * Every Blockly class our CSS styles must exist in the Blockly we ship.
 *
 * Blockly renames its classes between majors. Ours were written against an
 * older Blockly: .blocklyToolboxDiv (now .blocklyToolbox), .blocklyTreeRow and
 * .blocklyTreeLabel matched nothing in Blockly 12, so the toolbox's widths,
 * border and label colours had silently stopped applying, and nothing failed.
 * They were found by accident while laying out the phone toolbox (AB#455).
 * A rule that matches nothing looks exactly like one that works.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');
// By path: the package's exports map does not expose this file to require.
const blockly = readFileSync(join(__dirname, '..', '..', '..', 'node_modules', 'blockly', 'blockly.min.js'), 'utf8');

it('styles only Blockly classes that the installed Blockly renders', () => {
  const ours = new Set(css.match(/\.blockly[A-Z][A-Za-z]*/g) ?? []);
  expect(ours.size).toBeGreaterThan(0);

  const missing = [...ours].map((selector) => selector.slice(1)).filter((name) => !blockly.includes(name));
  expect(missing).toEqual([]);
});
