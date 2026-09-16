# Paste-ready prompt

Copy everything between the rules into Claude. Self-contained: assumes no repo
access. Regenerated 16 September 2026 from
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md); the yard band now matches the
system as it is, not the retired mirror-and-sync design the August prompt drew.

---

Produce a **system architecture diagram** as a single self-contained HTML page
containing one inline `<svg>`. No external fonts, scripts, stylesheets or images.
It must be legible projected in a room and printed on A3.

**The most important requirement is that it does not feel congested.** Prefer
white space over completeness. If something does not fit, cut it rather than
shrink it.

## The system

"Mission Control" is an educational robotics platform. School learners write or
block-build Python that drives a physical 4tronix M.A.R.S. rover at a science
centre. A cloud web app collects missions; an operator at the venue dispatches
them to the rover; the run is filmed and the video published back to the
learner. The venue network is frequently offline, so the yard runs
offline-first: nothing on the run path leaves the LAN.

**The one idea the drawing must carry:** no network path joins the cloud and
the yard. No server calls a server across that line, and nothing syncs. The
only bridge is the operator's browser, a device physically standing on the
venue LAN while signed in to the cloud console. It carries each mission across
by navigation, and the video comes back by way of YouTube. If a reader takes
away one thing, it is that boundary and the person straddling it.

## Layout

Landscape, 1600 x 1000 viewBox. Four horizontal bands separated by full-width
labelled rules, organised by network boundary rather than by technology. The two
boundary rules are the heaviest lines on the page.

```
TITLE
BAND A   PUBLIC INTERNET / GOOGLE CLOUD
════ TRUST BOUNDARY: internet  |  venue LAN, frequently offline ════
         (the operator's browser is drawn ON this rule)
BAND B   VENUE LAN: yard satellite (mro.local:3001)
──── DEVICE BOUNDARY: physical actuation ────
BAND C   ROVER (marspi.local:8523) + hardware
BAND D   PLATFORM & DELIVERY  (one slim strip)
```

## Density rules (enforce these)

- **No node may contain more than four lines of body text.** Where a list would
  run longer, name the group and give three representative members, not all of
  them.
- Minimum 32px of empty space between any two nodes, 56px between bands.
- No legend, no key, no index table, no numbered walkthrough, no scope note.
  Anything a reader needs must be readable off the node or the edge label itself.
- Nothing below 12px. If type would need to shrink, remove content instead.

## Band A: cloud

**A1 Learner devices** (small, far left). Desktop browser, tablet browser.
Icons with one-word labels, no body text.

**A2 Mission Control**, Next.js on Cloud Run. One container holding **four
stacked strata**, with a single arrow down the left edge labelled "dependencies
point inward". One line per stratum, no more:

1. **Presentation** `src/app`, `src/components` : learner app, Blockly and
   Python editors, 2D simulator, operator console at `/operator`
2. **API routes** `src/app/api` : missions, operator desk actions, session
   exchange, Zod validation at the edge
3. **Core** `src/core` : Mission, MissionRun, Learner entities; safety rules
   (allowlist, speed and time ceilings); `IMissionReader` / `IMissionWriter` /
   `IMissionBookkeeping` ports
4. **Infrastructure** `src/infrastructure` : FirestoreMissionRepository,
   split composition roots (`container.server` privileged, `container.browser`
   rules-bound), Resend, YouTube

**A3 Managed services** (right column, lighter fill and a dashed left edge to
read as external). One line each:
- **Firestore** : missions, runs, learners; browser reads guarded by rules
- **Firebase Auth** : operator and admin sign-in, role as a custom claim
- **Resend** : learner status email
- **YouTube Data API** : finds the uploaded run video by its `MissionID:` line
- **Cloud Scheduler** : calls `/api/cron/youtube-link` every 15 minutes

## The trust boundary, and the operator's browser

Draw **the operator's browser as one node sitting on the boundary rule
itself**, half in each world. Title: "Operator's browser, on the venue LAN".
Body, three lines:

- live mission queue for this yard (Firestore listener)
- **yard checks** before send: camera, rover, recording, read from the
  satellite's `/api/status` over plain HTTP
- **Send to Rover** : navigates to the run station,
  `/run/?handoff=automatic&missionId=...` with the mission code in the URL;
  Copy to clipboard remains as the fallback

Give it one small amber tag: `cloud page, LAN fetch : Safari may need
local-network permission`.

## Band B: yard satellite, Flask on mro.local:3001

The satellite holds no cloud credential, asks for no sign-in, and talks only to
the rover and the camera on the LAN. Three columns.

**B1 Surfaces.** `/run/` operator run station, `/code/` tablet Blockly editor,
`/monitor/` TV display, `/settings` health and tunables. Four labels, no body
text.

**B2 One module per question** (the column to draw with care). Four rows, one
short clause each:
- `camera_state.py` : the single answer to "is the camera ready"
- `recording_control.py` : opens and closes recordings, keyed
  `(mission, yard)`, written `<mission>__<yard>__<UTC>.mp4`
- `mission_watcher.py` : the only background thread; polls the rover and closes
  the recording of any run it reports finished, reads and never dispatches
- `recording_cleanup.py` : prunes so the SD card never fills

**B3 Camera.** `camera_server.py`, WebSocket on 8890, frames to the monitor
and to `recording_control`. Small node.

Do not draw a database, an outbox, a sync worker or an operator console in this
band. The yard stores nothing but video files and settings, and that absence is
the design.

## Band C: rover, marspi.local:8523

Left to right, as a pipeline:

- **`rover_server.py`** Flask : `/queue/add`, `/queue/status`, `/queue/events`
  (SSE), `/photo`
- **`RoverQueueService`** implementing the abstract `RoverQueuePort` : FIFO
  queue, single worker thread
- **`python_runner.py`** : the learner-code sandbox, traced so the stop button
  interrupts a `while True`, wall-clock watchdog
- **`RoverDriver`** (abstract) drawn above its two implementations,
  `FakeRoverDriver` and `RealRoverDriver`, as a small explicit inheritance
  fork. Keep this fork visually clean, it is the one place the drawing should
  show a class relationship.
- **Hardware** : 4tronix M.A.R.S. rover on a Raspberry Pi (motors, servo
  steering, mast camera, ultrasonic)

Alongside the fork, one quiet caption: `mission_validator.py` and `limits.py`
gate every queued program (speed and time ceilings, calls the rover cannot
make).

Do not place any physics model in this band. The rover runs no physics; the
simulator is the same queue and drivers with `FakeRoverDriver` underneath, and
the simulation a learner sees is rendered by compiled TypeScript
(`roversim`, five modules built from `mission-control/src/lib`) served from the
satellite's static assets.

## Band D: platform and delivery

One slim horizontal strip, drawn as a left-to-right chain, small type:
Terraform (GCS remote state) to GitHub Actions (five required checks:
mission-control, rover, satellite, browser tests, Firestore rules) to Artifact
Registry to Cloud Run (staging and prod) to Secret Manager, with Workload
Identity Federation tagged "OIDC, no JSON keys" at the end.

## Edges

Three types only, distinguished by dash pattern so the drawing survives
greyscale. **Do not draw a legend for them.** Instead label the handful of
edges that cross a band with their protocol, set in a small paper-coloured
pill.

- **Solid 2px, filled arrowhead** : synchronous request, caller waits
- **Dashed 6-4** : background or scheduled work, nobody waiting
- **Two thin parallel lines** : SSE or WebSocket stream, long lived

Plus one exception: the driver-to-hardware edge is a **thick 4px green arrow**
labelled "physical actuation".

Draw roughly these edges and no more. Extra edges are the main cause of
clutter:

- learner devices to Mission Control (solid, "HTTPS")
- learner browser to Firestore (stream, "live feed, rules-guarded")
- Mission Control infrastructure to Firestore, Resend, YouTube (solid)
- Cloud Scheduler to Mission Control (dashed, "cron, shared secret")
- operator's browser to Firestore (stream, "live queue")
- operator's browser to Mission Control API (solid, "desk actions")
- operator's browser to satellite `/api/status` (solid, "yard checks, HTTP")
- operator's browser to `/run/` (solid, **"Send to Rover: mission in the
  URL"** ; this is the arrow that crosses the trust boundary, make it read as
  the bridge)
- run station to rover `/queue/add` (solid, "dispatch, mission id in params")
- camera to `/monitor/` and to `recording_control` (stream, "WS 8890")
- `mission_watcher` to rover `/queue/status` (dashed, "read only"), then
  `mission_watcher` to `recording_control` (dashed, "close on finish")
- rover `/queue/events` to satellite to `/monitor/` browser (stream, one
  continuous run labelled "SSE")
- `RoverQueueService` to `RoverDriver` to hardware (physical actuation)
- operator's browser up to YouTube (dashed, "video uploaded by hand"), then
  YouTube Data API back to Firestore by way of the cron route (dashed,
  "auto-link"). These two carry the video back across the boundary; let them
  arc over the rule rather than pass through the satellite.

Never cross two edges without an arc hop. Draw bidirectional relationships as
two separate arrows.

## Visual system

- Warm paper ground `#FAF7F2`, ink `#1A1D21` for all text and structure.
- Band accents only as a thin top rule and a small header chip, never as a
  large fill: cloud indigo `#3B4CCA`, yard teal `#0E7C7B`, rover forest
  `#2F6B3A`, platform slate `#475569`.
- Node fills are paper or 4% ink. No gradients, no shadows, no 3D, no emoji.
  Depth comes from border weight and whitespace.
- One typeface (system UI stack). Band headers 20px bold uppercase with letter
  spacing, node titles 15px semibold, body 12px regular, edge labels 11px in a
  paper-coloured rounded pill.
- At most one small monochrome line icon per node, as inline SVG paths.
- 8px grid, 8px node radius, 12px container radius.
- Support both colour schemes via CSS custom properties on the SVG: light by
  default, plus `@media (prefers-color-scheme: dark)` and
  `:root[data-theme="dark"]` / `:root[data-theme="light"]` overrides using
  ground `#12100E` and ink `#F2EFE9`.
- Wrap the SVG in a container with `overflow-x: auto` and `max-width: 100%` so
  the page never scrolls horizontally.

## Deliverable

One HTML file, one inline SVG, one `<style>` block. Title it "Mission Control:
system architecture". Small "as of September 2026" stamp in a corner. No
Mermaid, no diagramming library, no raster image.

---

## Notes for you, not for the prompt

- The load-bearing change since the August diagram: the yard's console, SQLite
  mirror and sync worker are gone, and the operator moved into Mission
  Control. The bridge is now the operator's browser and its Send-to-Rover
  handoff. The drawing shows that by placing one node on the boundary rule;
  everything else follows from it.
- If the first pass is still tight, cut band D first, then `/settings` and
  `recording_cleanup.py`, then the collection list inside Firestore. In that
  order.
- [diagram-spec.md](diagram-spec.md) still specifies the August drawing and is
  kept for its reasoning about form (boundaries, edge grammar, density). This
  prompt, generated from [`ARCHITECTURE.md`](../ARCHITECTURE.md), is the
  current content. When the system changes, edit ARCHITECTURE.md first,
  regenerate this prompt from it, diff the SVG.
