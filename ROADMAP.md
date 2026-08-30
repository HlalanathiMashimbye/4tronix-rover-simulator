# Roadmap

Where this project is going, and the constraints that decide its shape. For
the detailed next steps see [`docs/BACKLOG.md`](docs/BACKLOG.md); for what has
already happened see [`CHANGELOG.md`](CHANGELOG.md); for how the system is put
together see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Written so a maintainer outside the founding team can pick this up (AB#358).
If you are that person: read the constraints section first. Most of the
decisions here look arbitrary until you know what is forcing them.

## What this is for

A child writes a program in a browser. It runs on a real rover in a physical
yard in Cape Town. They watch the video afterwards.

The equity argument is the point, and it is what the marks hang on: a learner
with a borrowed phone and no laptop should get the same experience as one with
a school computer lab. That is why the learner app needs no login, no install,
and works on a small screen.

## The constraints that decide everything

These are not preferences. Read them before proposing an architecture change,
because most obvious designs are already ruled out by one of them.

**The satellite cannot be reached from the internet.** It sits on mobile data
behind carrier NAT. There is no inbound port and no tunnel in this repository.
Mission Control is HTTPS behind a Google load balancer; the yard is plain
HTTP. So an HTTPS page cannot call the satellite and the cloud cannot either.
**Firestore is not the preferred channel between cloud and yard, it is the
only one.**

**gRPC streaming is unreliable on venue networks.** Mission Control already
forces `experimentalForceLongPolling` because streaming is blocked by school
and corporate firewalls. The satellite's Firestore listener is gRPC-only, so
the polling path is a co-equal route rather than a fallback.

**The yard must work with no internet at all.** This is why the satellite
keeps a SQLite mirror and an outbox, and why the operator console reads local
storage rather than Firestore. Forty-five missions ran on Mandela Day on a
venue network nobody controlled.

**The rover is a physical object with children near it.** Stop must work on
the first press and with no network, which is why it stays local to the yard
and will not move to the cloud.

**Nobody on the student team holds production IAM.** Granting a role, running
Terraform or reading Cloud Run logs needs Werner or Gavin. Plan around the
wait, not around the permission.

## Where we are

Iteration 2 scored 32.3/56. The weakest lines were Coding Structure 2/4,
Object-Oriented Concepts 4.3/8 and Separation of Concerns 2.2/4, with the
comment that the code was difficult to follow and that the number of files did
not reflect a clear division of responsibilities.

The 2026-08-30 overhaul was the direct response: the root decluttered, the
1399-line operator console split into ten modules, the rover's 130-line
execution method reduced to 58, the satellite given its first interfaces, and
Mission Control's dependency arrows reversed with tests that fail the build if
they are reversed again. See the changelog for detail.

**Next milestone: the iteration 3 presentation, 2026-09-17.**

## Where it is going

### Now: handover engineering

The sponsor reframed the remaining work as handover. Someone outside the
founding team must be able to run this. That argues consistently for fewer
moving parts, obvious code over clever code, and documentation budgeted as
real work rather than done at the end.

Concretely, the highest-value remaining items:

- **A Firestore and Auth emulator setup.** `firebase.json` has no emulator
  config. Adding one is the single biggest handover investment available: it
  would let someone run the whole system with no GCP project and no service
  account key.
- **Backups.** No mission data is exported anywhere off Firestore. Nothing
  destructive should be attempted until that exists.
- **The runbook kept honest** as the system changes.

### Next: one interface

Today there are two operator surfaces: the Flask console on the yard Pi, and
Mission Control in the cloud. The team decided on 2026-07-23 to unify them,
and the shape agreed is that Mission Control becomes the operator console
while the satellite keeps a **yard control panel**. That is not a compromise:
stop, camera and arming are physical or filesystem operations that have to
stay local, and the offline path is why Mandela Day worked.

The Flask console is not being retired. Reframing it honestly as two surfaces
with different jobs is what survives the question "so did you actually unify
it?"

### Later, and deliberately deferred

- **Cloud dispatch** (sending a mission to the rover from the cloud UI). It
  needs an arming mechanism first, because it removes today's implicit
  guardrail that a human is standing in the room. Arming must not be
  bypassable by `OPERATOR_AUTH=off`, which is the documented event-day escape
  hatch and would otherwise let anyone on venue wifi arm the yard.
- **Splitting `mission_store.py`.** 1379 lines, and load-bearing: it is the
  local mirror every offline path depends on. The console split proved the
  facade approach works, so this is tractable, but it buys clarity rather than
  capability and should wait.
- **Merging back upstream**, after Werner's cloud team reviews the Terraform.

## Known gaps

Recorded here rather than left for someone to rediscover:

- **`while True:` is accepted** in learner Python and the rover will run it
  forever. The time ceiling is a static parse and cannot catch it. It needs a
  wall-clock watchdog on the rover.
- **Monaco loads from a CDN**, render-blocking in `<head>`. The yard works
  with no internet, but a captive-portal network could stall the page. Adding
  `defer` alone would break it: the bootstrap checks `typeof require`.
- **Mission code is still free text** via comments and `print()`, documented
  in `docs/THREAT-MODEL.md`.
- **`pca9685` is not vendored**, so the rover Pi still needs the 4tronix
  install alongside this repository.
- **Two secrets need rotating** after being printed to a terminal:
  `YOUTUBE_CLIENT_SECRET` and `OPERATOR_SESSION_SECRET`.

## How decisions get recorded

The standup on 2026-08-20 agreed on *context as code*: the roadmap and the
change log live in the repository, so a future developer, or their AI agent,
can reconstruct why the system is shaped this way without access to the team's
chat history.

In practice that means: architectural reasoning goes in
`docs/ARCHITECTURE.md`, decisions with a date and an owner go in
`CHANGELOG.md`, work not yet done goes in `docs/BACKLOG.md`, and the *why*
behind a surprising piece of code goes in a comment next to it. Commit
messages here are expected to explain the reasoning, not just the change.

Note for whoever looks: sprint minutes and standup notes have never lived in
this repository. They are in the team's Teams channel. If continuity matters
they should be brought in, but nothing was deleted from here.
