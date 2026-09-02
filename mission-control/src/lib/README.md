# `src/lib`

This directory used to be the app's grab-bag: 23 files and about 4,000 lines
holding Firebase clients, browser storage, React hooks, CDN loading, domain
rules and UI helpers together, with nothing in the name to say which was
which. Everything that had a real home has gone to it, and the rule now is
that a file belongs here only if it fits one of the two categories below.

If you are adding a file and it does not fit either, it belongs somewhere
else. `src/infrastructure` for anything talking to a database, network,
browser API or CDN; `src/hooks` for React hooks; `src/core/domain` for rules
about missions, learners or safety.

## 1. Shared with the yard, and pinned by a build

```
rover-physics.ts   simulateCommands.ts   parseRoverCode.ts
roverSimRender.ts  roverBlockly.ts
```

**These five cannot move.** `npm run build:roversim` compiles them into
`yard/satellite/static/roversim/`, which is committed, and
`tsconfig.roversim.json` pins their paths with `rootDir: src/lib`. Moving one
means editing that config, the header string in
`mission-control/scripts/build-roversim.mjs`, and re-committing the generated
output. `npm run check:roversim` fails CI if the committed output is stale.

They are domain code by any reading: the rover's block language, its
kinematics, and how a program becomes a sequence of commands. They live here
for a build reason, not a design one, which is why
`core/domain/safety/calculateMissionDuration.ts` is allowed to import
`roverBlockly` even though core may not otherwise import from `lib`. That
exception is stated in `src/__tests__/unit/architecture.test.ts` and enforced
there.

The reason they are shared rather than reimplemented: the yard's offline
editor and the browser simulator must agree about what a program does. When
they disagreed, a child saw one thing on screen and the rover did another.

## 2. Small UI helpers

```
easings.ts            CSS easing curves
missionDuration.ts    a human label for how long a run took
roverCommandHelp.ts   help text per rover command, for editor hovers
missionRuns.ts        which runs a learner can actually watch
missionClipboard.ts   what every Copy button puts on the clipboard
```

`missionClipboard.ts` sits here because it is a formatting helper used by two
components, but it is worth knowing that its output is a contract, not a
convenience: the yard's run station parses the header it writes to fill the
mission id, and from that the run id, which is the filename the recording is
saved under. The yard's half is in `yard/satellite/templates/run.html`, and
`yard/satellite/tests/test_mission_import.py` checks the two halves still
agree. There were two Copy buttons writing two different payloads before this
existed, and copying from the mission page produced a paste the run station
could not identify.

Presentation-shaped and used only by components. `missionRuns.ts` is the least
settled of these: it imports `yardPlace` from `infrastructure/config/yards` to
label a run, which is an outward dependency a pure helper would not have.
Taking the label lookup as a parameter would let it move to `core/domain`;
that has not been done because nothing yet needs it there.
