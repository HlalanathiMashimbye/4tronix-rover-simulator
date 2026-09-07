# Working in this repository

Read this before writing code here. It is not style advice - it is the set of
rules this codebase is graded and tested against, and breaking them fails the
build.

## Before you add anything, look at where it goes

**Do not start by writing a file.** Start by finding where the thing you are
about to build already half-exists, and what it should be allowed to see.

Most of the damage done to this codebase has been additive: a helper that
duplicates one three directories away, a component that reaches past its layer
because the import happened to resolve, a second definition of a rule that
already had one. Each was individually reasonable and collectively turned
Separation of Concerns into a 2.2/4 on the iteration 2 marksheet, on a codebase
whose build was entirely green at the time.

So, first:

```bash
# Does it already exist, under any name?
grep -rn "<the concept>" --include="*.ts" --include="*.tsx" --include="*.py" \
  mission-control/src yard | grep -v node_modules | head -20

# What is in the directory you are about to add to, and why?
ls <dir> && cat <dir>/README.md 2>/dev/null
```

`mission-control/src/lib/README.md` is the model for this: it says what each
file is and why it earns its place. If you add to a directory that has a
README, update it in the same change. If your file does not obviously belong
anywhere, that is a signal about the design, not an invitation to invent a
directory.

## The layers, and which way dependencies point

```
mission-control/src/
  core/domain/          entities, repository INTERFACES, services, safety rules
  core/application/     use cases built from the domain
  infrastructure/       Firestore, Firebase, YouTube, email - the outside world
  components/  app/     React and routes
  contexts/  hooks/     React plumbing
  lib/                  small helpers + the five modules shared with the yard

yard/
  satellite/            Flask console on the Pi: pages, camera, recordings
  rover/                the queue server that owns the hardware
  docs/                 how the physical yard is built and debugged
```

**The dependency rule: `core` depends on nothing outward.** It must never
import from `infrastructure`, and from `lib` only the five simulator modules
the yard's build pins. This is not a convention you can quietly break - it is
asserted in `mission-control/src/__tests__/unit/architecture.test.ts` and it
fails CI.

That file exists because nothing else catches this. `tsc` is happy whether core
imports infrastructure or not, eslint has no opinion on which direction a
dependency points, and every behavioural test passes either way. **If you add a
structural rule, add it there too.** A rule that is only written down is a rule
that lasts until the next person is in a hurry.

## SOLID, as it actually applies here

Do not recite these. Each one below already has a worked example in this
repository - match the existing pattern rather than inventing a parallel one.

### Single responsibility

A module does one thing, and its name says which. When you cannot name it
without "and", split it.

Real example: `camera_state.py` exists because the camera's readiness was being
answered by three different places - a cheap port check in `/api/status`, an
expensive frame probe in `/api/camera/ready`, and a third opinion in settings.
Two pages could describe the same camera differently and both be telling the
truth. One module owns that question now.

### Open/closed

Extend by adding an implementation, not by adding a branch to something that
already works.

Real example: `yard/rover/drivers.py` defines `RoverDriver` as an ABC.
`RealRoverDriver` and `FakeRoverDriver` implement it. Adding a new kind of
rover means a new class, not an `if hardware:` threaded through the service.

### Liskov substitution

An implementation must be usable wherever its abstraction is, without callers
knowing which they got.

Real example: the simulator is the same `rover_server.py` with `FakeRoverDriver`
underneath. The run station, the queue, the monitor and the recording path all
behave identically against it, which is exactly why "switch to the simulator"
is a button and not a separate mode.

### Interface segregation

Depend on the narrow thing you need, not the wide thing that contains it.

Real example: `StudentCodeRunner.__init__` takes `interruptible_wait`,
`stop_requested`, `photo_provider` and `timeout` - four collaborators - rather
than the service object that owns them. That is why it is testable without
constructing a rover.

### Dependency inversion

Depend on abstractions. The concrete thing is wired in at the edge.

Real example: `core/domain/repositories/IMissionRepository.ts` is the interface;
`infrastructure/persistence/FirestoreMissionRepository.ts` is the Firestore
implementation. Domain code never mentions Firestore. This is what makes the
dependency rule above enforceable rather than aspirational.

## Tests are part of the change, and they must be able to fail

Every behavioural change needs a test that fails without it. Then check that it
does, by breaking the code on purpose and watching the test go red. A test that
passes against broken code is worse than no test, because it is credited as
coverage.

This is not theoretical here. Tests in this repository have been caught:

- asserting a label's text was gone, while the two dead inputs it labelled were
  still on the page
- asserting `for="pasteBox"` as a substring, which also matches
  `data-for="pasteBox"` on markup with no label at all
- rejecting `javascript:` URLs that all happened to have an empty hostname, so
  the scheme check they existed to cover was never exercised

Assert behaviour, not prose. Do not assert on comments or wording that a
sentence rewrite would break.

## Do not duplicate a rule that already has a home

If two places must agree, one of them owns the rule and the other reads it.
Where that is impossible across languages, write a test that checks both halves
still agree - `yard/satellite/tests/test_mission_import.py` parses the yard's
regexes out of the page and runs them against exactly what Mission Control
emits, so the two cannot drift silently.

Shared CSS goes in `yard/satellite/static/yard-base.css`, not into a page's own
`<style>`. Settings and the run station each grew a private definition of the
same heading and drifted apart; that is now one rule with a test asserting
neither page redefines it.

## Comments explain why, not what

The code says what it does. A comment earns its place by recording the thing
the next person cannot recover from reading it: the failure that caused this
shape, the option that looks better and is not, the constraint from hardware or
a marksheet. Match the density and voice already in the file you are editing.

## Before you open a PR

```bash
# Both suites, from the repo root
.venv/bin/python -m pytest yard/satellite/tests yard/rover -q
cd mission-control && npx tsc --noEmit && npx jest
```

CI runs five checks and all must pass: mission-control build+test, yard rover,
yard satellite, yard browser tests, firestore rules.

## The physical yard

`yard/docs/` is the operational truth for the hardware and network. Two things
there will cost you an afternoon if you skip them:

- The satellite runs from a git checkout that has repeatedly been found serving
  stale code, producing faults that exist nowhere in the repository. Check
  `git log --oneline -1 && git status --porcelain` on it - status must be empty
  - before debugging anything. Never `scp` single files onto it.
- The satellite's passwordless sudo is granted per unit, and sudo matches the
  whole argument list, so `systemctl restart a b` silently prompts for a
  password. Restart services one command at a time.
