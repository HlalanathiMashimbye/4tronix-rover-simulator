# Architecture

How this system is put together, and why. Written for a maintainer who did not
build it (AB#358).

Read [`ROADMAP.md`](../ROADMAP.md) first if you have not: the constraints
listed there are what force most of the decisions below, and several of them
look strange until you know what is causing them.

## Three deployables

```
            the cloud                                    the venue LAN
   ┌─────────────────────────┐                    ┌─────────────────────────┐
   │     Mission Control     │  the mission, by   │     Yard satellite      │
   │  Next.js on Cloud Run   │  copy and paste    │  Flask on a Pi, :3001   │
   │  learner app, operator  │───────────────────►│  run station, editor,   │
   │  console, video linker  │                    │  TV monitor, camera,    │
   │                         │◄───────────────────│  recordings             │
   └────────────┬────────────┘ the video, by way  └────────────┬────────────┘
                │              of YouTube                      │ LAN, HTTP
                ▼                                              ▼
   ┌─────────────────────────┐                    ┌─────────────────────────┐
   │  Firestore              │                    │  Rover server           │
   │  Firebase Auth          │                    │  on the rover's Pi      │
   │  YouTube Data API       │                    │  queue + driver         │
   │  Resend, for email      │                    │                         │
   └─────────────────────────┘                    └─────────────────────────┘

   Both arrows across the middle are an operator. No network path joins them.
```

The loop, end to end:

1. A learner submits a mission. Mission Control stores it in Firestore.
2. An operator signed in at `/operator` sees it arrive in their yard's live
   queue and presses **Copy**: the mission's Python, with its name and id in
   `# Mission:` and `# MissionID:` header comments.
3. They paste it into the satellite's run station (`/run/`) and press
   **Send**. The station starts recording, waits a second so the first move
   is on camera, then posts the code to the rover's queue with the mission id
   in its params.
4. The rover runs it and records the outcome in its history, mission id
   included. The satellite's `mission_watcher` sees the run finish and closes
   the recording, `<mission>__<yard>__<UTC stamp>.mp4`.
5. The operator takes the file off the run station over the LAN, uploads it
   to YouTube with the description the station writes (`MissionID:` and
   `Yard:` lines), and marks the run complete in Mission Control.
6. Cloud Scheduler calls Mission Control's `/api/cron/youtube-link`, which
   finds the upload by those lines and attaches it to that yard's run. The
   learner sees the video on the mission page.

| Where | What runs | Entry point |
|---|---|---|
| Cloud Run | Mission Control: the learner app, the operator console, the YouTube linker | `mission-control/` |
| Yard Pi | The run station, tablet editor, TV monitor, camera and recordings | `yard/satellite/web_server.py` |
| Rover Pi | The instruction queue and the motors | `yard/rover/rover_server.py` |

**Why nothing joins the cloud and the yard.** The satellite is on mobile data
behind carrier NAT: no inbound port, no tunnel. Mission Control is HTTPS, the
yard is plain HTTP, so even a reachable satellite could not be called from a
Mission Control page without a mixed-content failure. The satellite could
reach out instead, and it used to, by mirroring Firestore. That put Firebase
credentials on a box on venue wifi, and a sync thread and a read quota behind
a yard that has to work offline anyway, mostly to feed an operator console
Mission Control now provides.
[`yard/docs/what-the-yard-no-longer-does.md`](../yard/docs/what-the-yard-no-longer-does.md)
records what the mirror did, and why a way back should be outbound HTTP to
Mission Control rather than another mirror.

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
  src/infrastructure     Firestore, Auth, email, YouTube, validation
```

The rule is one sentence: **`core` never imports `infrastructure`.** Core
declares interfaces; infrastructure implements them; the app layer asks for
interfaces and one file decides what satisfies them.

If you prefer the MVC framing the marksheet uses: App Router pages and
components are the View, API routes plus application services are the
Controller, and `core/domain` is the Model.

### What lives where, and why

Paths in this section are relative to `mission-control/src`.

- **`core/domain/entities`** - `Mission`, `MissionRun`, `Learner`,
  `OperatorAccount`, `Yard`. Interfaces plus pure functions rather than
  classes with behaviour. `missionBookkeeping.ts` in `core/domain/services` is
  the pattern worth copying: pure decision functions returning a typed result,
  fully testable with no Firestore anywhere near them.
- **`core/domain/safety`** - the allowlist, the code checker, the duration
  calculator, the speed and time ceilings. These were under `infrastructure`
  and `lib`. They touch no database, network or framework: they are the rules
  about what a child may make a robot do, which is the most domain-ish thing
  in the repository.
- **`core/domain/repositories`** - `IMissionRepository`, and `IYardRepository`
  for the yards an admin manages. The mission repository must cover what the
  app actually does. It declared four methods while the operator route also
  needed `findRuns`, `applyBookkeeping` and `softDeleteMission`, which existed
  only on the concrete Firestore class, so that route was structurally unable
  to hold the interface type, and an abstraction nobody can use is decoration.
- **`core/application/dto`** - the shapes the application accepts. Declared
  here in plain TypeScript, with the Zod schemas asserting they produce them
  (`satisfies z.ZodType<CreateMissionDto>`). Inferring the DTO from the schema
  put the domain's vocabulary in the hands of a validation library.
- **`container.server.ts` / `container.browser.ts` in `infrastructure`** - the
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

### The operator console

Operators and admins work in Mission Control, at `/operator`. It is one route:
the sign-in form without a session, the console with one.

- **Sign-in and roles.** Firebase Auth, then `/api/auth/session` swaps the ID
  token for a session cookie. The role, `operator` or `admin`, is a custom
  claim on the token, and `firestore.rules` reads the same claim. The operator
  chooses a yard at sign-in and it is fixed for the session.
- **Where the check lives.** `src/proxy.ts` is an optimistic gate: it only
  looks for a session cookie, so an anonymous visitor is turned away without a
  Firestore round trip. `infrastructure/auth/dal.ts` is the security boundary.
  Every operator page and route calls it, and it verifies the cookie with
  revocation checked, so removing an operator takes effect on their next
  request.
- **Hidden, which is not the control.** Nothing a learner can see links to
  `/operator`, and it is marked `noindex`, so curious children do not wander
  in. The session check is what keeps them out.
- **The queue** is a live Firestore listener for the operator's yard
  (`infrastructure/persistence/operatorQueueService.ts`), and **Copy** writes
  the payload the run station reads (`lib/missionClipboard.ts`).
- **Desk actions only.** Complete, cancel, log another run, attach or remove a
  video, resolve a review, and feedback, decided in `missionBookkeeping.ts`
  and applied through the Admin SDK in `api/operator/missions/[id]/route.ts`.
  Nothing in that route can move a rover, and a test asserts it. Deleting a
  mission is admin-only, as are `/operator/team` (who may operate) and
  `/operator/settings` (email, YouTube, the auto-link interval, the yards).
- **The YouTube linker** is `api/cron/youtube-link/route.ts`, called by Cloud
  Scheduler with a shared secret, every 15 minutes by default and in one
  environment only, because staging and prod share a Firestore. It reads the
  channel's recent uploads first and only then the missions they name, so a
  poll that finds nothing costs one YouTube quota unit and no Firestore reads.
  It attaches a video to the completed run its `MissionID:` and `Yard:` lines
  name, through the same `decideAttachVideo` the operator's own attach uses.

## The yard: the same idea, in Python

`yard/rover` is the part of this project that had clean layering first, and it
is the model to copy.

| Layer | File | Role |
|---|---|---|
| Transport | `rover_server.py` | Six thin HTTP routes. Knows nothing about motors. |
| Application | `service.py` | The queue, and `RoverQueuePort` describing it. |
| Domain | `mission_validator.py`, `limits.py` | Rules: the time and speed ceilings, and calls the rover cannot make. |
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

The satellite is the yard's control panel, and it is deliberately small. It
holds no cloud credential, talks to nothing beyond the rover and the camera on
the LAN, and asks nobody to sign in: an auth gate that only works when the
venue wifi does protects nothing on a box whose job is to run without it.

| Path | For |
|---|---|
| `/` | Station hub |
| `/run/` | The operator's run station: paste a mission, send it, take the video |
| `/code/` | The tablet's Blockly and Python editor |
| `/monitor/` | The TV: camera feed and the rover's queue |
| `/settings` | Health, recordings, and the tunables (`/status` redirects here) |

`web_server.py` serves those pages, proxies the rover's queue (stop included)
and photo, and owns the recording endpoints. Around it, one module per
question:

- `camera_state.py`: whether the camera is ready. `/api/status`,
  `/api/camera/ready` and the run station's gate all read its one snapshot.
- `recording_control.py`: opening and closing recordings, keyed
  `(mission_id, yard_id)` and written as `<mission>__<yard>__<UTC stamp>.mp4`,
  so a re-run never overwrites the last attempt.
- `mission_watcher.py`: the only background thread. It polls the rover's
  `/queue/status` and stops the recording of any run the rover reports
  finished. It reads from the rover and never sends to it.
- `recording_cleanup.py`: prunes recordings so the SD card does not fill.
- `console/`, behind the `operator_console.py` facade: what is left of
  `/operator/`, which is starting and stopping the camera and the satellite's
  tunables. The prefix stayed because the pages already call it there.
- `satellite_identity.py` (which yard this is), `tunables.py` (settings that
  change without a restart) and `rover_discovery.py` (finding rovers on the
  LAN).

**Offline is still the whole design, and now it holds by construction.**
Nothing on the run path leaves the LAN, and nothing is synced, so there is
nothing to reconcile when the network comes back. The yard's half of a run
(which mission, at which yard, whether the rover finished, where the video is)
is already produced here, which is what the planned automatic route would
report outward; see
[`yard/docs/automatic-route-plan.md`](../yard/docs/automatic-route-plan.md).

## Shared code between the browser simulator and the yard

Five modules in `mission-control/src/lib` are compiled into
`yard/satellite/static/roversim/` and committed:

`rover-physics.ts`, `simulateCommands.ts`, `parseRoverCode.ts`,
`roverSimRender.ts`, `roverBlockly.ts`

`npm run build:roversim` generates them; `npm run check:roversim` fails CI if
the committed output is stale. **They cannot be moved** without editing
`tsconfig.roversim.json`, which pins their paths, and re-committing the
output. This is why `calculateMissionDuration.ts` in `core/domain/safety` imports
`@/lib/roverBlockly`: the one import pointing out of core, documented in
place. It is domain code parked in `lib` for a build reason.

The reason they are shared rather than reimplemented: the yard's offline
editor and the browser simulator must agree about what a program does. When
they disagreed, a child saw one thing on screen and a different thing on the
rover.

## Known seams

Honest list of places the architecture is not clean, so you find them here
rather than by surprise:

- **`LearnerContext.tsx` does both.** It calls API routes and writes to
  Firestore directly.
- **Mission Control's route handlers are thick.**
  `api/operator/missions/[id]/route.ts` does auth, parsing, repository
  construction, an eight-way action dispatch, and sends an email.
- **The satellite declares no abstraction of its own.** `ports.py` went with
  the Firestore client it described. What is left talks to the rover over HTTP
  and to the camera over a WebSocket, directly.
- **The auto-link cadence is set in two places that disagree.** The app
  assumes Cloud Scheduler fires every 5 minutes (the interval setting's floor
  is 5); Terraform schedules it every 15. With the default interval also 15
  and no slack in `isDue`, a call that lands a moment early is skipped, and
  the next check comes 30 minutes after the last.

## Where to start reading

1. `ROADMAP.md` - the constraints. Nothing below makes sense without them.
2. `yard/rover/service.py` - the smallest complete example of the layering
   this project is aiming at.
3. `mission-control/src/core/domain/services/missionBookkeeping.ts` - the
   cleanest domain code in the repository, and the pattern to copy.
4. `yard/satellite/mission_watcher.py` - the yard's one background thread:
   how a run's end closes its recording, and why reading an outcome the rover
   reported is allowed where dispatching is not.
5. `docs/RUNBOOK.md` - how to operate it.
