/**
 * No learner-facing screen says "Failed" (AB#448).
 *
 * A test a learner has not passed yet is work still to do, and a mission that
 * did not run is shown as Pending (discoveryStatus), so "failed" is a word a
 * child should never read here. Asserted over the source because no single
 * behavioural test can visit every screen, and a new error message is exactly
 * where the word creeps back in.
 *
 * What it reads: the text a learner can be shown - string literals and JSX
 * text - in every component and page except the operator console and API
 * routes, plus the challenge content. Not comments, not console logging, not
 * thrown errors (developers read those), and not the status value 'failed'
 * itself, which is data a component maps to a softer label.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..');

function learnerFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (!['operator', 'api', '__tests__', 'node_modules'].includes(name)) walk(path);
      } else if (/\.tsx?$/.test(name)) {
        out.push(path);
      }
    }
  };
  walk(join(SRC, 'components'));
  walk(join(SRC, 'app'));
  out.push(join(SRC, 'infrastructure', 'config', 'challenges.ts'));
  return out;
}

/** Displayed text in a source file: string literals and JSX text, minus developer-only lines. */
function displayedText(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .filter((line) => !/console\.\w+\(|throw |new Error\(/.test(line))
    .join('\n');
  // A quoted string on one line, escapes included.
  const literals = [...code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);
  // Across lines: JSX text usually sits on its own line between the tags.
  const jsxText = [...code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]);
  return [...literals, ...jsxText].filter((text) => text !== 'failed');
}

it('no learner-facing text says "failed"', () => {
  const offenders = learnerFiles().flatMap((file) =>
    displayedText(readFileSync(file, 'utf8'))
      .filter((text) => /\bfail(ed|s|ure)?\b/i.test(text))
      .map((text) => `${relative(SRC, file)}: ${text}`),
  );
  expect(offenders).toEqual([]);
});
