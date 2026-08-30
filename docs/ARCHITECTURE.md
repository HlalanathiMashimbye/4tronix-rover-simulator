# Architecture

How this system is put together, and why. Written for a maintainer who did not
build it (AB#358).

Read [`ROADMAP.md`](../ROADMAP.md) first if you have not: the constraints
listed there are what force most of the decisions below, and several of them
look strange until you know what is causing them.

## Three deployables

```
   a child's browser                    a Raspberry Pi in the yard
   ┌──────────────────┐                 ┌───────────────────────────┐
   │  Mission Control │                 │      Yard satellite       │
   │   (Next.js)      │                 │  Flask + SQLite mirror    │
   │   on Cloud Run   │                 │  operator console, camera │
   └────────┬─────────┘                 └─────────────┬─────────────┘
            │                                         │
            │        ┌──────────────────┐             │
            └───────►│    Firestore     │◄────────────┘
                     └──────────────────┘        sync worker:
      the ONLY channel between cloud and yard    push before pull
                                                          │
                                                          │ LAN, HTTP
                                                          ▼
                                              ┌───────────────────────┐
                                              │   Rover server        │
                                              │   on the rover's Pi   │
                                              │   queue + driver      │
                                              └───────────────────────┘
```

| Where | What runs | Entry point |
|---|---|---|
| Cloud Run | Mission Control, the learner app and the operator UI | `mission-control/` |
| Yard Pi | Operator console, camera, offline sync | `yard/satellite/web_server.py` |
| Rover Pi | The instruction queue and the motors | `yard/rover/rover_server.py` |

**Why Firestore in the middle and not an API call.** The satellite is on
mobile data behind carrier NAT: no inbound port, no tunnel. Mission Control is
HTTPS, the yard is plain HTTP, so even a reachable satellite could not be
called from a Mission Control page without a mixed-content failure. Firestore
is not chosen over a direct channel; it is the only channel there is.

## Mission Control: layers, and where MVC maps

```
  src/app         routes and pages          ─┐
  src/components  React components           ├─ View + Controller
  src/app/api     API route handlers        ─┘
        │  depends on
        ▼
  src/core/application   services, DTOs      ─┐
  src/core/domain        entities, rules,     ├─ Model
                         ports (interfaces)  ─┘
        ▲  implements
        │
  src/infrastructure     Firestore, email, auth, validation
```

The rule is one sentence: **`core` never imports `infrastructure`.** Core
declares interfaces; infrastructure implements them; the app layer asks for
interfaces and one file decides what satisfies them.

If you prefer the MVC framing the marksheet uses: App Router pages and
components are the View, API routes plus application services are the
Controller, and `core/domain` is the Model.

### What lives where, and why

Paths in this section are relative to `mission-control/src`.

- **`core/domain/entities`** — `Mission`, `MissionRun`, `Learner`,
  `OperatorAccount`. Interfaces plus pure functions rather than classes with
  behaviour. `missionBookkeeping.ts` in `core/domain/services` is the pattern worth
  copying: pure decision functions returning a typed result, fully testable
  with no Firestore anywhere near them.
- **`core/domain/safety`** — the allowlist, the code checker, the duration
  calculator, the speed and time ceilings. These were under `infrastructure`
  and `lib`. They touch no database, network or framework: they are the rules
  about what a child may make a robot do, which is the most domain-ish thing
  in the repository.
- **`core/domain/repositories`** — `IMissionRepository`. It must cover what
  the app actually does. It declared four methods while the operator route
  also needed `findRuns`, `applyBookkeeping` and `softDeleteMission`, which
  existed only on the concrete Firestore class — so that route was
  structurally unable to hold the interface type, and an abstraction nobody
  can use is decoration.
- **`core/application/dto`** — the shapes the application accepts. Declared
  here in plain TypeScript, with the Zod schemas asserting they produce them
  (`satisfies z.ZodType<CreateMissionDto>`). Inferring the DTO from the schema
  put the domain's vocabulary in the hands of a validation library.
- **`container.server.ts` / `container.browser.ts` in `infrastructure`** — the
  composition root, split in two. **This split is a security boundary, not
  tidiness.** The Admin SDK is not "the server one", it is the one with no
  authorisation at all: it bypasses Firestore rules and code holding it must
  check permissions itself. The server file carries `import 'server-only'` so
  a client component importing it is a build error.

### The rules are tested

`mission-control/src/__tests__/unit/architecture.test.ts` asserts the layering, because
nothing else can. `tsc` is happy whether core imports infrastructure or not,
eslint has no opinion on dependency direction, and every behavioural test
passed throughout the period when the arrows were backwards. The iteration 2
marksheet scored separation of concerns 2.2/4 on a codebase with a completely
green build.

### Two Firestore SDKs, one repository class

`FirestoreMissionRepository` accepts either the Admin SDK or the browser SDK.
That is deliberate, so the same query logic serves a privileged server write
and an unprivileged browser read, and it is exactly why choosing between them
happens in one place. Realtime subscriptions (`onSnapshot`) run browser-side
against Firestore rules; anything privileged goes through an API route.

## The yard: the same idea, in Python

`yard/rover` is the part of this project that had clean layering first, and it
is the model the satellite is being moved towards.

| Layer | File | Role |
|---|---|---|
| Transport | `rover_server.py` | Six thin HTTP routes. Knows nothing about motors. |
| Application | `service.py` | The queue, and `RoverQueuePort` describing it. |
| Domain | `mission_validator.py`, `limits.py`, `rover_physics.py` | Rules and kinematics. |
| Ports | `drivers.py` (`RoverDriver`), `telemetry.py` (`Telemetry`) | Abstract base classes. |
| Adapters | `FakeRoverDriver`, `RealRoverDriver`, `PostHogTelemetry`, `NullTelemetry` | Chosen by factory. |

`create_driver()` selects `FakeRoverDriver` automatically when there is no
hardware, which is why the whole loop runs on a laptop: submit a mission,
dispatch it, watch the queue execute it, with no rover in the room.

`python_runner.py` holds the learner-code sandbox: compiling the program,
tracing it so the stop button can interrupt a `while True`, and capturing its
output. It is separate from `service.py` because sandboxing an arbitrary
program and managing a queue change for entirely different reasons.

### The satellite

`yard/satellite/console/` is the operator console: 23 routes across six route
modules (`auth`, `missions`, `camera`, `config`, `review`, `health`), plus
four supporting ones — `deps` for Firebase and service URLs, `mirror` for
reading local storage, `notify` for the status-email trigger, and `blueprint`,
which holds the Flask blueprint alone so route modules need not import each
other. `operator_console.py` is a facade
over the package, because `web_server.py` and the templates reach the console
through that name.

`ports.py` states the Firestore shape the satellite depends on, as
`typing.Protocol` rather than ABC: the real collaborator is Google's client,
which we neither control nor subclass.

**Offline-first is the whole design.** The console reads and writes SQLite;
`sync_worker.py` reconciles with Firestore on a background thread. The
ordering rule matters and is not arbitrary: **flush the outbox before
pulling.** A local write records a physical event, the rover actually moved.
The Firestore copy is stale by definition because it never heard about that
run, so pulling first would overwrite ground truth with staleness.

## Shared code between the browser simulator and the yard

Five modules in `mission-control/src/lib` are compiled into
`yard/satellite/static/roversim/` and committed:

`rover-physics.ts`, `simulateCommands.ts`, `parseRoverCode.ts`,
`roverSimRender.ts`, `roverBlockly.ts`

`npm run build:roversim` generates them; `npm run check:roversim` fails CI if
the committed output is stale. **They cannot be moved** without editing
`tsconfig.roversim.json`, which pins their paths, and re-committing the
output. This is why `calculateMissionDuration.ts` in `core/domain/safety` imports
`@/lib/roverBlockly` — the one import pointing out of core, documented in
place. It is domain code parked in `lib` for a build reason.

The reason they are shared rather than reimplemented: the yard's offline
editor and the browser simulator must agree about what a program does. When
they disagreed, a child saw one thing on screen and a different thing on the
rover.

## Known seams

Honest list of places the architecture is not clean, so you find them here
rather than by surprise:

- **`LearnerContext.tsx` does both.** It calls an API route and writes to
  Firestore directly, ninety lines apart.
- **`mission_store.py` is 1379 lines.** It is the local mirror every offline
  path depends on, and is deliberately not split yet. See the roadmap.
- **`api_missions` and friends read SQLite directly** rather than through a
  repository interface. The satellite has one abstraction so far; the rover
  has three.
- **Mission Control's route handlers are thick.**
  `api/operator/missions/[id]/route.ts` does auth, parsing, repository
  construction, a four-case dispatch, and sends an email.

## Where to start reading

1. `ROADMAP.md` — the constraints. Nothing below makes sense without them.
2. `yard/rover/service.py` — the smallest complete example of the layering
   this project is aiming at.
3. `mission-control/src/core/domain/services/missionBookkeeping.ts` — the
   cleanest domain code in the repository, and the pattern to copy.
4. `yard/satellite/sync_worker.py` — the offline model, and the comments
   explaining push-before-pull.
5. `docs/RUNBOOK.md` — how to operate it.
