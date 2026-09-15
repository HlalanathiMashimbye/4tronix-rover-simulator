/**
 * Tests for the layering rules themselves.
 *
 * WHY THIS FILE EXISTS. Every other check in this repository can pass while
 * the architecture rots. tsc is happy whether core imports infrastructure or
 * not; eslint has no opinion on which direction a dependency points; every
 * behavioural test passes either way. The iteration 2 marksheet scored
 * Separation of Concerns 2.2/4 on a codebase whose build was entirely green.
 *
 * So the rules are asserted here, as rules, and they fail the build when
 * broken rather than waiting for a marker to notice.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

// Types only: erased at runtime, so the Firebase client is never loaded.
import type { browserMissionRepository } from '@/infrastructure/container.browser';

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
  it('core never imports a Firebase SDK', () => {
    /**
     * Needed on top of the rule below, which only matches our own
     * @/infrastructure paths. MissionNotificationService imported
     * firebase-admin/firestore directly and passed it, so the Admin SDK - the
     * one that ignores every Firestore rule - sat inside the application layer.
     */
    const offenders = sourceFiles('core').filter((f) =>
      /from '(firebase|firebase-admin)(\/[\w-]+)?'/.test(read(f))
    );

    expect(offenders).toEqual([]);
  });

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

  it('domain never imports application', () => {
    /**
     * Application is built from domain, so domain cannot know application
     * exists. The two rules above only watch core's outward edges, and this
     * edge is inside core, so for a while nothing did: ast-allowlist-analyzer
     * imported its own result type back from AllowlistService, which imports
     * the analyser. tsc accepts that cycle, and so does every behavioural test.
     */
    const offenders = sourceFiles('core/domain').filter((f) =>
      /from '(@\/core\/application|(\.\.\/)+application)\//.test(read(f))
    );

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
    const UI_HELPERS = ['easings', 'missionDuration', 'roverCommandHelp', 'missionRuns',
                        'missionClipboard', 'yardConsole'];

    const actual = sourceFiles('lib')
      .map((f) => f.replace(/\\/g, '/').replace(/^lib\//, '').replace(/\.tsx?$/, ''))
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

  it('hands the browser a repository with no way to write', () => {
    /**
     * Checked by the compiler, not by reading source. Each line below names a
     * method the browser must not have. If the browser container ever returns
     * the full repository again, these directives become unused and
     * `next build` (a required CI step) fails with TS2578, as does `tsc`.
     *
     * Not Jest: tsconfig sets isolatedModules, so ts-jest transpiles without
     * type errors and this test passes either way. Widening the container was
     * tried against all three before this comment was written; only the
     * compiler runs caught it.
     */
    type BrowserRepository = ReturnType<typeof browserMissionRepository>;

    // @ts-expect-error - writing a mission is server-only
    type Update = BrowserRepository['update'];
    // @ts-expect-error - so is an operator's bookkeeping
    type Bookkeeping = BrowserRepository['applyBookkeeping'];
    // @ts-expect-error - and deleting a child's mission
    type Delete = BrowserRepository['softDeleteMission'];

    const reads: Array<keyof BrowserRepository> = ['findById', 'findRecent', 'findRuns'];
    expect(reads).toHaveLength(3);
    expect([] as Array<Update | Bookkeeping | Delete>).toEqual([]);
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

  it('is the only production code that builds an application service', () => {
    /**
     * Three routes each assembled the notification service by hand - sender,
     * composer, Firestore, app URL - and two built MissionService beside a
     * container that already exported it. Every copy was a place to wire it
     * differently, and the template for the next route to copy.
     */
    const offenders = [...sourceFiles('app'), ...sourceFiles('components'),
                       ...sourceFiles('core'), ...sourceFiles('lib'),
                       ...sourceFiles('contexts')]
      .filter((f) => /new (MissionNotificationService|MissionService|OperatorMissionCommands)\(/.test(read(f)));

    expect(offenders).toEqual([]);
  });
});

describe('the Copy buttons', () => {
  it('all copy the same payload, through the one helper', () => {
    /**
     * There were two Copy buttons writing two different things: the operator
     * queue wrote a JSON envelope, the mission page wrote bare `mission.code`.
     * Copying from the mission page - the obvious place, since that is where
     * you are when you are looking at a mission - therefore pasted into the
     * run station as anonymous Python, leaving the mission id and the run id
     * empty. The run id is the recording's filename, so those runs recorded to
     * a file that could not be matched back to a mission.
     *
     * A static check rather than a render, because the failure was two call
     * sites drifting apart, not either one misbehaving on its own.
     */
    const offenders: string[] = [];
    for (const dir of ['app', 'components']) {
      for (const file of sourceFiles(dir)) {
        for (const match of read(file).matchAll(/clipboard\.writeText\(([^;]*?)\)\s*;/g)) {
          const argument = match[1].trim();
          // Only the ones copying a mission's code. A button copying a link or
          // a description is not part of this contract.
          if (!/\bcode\b/.test(argument)) continue;
          if (!argument.includes('missionClipboardText(')) {
            offenders.push(`${file} -> clipboard.writeText(${argument})`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the agent instructions', () => {
  /**
   * AGENTS.md tells every model working here what the layering rules are and
   * that core depends outward on nothing. It is only load-bearing if the tools
   * that read it actually reach it, and only trustworthy if there is exactly
   * one copy - a rule written in two places is the drift the file itself warns
   * about.
   */
  const root = (name: string) => readFileSync(join(SRC, '..', '..', name), 'utf8');

  it('is reachable by Claude, Copilot and anything reading AGENTS.md', () => {
    expect(root('AGENTS.md')).toContain('core');
    // Claude Code reads CLAUDE.md; the @ syntax imports rather than copies.
    expect(root('CLAUDE.md').trim()).toBe('@AGENTS.md');
    expect(root('.github/copilot-instructions.md')).toContain('AGENTS.md');
  });

  it('has one copy of the rules, not three', () => {
    // The giveaway would be CLAUDE.md growing into a second full document.
    expect(root('CLAUDE.md').split('\n').filter(Boolean).length).toBe(1);
  });

  it('points at rules that exist', () => {
    const agents = root('AGENTS.md');
    for (const path of [
      'mission-control/src/__tests__/unit/architecture.test.ts',
      'mission-control/src/lib/README.md',
      'yard/rover/drivers.py',
      'yard/satellite/camera_state.py',
    ]) {
      expect(agents).toContain(path.split('/').pop()!);
      expect(existsSync(join(SRC, '..', '..', path))).toBe(true);
    }
  });
});

/**
 * The workspace split grid sizes itself from its parent, and nothing restates
 * how tall the chrome above it is.
 *
 * This had drifted the expensive way: the grid carried
 * `calc(100vh - 122px)` - a second, hardcoded opinion about the navbar, page
 * padding and page header that the pages above it already own. The two
 * disagreed by more than 122px the moment Create Mission showed its "Imported
 * from Challenge" banner, and because that main is overflow-hidden the grid
 * ran off the bottom of the page and took the Send button with it, with no
 * scrollbar to hint anything was there.
 *
 * Asserted here rather than in a component test because no rendering test can
 * see it: jsdom has no layout, so the grid is 0x0 either way and every
 * behavioural test passes with the page clipped.
 */
describe('the workspace split grid', () => {
  const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
  // Comments stripped: these assert the declarations, not the prose that
  // explains them - and the prose here necessarily quotes the old bad value.
  const grid = css
    .slice(css.indexOf('.workspaceSplitGrid {'), css.indexOf('.workspaceSplitDivider {'))
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('exists to be read', () => {
    expect(grid).toContain('grid-template-columns');
  });

  it('never hardcodes a guess at the chrome stacked above it', () => {
    // Any viewport unit minus a pixel constant is the shape of the bug: it can
    // only ever be right for one page at one header height.
    expect(grid).not.toMatch(/calc\([^)]*\b\d+(vh|dvh|svh|lvh)\b[^)]*-[^)]*px/);
  });

  it('takes the space its flex column has left', () => {
    expect(grid).toMatch(/flex:\s*1\s+1\s+0%/);
    // Without this a grid row taller than the remainder refuses to shrink,
    // which is the same clipping by another route.
    expect(grid).toMatch(/min-height:\s*0/);
  });

  it('is sized by parents that are actually flex columns', () => {
    // A flexible track under a parent that is not a flex container collapses.
    for (const file of [
      join(SRC, 'app', 'mission', 'page.tsx'),
      join(SRC, 'app', 'missions', '[missionId]', 'MissionVideoClient.tsx'),
    ]) {
      const parent = readFileSync(file, 'utf8');
      expect(parent).toMatch(/className="mx-auto flex [^"]*flex-col/);
      expect(parent).toMatch(/min-h-0/);
    }
  });
});
