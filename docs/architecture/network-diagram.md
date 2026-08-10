# Network Diagram

Companion writeup for `Mission Control: Network Diagram` (August 2026).

Where the architecture diagram shows how the software is structured, this one
shows where the network boundaries fall, what protocol crosses each one, and
which connections the system can survive losing. Three zones, split by a trust
boundary.

## A. Public internet and Google Cloud

Learner devices reach the Mission Control Hub over HTTPS. The Hub runs on Cloud
Run as a single Next.js service, internally layered so dependencies point
inward: presentation, API routes, core domain, infrastructure. Outbound it talks
to Firestore (gRPC/HTTPS), Firebase Auth, Resend for learner status email, and
the YouTube Data API to link a published clip back to its mission.

One arrow bypasses the Hub: browsers read the public mission feed **directly
from Firestore**. Public reads are world-readable by rule, so routing them
through the application server would add cost and a failure point for no
security gain. Private learner data (`learners/{id}/private`) is reachable only
through the Admin SDK, server side.

## B. Venue LAN, yard satellite (`mro.local`)

Below the trust boundary, and the label matters: this network is *frequently
offline*, not occasionally. Everything here is designed to keep working when the
arrow to the cloud goes dead.

The satellite serves four browser surfaces: `/code/` on tablets, `/monitor/` on
the TV, `/status` for config and health, and `/operator/` for the console. The
console is a Flask blueprint using Firebase sign-in with custom claims, with
`OPERATOR_AUTH=off` as a documented event-day bypass, because a login prompt
failing in front of a queue of children is a worse outcome than an
unauthenticated console on a private venue LAN.

Every console action reads and writes the **local SQLite mirror**, never
Firestore. The mirror holds `mission_mirror` (with `lock_owner` and
`lease_expires_at` for multi-satellite safety), plus `outbox`, `sync_meta` and
`conflict_log`. Four background threads run asynchronously with nobody waiting
on them:

- `sync_worker.py` is the *only* component in the yard that touches Firestore,
  and it always pushes the outbox before pulling incrementally, so local truth
  wins a race with a stale remote read.
- `mission_watcher.py` polls the rover and completes only what it can confirm.
- `recovery.py` cleans up missions interrupted by a restart.
- `satellite_identity.py` holds this yard's mission lease.
- `camera_control.py` starts and restarts the camera stream.

The notify call back to the Hub is marked **best effort** deliberately. If it
fails, the mission still completed.

## C. Rover (`marspi.local`) and hardware

The console dispatches a mission over plain HTTP to `rover_server.py`, a Flask
app exposing `/queue/add`, `/queue/status`, `/queue/events` and `/photo`.
`RoverQueueService` holds a FIFO queue with a single worker thread, running
sandboxed Python under a wall-clock watchdog. It calls the abstract
`RoverDriver`, satisfied by either `FakeRoverDriver` or `RealRoverDriver`. That
seam is why the entire stack can be developed and tested with no hardware
present.

The green arrow is the only one of its kind on the page: **physical
actuation**, into the 4tronix M.A.R.S. rover on a Pi Zero (motors, 16 servo
channels, LEDs, ultrasonic). Past that arrow, a call moves something in the real
world. The Pi AI Camera sits on a separate Pi 5 and streams to the monitor over
WebSocket on 8890, independent of the rover, so a rover fault does not blank the
display.

## Reading the lines

Solid means synchronous: a caller is waiting. Dashed means background or
scheduled: nobody is waiting, and failure is recoverable on the next pass.
Doubled means a long-lived stream, either SSE for execution events or WebSocket
for the camera. Read that way, the diagram answers the operational question
directly: which connections must be up right now, and which can fail quietly
until the next cycle.

## Why it is shaped like this

One constraint drives all of it. *The rover must stay drivable when the venue's
internet is down.* So the cloud owns storage, authentication and publication,
while control, monitoring and execution stay on the venue LAN. Notice that no
solid arrow crosses the trust boundary: every cloud dependency is dashed or best
effort. An internet outage degrades sync and email. It does not stop a mission.

## Known caveats

- `OPERATOR_AUTH=off` is a real bypass, shown on the diagram on purpose. The
  defence is private LAN, physical access control, and event-day reliability.
  Better owned than found.
- "The only component that reaches Firestore from the yard" is a strong claim
  and it currently holds. Keeping it true is what makes the offline story
  auditable in one file.
