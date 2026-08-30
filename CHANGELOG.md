# Changelog

What has actually happened to this project, in order. Written for someone
picking it up later: the entries say why a thing changed, not only that it
did, because the why is the part git does not preserve on its own (AB#358).

Dates are when the work merged to `main`. PR numbers link to the discussion,
which is often longer than the diff.

---

## 2026-08-30 — Code quality overhaul

Response to the iteration 2 coding marksheet (32.3/56), which said the
organisation "does not reflect a clear or coherent approach to dividing
responsibilities", that object-oriented principles and separation of concerns
needed strengthening, and that the code was difficult to follow.

- **Root decluttered, 34 entries to 15** (#122). Everything inherited from the
  upstream 4tronix desktop simulator moved to `legacy/`, nothing deleted. Four
  one-shot planning docs archived to `docs/plans/`. README rewritten to
  describe this project rather than PyQt6 setup.
- **The 4tronix rover library vendored** into `yard/rover/vendor/` (#122), so
  the rover Pi needs one clone rather than two. Partial by necessity:
  `rover.py` imports `pca9685`, which 4tronix's own installer provides and
  which is not in this repository, so `/home/mars/marsrover` still has to
  exist. See `yard/rover/vendor/README.md`.
- **`/home/mars` removed from Python** (#122). The rover library path is now
  derived from the module's own location, overridable with `ROVER_LIB_PATH`.
  The marksheet named this one directly.
- **Rover command table and `StudentCodeRunner`** (#123). `_execute_instruction`
  went from 130 lines to 58: six identical drive-wait-stop branches collapsed
  into one table, and the learner-Python sandbox moved to `python_runner.py`.
- **The satellite got its first interfaces** (#124). `ports.py` states the
  Firestore shape the satellite depends on as `typing.Protocol`. Until then
  the satellite declared no abstraction of any kind, and the evidence was 22
  `Fake*` classes across its tests, most of them the same class twice. One
  shared implementation now lives in `yard/satellite/tests/firestore_fakes.py`.
- **The operator console split, 1399 lines to 75** (#125). Its 23 routes moved
  into six route modules under `yard/satellite/console/`, one concern each,
  beside four more for shared concerns (`deps`, `mirror`, `notify`,
  `blueprint`).
  The Flask route table was diffed against `main` after every step and never
  changed.
- **Mission Control's dependency arrows reversed** (#126). `core` no longer
  imports `infrastructure` anywhere: safety rules moved into
  `core/domain/safety`, DTOs into `core/application/dto`, the email body
  behind a port. The repository interface widened to cover what routes
  actually do, and one composition root replaced seven inline constructions.
- **Architecture tests added** (#126). `tsc` is happy whether core imports
  infrastructure or not, and every behavioural test passed throughout the
  period when the arrows were backwards. `architecture.test.ts` asserts the
  layering rules so they fail the build instead of a marksheet.
- **A security-relevant bug caught by CI, not by review** (#126). A first
  version of the composition root put the Firebase Admin SDK and the browser
  SDK in one module, which pulled the Admin SDK - the one that bypasses
  Firestore rules entirely - toward the browser bundle. Split into
  `container.server.ts` (with `import 'server-only'`) and
  `container.browser.ts`.

## 2026-08-30 — Learner safety and the editor

- **Time and speed ceilings** (#119, #120). A mission cannot exceed 120
  seconds, and speeds are capped at 0-100. The marksheet noted a comment
  describing a 0-100 range that nothing enforced; it is now enforced in three
  places, including at the rover's LAN boundary where nothing else guards.
- **Mission names became a closed vocabulary** (#116). Names are generated,
  never typed. They land on a world-readable document, and 47 of the first 400
  carried names the generator could not have produced.
- **The editor says where a mistake is and what to do** (#111), and the
  generated Python explains itself (#112).
- **Turns are measured in degrees** (#114), which is what made drawing a
  square possible; the simulator got working lamps and a yard big enough to
  drive in (#113).
- **Nested corner radii made concentric** (#121).

## 2026-08-26 to 2026-08-29 — Runs, roles, and the operator console

- **A mission is a program; a run is one yard's attempt at it** (#99). Any
  yard may run any mission, each attempt keeps its own status and video, and
  the mission-level lease was deleted because the contention it arbitrated no
  longer exists.
- **Operator auth in Mission Control** (#87, #89). Protected routes and
  sign-in, closing AB#341 and AB#342.
- **Roles moved onto the token claim, scoped by yard** (#90), and operators
  choose a yard at sign-in (#92).
- **Live operator queue** (#95, #97) and **operator bookkeeping from a desk**
  (#108): complete, cancel, attach a video, resolve a review.
- **PostHog analytics and session replay** (#98, #100, #101).

## 2026-08-11 to 2026-08-20 — Deployment

- **Mission Control behind an external load balancer** (#69), then pointed at
  the real domains (#73): `marsyard.sapient.rocks` for production,
  `marsyard.labs.ws` for staging.
- **Firestore access via the runtime service account** rather than a mounted
  key (#75), and the Firebase Auth grant operator login needs (#96).

## 2026-07-26 to 2026-07-30 — Offline-first, and the yard

The satellite stopped depending on the network to do its job. This is the
period that produced most of the architecture the project still runs on.

- **SQLite mirror and outbox**: the console reads and writes local storage,
  and a sync worker reconciles with Firestore later.
- **Push before pull**: the ordering rule that stops a stale cloud copy
  erasing the fact that a rover physically moved.
- **Recovery and conflict surfacing**: a mission interrupted by a restart is
  flagged for a human rather than guessed at.
- **Camera control from the console**, with a webcam fallback when no Pi
  camera is present.
- **Learner email stored only as a hash** on the mission document.

## 2026-07-17 and 2026-07-18 — Mandela Day pilot

The first time children drove the rover. Forty-five missions ran against a
goal of twenty.

## 2026-06-20 — The UCT project begins

`mission-control` imported onto the upstream fork (#1), renamed and stripped
of bloat five days later (#18). Everything before this date is upstream
4tronix work and now lives in `legacy/`.

## 2023-05-16 — Upstream origin

The 4tronix M.A.R.S. Rover desktop simulator, by Ian Griffiths and David
Campey. Its physics model is still the reference the current simulator is
written against.
