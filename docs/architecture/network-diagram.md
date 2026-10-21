# Network Diagram

Companion writeup for `Mission Control: Network Diagram` (August 2026).

> **The drawing is out of date on the yard; this text is not** (updated
> 21 October 2026). The picture still shows the satellite's Firestore mirror,
> its sync worker and its signed-in console, none of which exists any more.
> Zone A still holds as drawn. Zones B and C below describe the yard as it is
> now, on the router's network.

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

## B. The yard's network (`mars-relay-network`)

Below the trust boundary, and the label matters: this network is *frequently
offline*, not occasionally. Everything here is designed to keep working when the
arrow to the cloud goes dead.

A Cudy LT300 router serves `mars-relay-network` to the satellite, the rover and
every tablet, laptop and TV in the room. For the internet it joins whatever
wifi the venue has, in WISP mode, or a SIM. How it is set up is
[`yard/docs/yard-network.md`](../../yard/docs/yard-network.md). Before the
router the satellite served the wifi itself and had no internet, which is
still the fallback.

The satellite (`mro.local`, a Pi 5) serves the yard's pages: `/run/`, the run
station where an operator sends a mission and films it; `/code/` on tablets;
`/monitor/` on the TV; and `/settings`. None has a sign-in and none touches
Firestore. A mission arrives from Mission Control's operator console in the
handoff URL, or by paste. Two background jobs run with nobody waiting on them:

- `mission_watcher.py` polls the rover and stops a recording when its run is
  over.
- `camera_server.py` streams the camera on 8890, to the run station and the
  monitor, separately from the rover, so a rover fault does not blank either.

Outbound, through the router, everything is best effort and off the run path:
the clock, `git pull`, and, once automatic upload is set up, a finished
recording posted to Mission Control with a shared secret. If any of it fails,
the mission still ran.

## C. Rover (`curiosity.local`) and hardware

The run station dispatches a mission over plain HTTP to `rover_server.py`, a Flask
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
effort. An internet outage degrades uploads and email. It does not stop a mission.

## Known caveats

- **No sign-in on the yard's network.** Anyone on `mars-relay-network` can use
  the satellite's pages and drive the rover. The defence is the wifi password
  and the room, and the yard's passwords are still in git history (AB#429), so
  the password is weaker than it looks until they move to a password manager.
- The router joins one venue network at a time and is changed by hand at each
  new place. Without a SIM, a new venue means no internet until someone does.
