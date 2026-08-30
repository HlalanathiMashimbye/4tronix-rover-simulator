/**
 * Tests for the layering rules themselves.
 *
 * WHY THIS FILE EXISTS. Every other check in this repository can pass while
 * the architecture rots. tsc is happy whether core imports infrastructure or
 * not; eslint has no opinion on which direction a dependency points; the 494
 * behavioural tests pass either way. The iteration 2 marksheet scored
 * Separation of Concerns 2.2/4 on a codebase whose build was entirely green.
 *
 * So the rules are asserted here, as rules, and they fail the build when
 * broken rather than waiting for a marker to notice.
 */

import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..');

/** Every .ts/.tsx under src/<dir>, as paths relative to src, tests excluded. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = join(abs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(child);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(relative(SRC, child));
      }
    }
  };
  walk(join(SRC, dir));
  return out;
}

function read(file: string): string {
  return readFileSync(join(SRC, file), 'utf8');
}

describe('the dependency rule', () => {
  it('core never imports infrastructure', () => {
    const offenders = sourceFiles('core').filter((f) =>
      read(f).includes("from '@/infrastructure")
    );

    expect(offenders).toEqual([]);
  });

  it('core imports nothing from lib except the yard-shared simulator modules', () => {
    /**
     * The five modules in tsconfig.roversim.json are compiled into the yard's
     * offline editor, so their paths are pinned by the build. They are domain
     * code living in lib for that reason alone, and core is allowed to use
     * them. Anything else in lib is off limits.
     */
    const SHARED_WITH_YARD = [
      'roverBlockly', 'rover-physics', 'simulateCommands',
      'parseRoverCode', 'roverSimRender',
    ];

    const offenders: string[] = [];
    for (const file of sourceFiles('core')) {
      for (const match of read(file).matchAll(/from '@\/lib\/([\w-]+)'/g)) {
        if (!SHARED_WITH_YARD.includes(match[1])) {
          offenders.push(`${file} -> @/lib/${match[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('src/lib stays small', () => {
  it('holds only the yard-shared modules and named UI helpers', () => {
    /**
     * lib was the grab-bag: 23 files holding Firebase clients, browser
     * storage, React hooks, CDN loading, domain rules and UI helpers, with
     * nothing in the name to say which was which. Everything with a real
     * home has gone to it. This keeps it from refilling, which a README
     * alone did not do the first time.
     *
     * See src/lib/README.md for why each of these earns its place.
     */
    const SHARED_WITH_YARD = [
      'rover-physics', 'simulateCommands', 'parseRoverCode',
      'roverSimRender', 'roverBlockly',
    ];
    const UI_HELPERS = ['easings', 'missionDuration', 'roverCommandHelp', 'missionRuns'];

    const actual = sourceFiles('lib')
      .map((f) => f.replace(/^lib\//, '').replace(/\.tsx?$/, ''))
      .sort();

    expect(actual).toEqual([...SHARED_WITH_YARD, ...UI_HELPERS].sort());
  });
});

describe('the server/browser boundary', () => {
  it('no client component reaches the privileged container', () => {
    /**
     * container.server.ts builds repositories on the Firebase Admin SDK,
     * which bypasses Firestore rules entirely. A 'use client' file importing
     * it pulls firebase-admin toward the browser bundle - which is how this
     * rule was learnt: merging both builders into one container.ts broke
     * `next build` with 44 module-not-found errors for child_process, dns and
     * fs, because the bundler refused to ship Node internals to a browser.
     *
     * `import 'server-only'` in that file makes this a build error too. This
     * test states the rule in a form a reader can see without running a build.
     */
    const offenders = [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('contexts')]
      .filter((f) => {
        const src = read(f);
        return src.includes("'use client'") && src.includes('container.server');
      });

    expect(offenders).toEqual([]);
  });
});

describe('the composition root', () => {
  it('is the only production code that constructs a repository', () => {
    /**
     * Seven call sites used to do this inline, three of them in one page
     * component, which made a React page the composition root and meant
     * choosing between the privileged Admin SDK and the browser SDK was a
     * decision scattered across the app rather than made once.
     */
    const offenders = [...sourceFiles('app'), ...sourceFiles('components'),
                       ...sourceFiles('core'), ...sourceFiles('lib'),
                       ...sourceFiles('contexts')]
      .filter((f) => read(f).includes('new FirestoreMissionRepository'));

    expect(offenders).toEqual([]);
  });
});
