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
**Nothing carries a mission from the cloud to the yard except the operator**,
who copies it out of Mission Control and pastes it into the satellite. Any
automation has to point outward from the yard: Mission Control can queue work
and the yard can pull it, but nothing can push to the yard.

**gRPC streaming is unreliable on venue networks.** Mission Control forces
`experimentalForceLongPolling` because streaming is blocked by school and
corporate firewalls.

**The yard must work with no internet at all.** This is why everything on the
run path, from pasting a mission to taking the video away, needs only the
venue LAN, and why the satellite has no sign-in and holds no cloud credential.
Forty-five missions ran on Mandela Day on a venue network nobody controlled.

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

The satellite half of that did not last the week. Mission Control had already
grown its own operator console (`/operator`, with Firebase sign-in and
operator and admin roles on the token claim), so the satellite's was retired:
its mission queue page went on 2026-08-31, and its Firestore mirror, with most
of the console package and `ports.py`, on 2026-09-02. Mission Control is now
the only operator surface. The satellite keeps what is physical (sending a
mission, stop, the camera and the recordings) and runs the manual loop
described in
[`yard/docs/what-the-yard-no-longer-does.md`](yard/docs/what-the-yard-no-longer-does.md).

**Next milestone: the iteration 3 presentation, 2026-09-17.**

## Where it is going

### Now: handover engineering

The sponsor reframed the remaining work as handover. Someone outside the
founding team must be able to run this. That argues consistently for fewer
moving parts, obvious code over clever code, and documentation budgeted as
real work rather than done at the end.

Concretely, the highest-value remaining items:

- **A Firestore and Auth emulator setup.** `firebase.json` configures a
  Firestore emulator, but only the rules test runs against it. The server's
  Admin SDK will follow `FIRESTORE_EMULATOR_HOST`; the browser SDK has no
  emulator wiring and there is no Auth emulator, so the app still needs a real
  project. Closing that is the single biggest handover investment available:
  it would let someone run the whole system with no GCP project and no Google
  credentials at all.
- **Backups.** A weekly managed export now lands in GCS, and the database has
  point-in-time recovery and delete protection on. The gap left is the restore
  path: it is documented and has never been run, so nothing destructive should
  be attempted until someone has imported a copy back and looked at it.
- **The runbook kept honest** as the system changes.

### Later, and deliberately deferred

- **The automatic route**: a mission reaching the rover without an operator
  carrying it. Planned in
  [`yard/docs/automatic-route-plan.md`](yard/docs/automatic-route-plan.md),
  not built. Since nothing can push to the yard, Mission Control queues and
  the satellite pulls, over outbound HTTP. It removes today's guardrail that a
  human in the room presses Send, so the first step is a claim: a code shown
  on the yard's own screen and typed into Mission Control by the operator
  standing in front of it, held in memory and gone when the yard is switched
  off. The manual loop stays underneath, and is what a yard falls back to
  with no internet.
- **Uploading the video from the yard.** Mission Control holds a read-only
  YouTube API key and there is no OAuth client that could upload, so today
  the operator uploads by hand and the linker finds it. Setting up that
  client is the prerequisite, and should be proved by hand before any code
  depends on it.
- **Merging back upstream**, after Werner's cloud team reviews the Terraform.

## Known gaps

Recorded here rather than left for someone to rediscover:

- **Learner code is stopped, not contained.** The rover's runner ends a
  program when stop is pressed or after 120 seconds of wall-clock time, so a
  `while True:` is cut off at the limit. It does that through a trace hook,
  and a call that blocks inside C never returns to the interpreter to be
  stopped.
- **Monaco loads from a CDN**, render-blocking in `<head>`. The yard works
  with no internet, but a captive-portal network could stall the page. Adding
  `defer` alone would break it: the bootstrap checks `typeof require`.
- **Mission code is still free text** via comments and `print()`, documented
  in `docs/THREAT-MODEL.md`.
- **`pca9685` is not vendored**, so the rover Pi still needs the 4tronix
  install alongside this repository.
- **A secret printed to a terminal still needs revoking.**
  `YOUTUBE_CLIENT_SECRET` is no longer read by anything in the code, but the
  credential it belongs to works until it is rotated or deleted in Google
  Cloud. `OPERATOR_SESSION_SECRET`, printed alongside it, is retired: the
  satellite no longer has sessions to sign.

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
