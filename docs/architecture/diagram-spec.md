# Architecture Diagram v2: design specification

Blueprint for the replacement architecture diagram. The paste-ready generation
prompt is in [diagram-prompt.md](diagram-prompt.md). The reasoning you defend in
review is in [design-decisions.md](design-decisions.md).

---

## 1. What is wrong with v1

| Problem | Effect in a review |
|---|---|
| No network or trust boundary | The most load-bearing constraint (the yard is often offline) is invisible |
| Arrows are all the same arrow | Cannot distinguish a blocking call from a background reconcile from a stream |
| Stale content | `AuthContext` does not exist, the sandbox executor is drawn in the hub but lives on the rover, the PyQt6 simulator is drawn at production weight |
| The offline story is absent | SQLite mirror, outbox, leases, recovery: none of it appears, and it is the most defensible engineering in the repo |
| Everything is a bullet list | Reads as an inventory of files rather than a picture of a system |

---

## 2. Governing ideas

**Organise by network boundary, not by technology.** The system is three
environments with very different failure modes: cloud (metered, world-readable),
venue LAN (frequently offline, authoritative about what physically happened), and
the rover (irreversible actions). Drawing the boundaries first is what makes the
rest legible.

**Density is the primary quality bar.** v1 failed by being crowded, and the first
regeneration failed the same way by adding a legend band, a complexity index and a
numbered walkthrough on top of already-full nodes. The rule that fixes it: **no
node carries more than four lines of body text**, and when something does not fit
it gets cut, never shrunk.

**Show complexity structurally, do not annotate it.** No badges, no index. The
drawing earns the same point by drawing the right things: the abstract
`RoverDriver` sitting above its two implementations, the sync worker's two arrows
labelled in order (push, then pull), the lease fields named inside the mirror
table. The written defence lives in `design-decisions.md`, which is where a
reviewer can actually read it.

---

## 3. Bands

Landscape, 1600 x 1000. Four bands, separated by full-width labelled rules. The
two boundary rules are the heaviest lines on the page, heavier than any node
border.

```
TITLE
BAND A  PUBLIC INTERNET / GOOGLE CLOUD        A1 devices | A2 hub | A3 managed services
════ TRUST BOUNDARY: internet | venue LAN, frequently offline ════
BAND B  VENUE LAN: yard satellite (mro.local) B1 surfaces | B2 console | B3 mirror | B4 threads
──── DEVICE BOUNDARY: physical actuation ────
BAND C  ROVER (marspi.local) + hardware       one left-to-right pipeline
BAND D  PLATFORM & DELIVERY                   one slim strip, dev rail at its right end
```

Spacing: 32px minimum between sibling nodes, 56px between bands. Nothing below
12px.

---

## 4. Node inventory

Verified against the repo. Each entry below is already trimmed to what should
appear on the canvas; resist re-expanding it.

**A1 Learner devices.** Desktop browser, tablet browser, TV monitor. Icons and
one-word labels only.

**A2 Mission Control Hub** (Next.js 16 / React 19 / TS, Cloud Run). One container,
four stacked strata, one line each, with a downward arrow labelled "dependencies
point inward":

1. Presentation: Blockly and Monaco editors, 2D canvas simulator, public feed
2. API routes: `/api/missions`, `/api/learners`, Zod at the edge
3. Core domain: Mission and Learner, `IMissionRepository` and `IEmailSender`
   ports, MissionService, AllowlistService
4. Infrastructure: FirestoreMissionRepository, firebase-admin, ResendEmailSender,
   allowlist analyzer

**A3 Managed services** (external styling: lighter fill, dashed left edge).
Firestore with four collections named (`missions` world readable, `learners`,
`learners/{id}/private` Admin SDK only, `users`); Firebase Auth; Resend; YouTube
Data API.

**B1 Surfaces.** `/code/`, `/monitor/`, `/status`, `/operator/`. Labels only.

**B2 Operator console** (`operator_console.py`). Flask blueprint, Firebase
sign-in with custom claims, actions (send, complete, cancel, attach video), plus
a small amber `OPERATOR_AUTH=off` tag.

**B3 SQLite mirror** (`mission_store.py`). Cylinder, four tables:
`mission_mirror (lock_owner, lease_expires_at)`, `outbox`, `sync_meta`,
`conflict_log`.

**B4 Background threads.** `sync_worker.py` (only component reaching Firestore
from the yard), `mission_watcher.py` (polls, completes only what the rover
confirms), `recovery.py`, `satellite_identity.py` (holds the lease),
`camera_control.py`.

**Band C.** `rover_server.py` (Flask, four endpoints) to `RoverQueueService`
implementing abstract `RoverQueuePort` (FIFO queue, worker thread, sandboxed
`run_python` with a wall-clock watchdog) to `RoverDriver` abstract forking to
`FakeRoverDriver` and `RealRoverDriver`. Hardware: M.A.R.S.
rover on a Pi Zero; separate node for the Pi AI Camera IMX500 on a Pi 5, WS 8890.

Band C carries no physics model. `rover_physics.py` is deprecated and nothing
imports it outside its own test; the simulation the yard renders is the
compiled TypeScript one. Draw it in the deprecated group in Band D, not here.

**Band D.** Terraform to GitHub Actions to Artifact Registry to Cloud Run
(staging, prod) to Secret Manager, with Workload Identity Federation tagged
"OIDC, no JSON keys". At the right end, a small dashed greyscale group at 60%
opacity: `legacy/simulator/roversimui.py`, `legacy/simulator/roversimulator.py`, `rover_physics.py` (deprecated),
`dev-launcher.js`, Jest, pytest.

---

## 5. Edge grammar

Three types plus one exception, distinguished by dash pattern so the drawing
survives greyscale. **No legend.** Only band-crossing edges get a label, set in a
small paper-coloured pill.

| Stroke | Meaning |
|---|---|
| Solid 2px, filled arrowhead | Synchronous request, caller waits |
| Dashed 6-4 | Background or scheduled, nobody waiting |
| Two thin parallel lines | SSE or WebSocket, long lived |
| Thick 4px green (exception) | Physical actuation, driver to hardware |

Roughly a dozen edges total. Extra edges are the main cause of clutter, so the
prompt enumerates the exact set. The one that must read clearly is the sync
worker's pair: two dashed arrows to Firestore labelled "1. push outbox" and
"2. pull incremental", because the ordering is a correctness property, not an
implementation detail.

No unmarked crossings (use arc hops). Bidirectional relationships are two arrows,
never one double-headed arrow.

---

## 6. Visual system

- Warm paper ground `#FAF7F2`, ink `#1A1D21`.
- Band accents only as a thin top rule and a header chip, never a large fill:
  cloud indigo `#3B4CCA`, yard teal `#0E7C7B`, rover forest `#2F6B3A`, platform
  slate `#475569`.
- Node fills paper or 4% ink. No gradients, shadows, 3D or emoji. Depth comes from
  border weight and whitespace.
- One typeface. Band headers 20px bold uppercase with letter spacing, node titles
  15px semibold, body 12px, edge labels 11px in a pill.
- One small monochrome line icon per node at most.
- 8px grid, 8px node radius, 12px container radius.
- Both colour schemes via CSS custom properties: light default, plus
  `prefers-color-scheme: dark` and `:root[data-theme]` overrides on ground
  `#12100E` / ink `#F2EFE9`.

---

## 7. Output format

Inline SVG in a single self-contained HTML page. Not raster, not Mermaid.

SVG scales to a projector and to A3 print and stays diffable in git. Mermaid
cannot express the band bars, the four-stratum hub container or the inheritance
fork without fighting the renderer.

If a pass still reads tight, cut in this order: the dev rail, the `/status`
surface, the Firestore collection list.
