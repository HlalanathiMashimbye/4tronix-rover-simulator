# Paste-ready prompt

Copy everything between the rules into Claude. Self-contained: assumes no repo
access.

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
centre. A cloud web app collects missions, an operator at the venue dispatches
them to the real rover, the run is filmed and published back to the learner. The
venue network is frequently offline, so the yard runs offline-first.

## Layout

Landscape, 1600 x 1000 viewBox. Four horizontal bands separated by full-width
labelled rules, organised by network boundary rather than by technology. The two
boundary rules are the heaviest lines on the page.

```
TITLE
BAND A   PUBLIC INTERNET / GOOGLE CLOUD
════ TRUST BOUNDARY: internet  |  venue LAN, frequently offline ════
BAND B   VENUE LAN: yard satellite (mro.local)
──── DEVICE BOUNDARY: physical actuation ────
BAND C   ROVER (marspi.local) + hardware
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

**A1 Learner devices** (small, far left). Desktop browser, tablet browser, TV
monitor. Icons with one-word labels, no body text.

**A2 Mission Control Hub**, Next.js 16 / React 19 / TypeScript, on Cloud Run.
One container holding **four stacked strata**, with a single arrow down the left
edge labelled "dependencies point inward". One line per stratum, no more:

1. **Presentation** `src/app`, `src/components` : Blockly and Monaco editors,
   2D canvas simulator, public mission feed
2. **API routes** `src/app/api` : `/api/missions`, `/api/learners`, Zod
   validation at the edge
3. **Core domain** `src/core` : Mission and Learner entities, `IMissionRepository`
   and `IEmailSender` ports, MissionService, AllowlistService
4. **Infrastructure** `src/infrastructure` : FirestoreMissionRepository,
   firebase-admin, ResendEmailSender, code allowlist analyzer

**A3 Managed services** (right column, lighter fill and a dashed left edge to
read as external). One line each:
- **Firestore** : `missions` (world readable), `learners`,
  `learners/{id}/private` (Admin SDK only), `users`
- **Firebase Auth** : operator sign-in, custom claims
- **Resend** : learner status email
- **YouTube Data API** : links a published clip to its mission

## Band B: yard satellite, Flask on mro.local:3001

Four columns.

**B1 Surfaces.** `/code/` tablet Blockly editor, `/monitor/` TV display,
`/status` config and health, `/operator/` console. Four labels, no body text.

**B2 Operator console** `operator_console.py`. Flask blueprint, Firebase sign-in
with custom claims. Actions: send to rover, mark complete, cancel, attach video.
Add one small amber tag reading `OPERATOR_AUTH=off  event-day bypass`.

**B3 SQLite mirror** `mission_store.py`. Draw as a database cylinder. Four table
names only, with the two fields that matter shown inside the first:
`mission_mirror (lock_owner, lease_expires_at)`, `outbox`, `sync_meta`,
`conflict_log`.

**B4 Background threads** (marked "async, no user waiting"). Five rows, one short
clause each:
- `sync_worker.py` : the only component that reaches Firestore from the yard
- `mission_watcher.py` : polls the rover, completes only what it confirms
- `recovery.py` : resolves missions interrupted by a restart
- `satellite_identity.py` : holds the mission lease for this yard
- `camera_control.py` : starts and restarts the camera stream

## Band C: rover, marspi.local:8523

Left to right, as a pipeline:

- **`rover_server.py`** Flask : `/queue/add`, `/queue/status`, `/queue/events`
  (SSE), `/photo`
- **`RoverQueueService`** implementing the abstract `RoverQueuePort` : FIFO
  queue, single worker thread, sandboxed `run_python` with a wall-clock watchdog
- **`RoverDriver`** (abstract) drawn above its two implementations,
  `FakeRoverDriver` and `RealRoverDriver`, as a small explicit inheritance fork.
  Keep this fork visually clean, it is the one place the drawing should show a
  class relationship.
- **`rover_physics.py`** : four-wheel steering model
- **Hardware** : 4tronix M.A.R.S. rover on a Raspberry Pi Zero (motors, 16 servo
  channels, LEDs, ultrasonic). Separate node: Pi AI Camera IMX500 on a Raspberry
  Pi 5, WebSocket on 8890.

## Band D: platform and delivery

One slim horizontal strip, drawn as a left-to-right chain, small type:
Terraform (GCS remote state) to GitHub Actions to Artifact Registry to Cloud Run
(staging and prod) to Secret Manager, with Workload Identity Federation tagged
"OIDC, no JSON keys" at the end.

At the right of the same strip, a small dashed group labelled "dev and simulation,
same code paths, no hardware": `roversimui.py` (PyQt6 viewer),
`roversimulator.py` (drop-in for the real rover module), `dev-launcher.js`, Jest,
pytest. Greyscale, roughly 60% opacity.

## Edges

Three types only, distinguished by dash pattern so the drawing survives greyscale.
**Do not draw a legend for them.** Instead label the handful of edges that cross a
band with their protocol, set in a small paper-coloured pill.

- **Solid 2px, filled arrowhead** : synchronous request, caller waits
- **Dashed 6-4** : background or scheduled work, nobody waiting
- **Two thin parallel lines** : SSE or WebSocket stream, long lived

Plus one exception: the driver-to-hardware edge is a **thick 4px green arrow**
labelled "physical actuation".

Draw roughly these edges and no more. Extra edges are the main cause of clutter:

- learner devices to hub API (solid, "HTTPS")
- learner devices to Firestore (solid, "direct read, public feed")
- hub infrastructure to Firestore and to Resend (solid)
- `sync_worker` to Firestore, as **two** dashed arrows labelled
  "1. push outbox" then "2. pull incremental", with the ordering visible
- operator console to `mission_store` (solid), and `mission_store` to
  `sync_worker` (dashed)
- operator console to rover `/queue/add` (solid, "dispatch")
- rover `/queue/events` to satellite to `/monitor/` browser (stream, one
  continuous run labelled "SSE")
- camera to `/monitor/` (stream, "WS 8890")
- `mission_watcher` to rover `/queue/status` (dashed, "read only")
- operator console to hub `/api/missions/[id]/notify` (dashed, "best effort")
- `RoverQueueService` to `RoverDriver` to hardware (physical actuation)

Never cross two edges without an arc hop. Draw bidirectional relationships as two
separate arrows.

## Visual system

- Warm paper ground `#FAF7F2`, ink `#1A1D21` for all text and structure.
- Band accents only as a thin top rule and a small header chip, never as a large
  fill: cloud indigo `#3B4CCA`, yard teal `#0E7C7B`, rover forest `#2F6B3A`,
  platform slate `#475569`.
- Node fills are paper or 4% ink. No gradients, no shadows, no 3D, no emoji.
  Depth comes from border weight and whitespace.
- One typeface (system UI stack). Band headers 20px bold uppercase with letter
  spacing, node titles 15px semibold, body 12px regular, edge labels 11px in a
  paper-coloured rounded pill.
- At most one small monochrome line icon per node, as inline SVG paths.
- 8px grid, 8px node radius, 12px container radius.
- Support both colour schemes via CSS custom properties on the SVG: light by
  default, plus `@media (prefers-color-scheme: dark)` and
  `:root[data-theme="dark"]` / `:root[data-theme="light"]` overrides using ground
  `#12100E` and ink `#F2EFE9`.
- Wrap the SVG in a container with `overflow-x: auto` and `max-width: 100%` so the
  page never scrolls horizontally.

## Deliverable

One HTML file, one inline SVG, one `<style>` block. Title it "Mission Control:
system architecture". Small "as of August 2026" stamp in a corner. No Mermaid, no
diagramming library, no raster image.

---

## Notes for you, not for the prompt

- Complexity is carried by [design-decisions.md](design-decisions.md), not by the
  drawing. What the diagram does instead is show structure that *is* the
  complexity: the abstract driver above its two implementations, the ordered
  push-then-pull pair of arrows, the lease fields named inside the mirror table.
  Shown, not annotated.
- If the first pass is still tight, cut band D's dev rail first, then the
  `/status` surface, then the collection list inside Firestore. In that order.
- Keep [diagram-spec.md](diagram-spec.md) beside the output. When the system
  changes, edit the spec, regenerate, diff the SVG.
