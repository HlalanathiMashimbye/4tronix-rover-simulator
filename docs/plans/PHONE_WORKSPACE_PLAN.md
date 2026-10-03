# Phone workspace: execution brief

Self-contained. Assumes no conversation context. Read `AGENTS.md` at the repo
root first; its rules (layers, tests that can fail, no duplicated rules,
comments explain why) apply to every phase. House style: **no em dashes
anywhere**, in code, comments, commits or PR text.

Board: this is the prerequisite for **AB#455** (finish challenges on a phone).
Put `Refs AB#455` in every PR title and commit. Stack the PRs, one per phase,
each on the previous branch.

## The problem, measured

`/mission` at 375x812 (iPhone-sized), Blocks mode, before this work:

| Fact | Value |
|---|---|
| Page height | 1381px in an 812px viewport (the page scrolls) |
| Simulator canvas top | 781px, below the fold |
| Blockly canvas width | ~210px of 321px; the category column takes a third |
| Chrome above the editor | ~250px (navbar, "Build your Mission", subtitle, tabs) |
| Floating Create Mission button | sits over the bottom-right of the canvas |

Consequences a learner hits:

1. Blocks and the rover are never on screen together, so the running-block
   highlight (AB#450) is invisible on a phone.
2. Dragging a block competes with scrolling the page; a drag starting near an
   edge scrolls instead.
3. Blocks run off the right edge, under Blockly's zoom buttons.

Root cause: below `md` the desktop layout is stacked, not redesigned.
`.workspaceSplitGrid` in `src/app/globals.css` (around line 703) explicitly
lets the page grow and gives each stacked panel a `70vh` floor.

## The decided layout ("docked sim")

Chosen by the product owner over "Build/Watch tabs" and "floating mini-sim".

```
+---------------------+
| <  [D][B][Py]  Run  Send |  top bar, ~48px
+---------------------+
|  rover sim  ~30%    |  docked strip; tap to expand
+---------------------+
|                     |
|  editor (fills)     |  Blocks / Python / Drive controls
|                     |
+---------------------+
| Move Light Loop ... |  Blockly categories, bottom strip (Blocks only)
+---------------------+
```

Rules for the whole layout:

- **The page never scrolls** at 360x640, 375x667, 390x844 and 412x915.
  Check with `document.documentElement.scrollHeight <= innerHeight`.
- Use `100dvh`, not `100vh`. Mobile Safari's `100vh` includes the area under
  the URL bar, which is exactly the clipping this work exists to remove.
- The sim stays docked while a run plays, so the highlight and the rover are
  visible together. Run does NOT expand the sim.
- **Desktop and tablet (`md` and up) must not change.** Screenshot `/mission` at
  1280x800 before phase 1 and compare after every phase.

## Where "is this a phone" is decided

One place: a new hook `src/hooks/useIsPhoneLayout.ts`.

- `matchMedia('(max-width: 767px)')`, matching Tailwind's `md` breakpoint so CSS
  and JS never disagree. Subscribe to `change`.
- Returns `false` during SSR and the first client render (the component is
  server-rendered first; see the hydration comment on `missionName` in
  `MissionWorkspace.tsx`), then the real value after mount.
- Every phone-only branch in JS reads this hook. Pure CSS differences use the
  `md:` prefix. Never a second media query string in JS.
- Add it to the hooks list in any README that lists `src/hooks`.

Test: `src/__tests__/unit/useIsPhoneLayout.test.tsx` with a `matchMedia` mock;
assert false-then-true on a phone, and that a `change` event flips it.

## Phase 1: the phone shell (PR 1)

Goal: on a phone, `/mission` is exactly one screen tall, with no page header
and no navbar furniture over it. The panels are still the old ones, stacked.

1. `src/lib/appSurfaces.ts`: add `isBuildSurface(pathname)` for `/mission`
   (exact path or `/mission/...`, NOT `/missions`). Same style and reasoning
   as `isOperatorSurface`. Update `src/lib/README.md`'s line for the file.
2. `src/components/layout/Navbar.tsx`: below `md`, on the build surface, hide
   the bottom tab bar (line ~222) and the floating Create Mission button
   (line ~259). The learner is already creating a mission; the phone shell's
   own back button replaces the tab bar.
3. `src/app/mission/page.tsx`: below `md`, drop the `<header>` (keep it from
   `md` up) and pin `<main>` to `h-[100dvh] overflow-hidden`. Today it is
   `md:h-page md:overflow-hidden` with free growth below `md`.
4. Gate: tsc, jest, the no-scroll check at all four phone sizes (the content
   inside may still be cramped; that is phases 2 and 3), desktop screenshot
   unchanged.

Tests: extend the existing navbar tests (find them with
`grep -rln "Navbar" src/__tests__`) to assert the FAB and tab bar are absent on
`/mission` and present on `/`. Break each check on purpose and watch it fail.

## Phase 2: the docked sim (PR 2)

1. New `src/components/mission/PhoneWorkspace.tsx`. `MissionWorkspace` keeps
   ALL state and handlers; it renders `<SplitPane>` from `md` up and
   `<PhoneWorkspace>` on a phone, passing the same props. No state moves.
   (That is the point: run, submit, highlight and reset logic stay single.)
2. Top bar (~48px): back link to `/`, the three mode buttons as icon-only
   segmented control (reuse `MODES` from `EditorPanel.tsx`, export it rather
   than copying), Run, Send. Run calls the active editor's run. Today each
   editor owns its Run button, so lift it: give `BlocklyEditor` and
   `PythonCodeEditor` an imperative `runRef` or a `runRequest` counter prop,
   and hide their own Run buttons on a phone. Pick one approach and use it
   for both editors.
3. Sim strip: `<RoverSimulator bare>` (the `bare` prop already exists for the
   run player) at `30dvh`. Its scrubber and Play/Reset overlay the canvas in
   `bare` mode already. A tap on the canvas toggles an expanded state at
   `70dvh`; a chevron handle collapses it. Animate height with the house
   easings in `src/lib/easings.ts`; no animation under reduced motion.
4. Editor area: `flex-1 min-h-0`, the active editor with its own Run button
   hidden.
5. Drive mode: the manual controls go in the editor area. Check they fit at
   360x640.
6. Gate: no page scroll at all four sizes in all three modes; at 375x667,
   the sim strip and at least the first three blocks of a program are both
   visible (screenshot); a Run plays with the highlight visible on the same
   screen as the rover.

Tests: `PhoneWorkspace` renders the sim and the editor together; tapping the
sim expands it; Run in the top bar reaches the active editor's run (mock the
editors, as `EditorPanelPrefetch.test.tsx` does).

## Phase 3: Blockly that works with a thumb (PR 3)

All in `src/components/mission/BlocklyEditor.tsx`, at `Blockly.inject`
(around line 91), only when `useIsPhoneLayout()` is true:

1. Categories as a bottom strip: `horizontalLayout: true`,
   `toolboxPosition: 'end'`. The flyout then opens upward over the canvas.
   The CSS in `globals.css` around `.blocklyToolboxDiv` (fixed widths like
   `width: min(28vw, 176px)`) assumes a left column; scope those rules to
   `md` up and add horizontal-strip rules for phones.
2. `zoom: { controls: false, wheel: false, pinch: true, startScale: 0.8 }`.
   The buttons are what blocks run under today; pinch replaces them.
3. `trashcan: false`. Dragging a block back onto the category strip already
   deletes it in Blockly; the trashcan only takes canvas space.
4. Inject options are read once. If the hook flips (rotation, a resized
   desktop window), dispose and re-inject, the same way the existing cleanup
   in the effect around line 239 disposes. The workspace is saved to
   `localStorage` on every change, so nothing is lost.
5. Gate: at 375x667 a default program fits the canvas width; categories are
   reachable by thumb; dragging a block from the flyout to the canvas works in
   the browser pane's touch emulation. Real-device check is phase 5.

Tests: a unit test on whatever pure function builds the inject options (pull
the options into `phone ? PHONE_OPTIONS : DESKTOP_OPTIONS` or a small builder
so it is testable without Blockly).

## Phase 4: Send as a bottom sheet (PR 4)

On a phone the name, re-roll and pre-flight checklist do not fit under a 30%
sim. Send in the top bar opens a bottom sheet containing the existing
`MissionSubmitBar` unchanged (name, re-roll, checklist, Send to Mission
Control). Its gate logic (`hasRunSimulation` from `simulatedCode`) stays in
`MissionWorkspace`. The Send button shows the same ready/not-ready state the
checklist does, so a learner can tell before opening the sheet.

Tests: Send opens the sheet; the sheet's submit is the same handler; the
button's ready state follows `hasRunSimulation`.

## Phase 5: Python with the keyboard up, then real devices (PR 5)

1. When the on-screen keyboard is open (`window.visualViewport.height`
   noticeably below `innerHeight`), collapse the sim strip to a ~40px status
   line showing the running command's text, so the editor keeps its space.
   Put this observation in the same hook file as a second export, not a new
   hook somewhere else.
2. Snippet chips in `PythonCodeEditor.tsx`: one horizontally scrolling row on a
   phone instead of wrapping onto three lines.
3. **Real devices, required before merging the stack:** an iPhone (Safari) and
   an Android phone (Chrome). For each: drag blocks from every category, run,
   watch the highlight with the sim docked, expand and collapse the sim, type,
   select, copy and paste Python, send a mission. Record results in the PR.
   This also closes the open device check on AB#456 (PR #245).

## Out of scope

- The mission view page (`/missions/[id]`) and the yard console.
- The challenges UI. It lives on `feat/challenges` (see
  `docs/challenges-branch.md`). Once this stack merges, rebase that branch;
  AB#455 then puts the challenge brief into this shell, and AB#451's redesign
  is prototyped against it.
- Landscape phones. Make sure nothing breaks; do not design for it.

## Before each PR

```bash
cd mission-control && npx tsc --noEmit && npx eslint src --quiet && npx jest
```

Plus the screenshot checks named in each phase's gate, at the four phone sizes
and at 1280x800.
