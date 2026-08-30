# Iteration 3 Backlog

Presentation: **17-18 September 2026**. Iteration 4 (final): 26-27 October 2026.

Grouped by **dependency**, not by person. Work down the groups: anything in a
later group assumes the groups above it have landed. Within a group, items are
independent of each other and can run in parallel.

Sources: the iteration-2 presentation marksheet (51/80), the coding marksheet
(32.3/56), the 2026-08-20 standup, and our own technical backlog.

---

## The architecture we are building towards

Settled, and everything below assumes it.

**A mission is a program. A run is one attempt at it.**

```
missions/{id}                     the program a learner wrote
  name, code, blocklyState, learnerRef, submittedAt

missions/{id}/runs/{yardId}       one attempt per yard
  status, startedAt, completedAt, youtubeUrl, needsReview, reviewReason
```

- A mission is **not** tied to a yard when submitted. The learner never picks
  one and does not know what a yard is.
- **Any yard may run any mission, including two yards at once.** Each attempt is
  independent: its own status, its own video.
- The learner's mission page shows a yard selector built only from runs that
  produced a video. A failed run is simply a yard that is not in the list, which
  also keeps the rule that a learner never sees "Failed".

**There is no lock anywhere.** Two yards running the same mission is a feature,
not a race. Within a yard, the duplicate-send guard is just reading state we
already have: if `runs/{yardId}` exists and is `processing`, refuse. The rover
serialises physically on its own, because its queue is FIFO with a single worker
thread.

**Firestore is the only channel between cloud and yard.** Not a preference. The
satellite is on mobile data behind carrier NAT with no inbound port and no
tunnel; the yard is plain HTTP; Mission Control is HTTPS. A browser cannot reach
the satellite (mixed content) and neither can our server.

**Two surfaces, different jobs.** Mission Control `/operator` is the operator
console: queue, mission detail, dispatch, complete, attach video. The satellite
keeps a **yard control panel**: STOP, arm, camera, health, and offline dispatch
when the network dies. That is why the Flask console is not being deleted, and
it is the honest answer to "did you actually unify it".

**STOP never moves to the cloud.** It would take up to a sync interval to arrive
and would silently do nothing when offline, which is the worst possible
behaviour for the one control whose whole justification is immediacy.

---

## Group 0: Done since iteration 2

Closed already, listed so nobody re-opens them.

| Item | Where |
|---|---|
| Speed/argument ranges validated (the 0-100 gap the marker found) | PR #78 |
| Rover errors surfaced to the operator instead of failing silently | PR #78 |
| Needs-review count no longer sticks; review list no longer hidden | PR #78 |
| Blockly block definitions shared, not duplicated (-526 lines) | PR #79 |
| Browser tests actually run in CI (they ran nowhere) | PR #80 |
| Yard-scoped Firestore pull; dead code and an unauthenticated write removed | PR #81 |
| Non-production banner reading the environment at runtime | PR #82 |
| Domains live on HTTPS, email sending from a verified domain | #73, #75 |

---

## The board, mapped onto these groups

Sprint 6 "Satellite Work" is mostly the **recording loop**, which is David's
stated goal for this sprint: an operator clicks run, the satellite records, the
video uploads, and it all works without anyone touching a file.

| ID | Story | Group |
|---|---|---|
| 330 | Mission name auto-assigned (Active) | 5 |
| 332 | Mission patch from the name | 5 |
| 334 | Camera ready before a mission runs | 4 |
| 335 | Camera auto-records when a mission runs | 4 |
| 336 | Recording stored against its mission | **4, needs 2a** |
| 337 | Successful recordings uploaded to YouTube | **4, needs 336** |
| 338 | Stopped/failed recordings handled correctly | **4, needs 336** |
| 341 | Operator console routes protected | 2b |
| 342 | Operator login to Mission Control | 2b |
| 105-109 | Mission history | Closed |

**Two things fall out of this mapping.**

**336 and 337 are the reason to do the run model early.** "Store a recording
using its corresponding mission ID" is ambiguous the moment two yards run the
same mission: one mission, two recordings, one `youtubeUrl` field. Keyed by
**run** it is unambiguous, and 338 (a stopped or failed recording must not look
successful) becomes a property of that run rather than a special case bolted on.
The run model is not architecture for its own sake here; it is what makes the
sprint's main deliverable correct.

**334 and arming are the same shape.** Both ask "is this yard ready to run
something?" before dispatch. Rather than two independent preconditions that can
disagree, make readiness one check: armed, camera up, rover reachable. One
answer, one place to show it, one thing to explain to an operator.

---

## Group 1: Foundations

Nothing else depends on these being done first, but several things get easier
once they are. Start here.

- [ ] **Rebuild the satellite.** It was reflashed and is bare: clone, venv with
      `--system-site-packages`, `.env`, systemd units, rover URL. Set `YARD_ID`
      explicitly. See `yard/docs/satellite.md`.
- [ ] **Remove hard-coded `/home/mars` paths** from the three systemd units in
      `yard/deploy/`. Flagged by the coding marker. Note the mirror's DB path
      comment: it works in production *only* because the unit sets
      `WorkingDirectory`, so this is load-bearing, not cosmetic.
- [ ] **Firebase data migration to Impact.** Do it in the same pass as the run
      model below so learner data reshapes once, not twice.
- [ ] **Database backups and disaster recovery.** Werner's ask. No backups exist
      while we are adding write paths. Nothing in Group 4 should touch real event
      data until mission data is exported somewhere off Firestore.
- [ ] **`ROADMAP.md` and a changelog** at the repo root, plus restoring previous
      sprint markdown into `docs/`. "Context as code" from the standup.

---

## Group 2: Data model and roles

**Everything operator-facing depends on these.** Two independent tracks that can
run in parallel.

### 2a. The run model

- [ ] **Split mission into program + `runs/{yardId}`.** Status, timestamps,
      `youtubeUrl` and review flags move onto the run. A subcollection, never an
      array: two yards updating one array field is a lost-update bug.
- [ ] **Backfill existing missions**: each gets one implicit run at
      `curiosity` (the rover's own hostname). Reversible script, dry-run by default.
- [ ] **Delete the satellite lease**: owner, expiry, renewal timers, reclaim
      branch. The contention they guarded cannot occur once yards write disjoint
      documents. Rewrite the ~15 lease tests to assert behaviour, not mechanism.
- [ ] **Simplify the sync merge.** `_RANK` and `should_local_win` exist to
      arbitrate disagreement about one mission's status; two yards can no longer
      disagree.
- [ ] **Multiple videos per mission** falls out of this. Today a rerun actively
      *deletes* the previous run's video.

### 2b. Roles and auth

- [ ] **Claim-based `isOperator()` / `isAdmin()`** via `request.auth.token.role`.
      Today `firestore.rules` reads a `users/{uid}` document while the yard reads
      the token claim, so two scripts exist to write both stores and they
      disagree about `admin`.
- [ ] **`yardIds` on the operator claim.** `role` decides what they may do,
      `yardIds` decides where. The shape already exists in deleted code
      (`git show 30aacc2^:.../operator-claims.ts`).
- [ ] **Delete the `rover-configs` rule and index.** Zero code references.
- [ ] **Extend `scripts/firestore-rules-test.mjs`** to cover authed requests and
      wire it into CI. It exists, tests rules against the emulator, and is not in
      CI at all.
- [ ] **AB#341**: operator console routes protected. The lock, with no key yet.
- [ ] **AB#342**: operator signs in to Mission Control. The key.

---

## Group 3: The operator console

Needs Group 2. This is the visible iteration-3 deliverable.

- [ ] **Read-only queue** at `/operator`, live via `onSnapshot`, scoped by the
      operator's `yardIds`. Shows **who submitted** each mission and the blocks
      they actually built, neither of which the Flask console can do.
- [ ] **Hidden route**: no nav entry (the navbar renders twice, desktop and
      mobile), `robots.ts`, no `<Link>` to it. Write down that hidden is not
      secure; the session cookie is the control.
- [ ] **Learner mission page gains the yard selector**, built from runs with
      video.
- [ ] **Bookkeeping actions**: complete, cancel, attach video, resolve review,
      delete (admin only). All against a run. Nothing here moves a robot.
- [ ] **Resolve-review control.** The endpoint has existed all along with no UI.

---

## Group 4: The yard, and the recording loop

The bulk of the sprint. Independent of Group 3, and the safety work must land
before cloud dispatch.

### 4a. Readiness, before anything records

- [ ] **334, camera ready before a mission runs.** Do not dispatch into a run
      nobody will have a video of.
- [ ] **Arming**, merged with 334 into one readiness check. The satellite refuses
      a dispatch unless the yard is armed, the camera is up and the rover is
      reachable. Countdown on the TV so the room can see the rover is live.
      Auto-disarm on STOP.
      **`ARM_PIN` must not honour `OPERATOR_AUTH=off`.** That is the event-day
      mode, so otherwise anyone on venue wifi can arm the yard on exactly the day
      it matters. Highest-severity item in this document.
- [ ] **`satellites/{yardId}` heartbeat**: last seen, armed, camera up, rover
      reachable, outbox depth. Without it the cloud Send button is a black box,
      and it is the building block for Werner's outage monitoring.

### 4b. Recording

- [ ] **335, camera starts recording automatically when a mission runs.** Works
      against the current local dispatch path; no dependency on Group 2.
- [ ] **336, a recording is stored against the run that produced it.**
      Needs 2a. Keyed by mission alone, two yards running the same mission
      collide on one `youtubeUrl`.
- [ ] **337, successful recordings upload to YouTube.** Needs 336. The
      `youtubeUrl` lands on the run, which is also what gives the learner a yard
      selector instead of a single video.
- [ ] **338, a stopped or failed recording is never presented as successful.**
      Needs 336. Ties into the review flow: the watcher now reads the rover's
      error outcomes, so "the code never ran" and "it ran and we have video" are
      already distinguishable.
- [ ] **Storage headroom.** The satellite is a 64GB SD card, which David
      described as a cache before upload, not an archive. Decide what prunes
      recordings once uploaded, before an event fills the card.

### 4c. Dispatch from the cloud

- [ ] **Cloud dispatch.** The dispatch route creates `runs/{yardId}`; a Firestore
      listener plus a poll path picks up runs for this yard. Behind
      `CLOUD_DISPATCH=off`, enabled per event.
      *Cut this first if September gets tight: everything above still delivers a
      unified console, and dispatch keeps working locally exactly as it does now.*

---

## Group 5: Learner experience

From the presentation marksheet. Mostly independent of everything above, so this
can run in parallel throughout.

### Safety and validation
- [ ] **AB#348, code validation that teaches.** Each problem on its own line
      number, marked in the editor, in language a nine-year-old can act on.
      Findings already carry line numbers and are then concatenated into one
      string.
- [ ] **Share the allowlist validator with the yard editor.** `/code/` currently
      posts straight to the rover with **no validation at all** and no
      `mission_id`, so nothing tracks the result either. Same build pattern as
      the Blockly extraction.
- [ ] **Mission duration limits and resource-usage controls.** Marker's ask.
- [ ] **Safeguarding for young users**: prevent unsafe or unintended
      communication and misuse. Marker called this out specifically.
- [ ] **Remove the free-text mission name**; generated names only.
- [ ] **Mission patches** from the generated name, via a local model or stable
      diffusion. Werner was firm about not spending LLM budget here.

### Usability
- [ ] **Responsive layout across screen sizes.** Information was hidden during
      the demo.
- [ ] **Simulator visual feedback**, including rover lights.
- [ ] **Fix the autoplay bug** seen in the demo.
- [ ] **Reset / start-state handling**, mute for sound.
- [ ] **Pagination and duplicate handling** in the feed.
- [ ] **Coding guidance and inline comments** aimed at younger learners.
- [ ] **Support the full 9-17 age range**: instructions matched to different
      literacy and coding experience.

### The equity argument, which is what the marks hang on
- [ ] **Structured progression**: levels, increasingly complex missions,
      achievements or guided objectives. The marker was explicit that storing
      previous missions does not show learning progression.
- [ ] **Demonstrate mobile access and low-connectivity operation.** We have built
      offline-first and never showed it. This is the equity proposition.
- [ ] **Acknowledge the science-centre and physical-rover dependency** in the
      deployment strategy rather than leaving it implicit.
- [ ] **Link the business value proposition explicitly to the system**, so it is
      immediately evident how it delivers equitable access.

---

## Group 6: Presentation and documentation

Needed for the mark, independent of the code.

- [ ] **State machine diagram** should represent system states, not process flow.
- [ ] **Architecture diagram** revised for higher cohesion and lower coupling.
      The run model and the shared modules are the substance behind this.
- [ ] **Solution overview** and a **user story map highlighting iteration 2**.
- [ ] **Burndown by story points**, not story counts. Add average velocity.
- [ ] **Explicit DevOps discussion**: we now have CI gating four jobs, staging
      auto-deploy on green, digest-promotion to prod, and Terraform in PRs. That
      is a strong story we did not tell.
- [ ] **Slide visual design** and readability.
- [ ] **Slow the demo down.** Marker said it moved too quickly in places.
- [ ] **Connectivity plan for the demo.** It failed live last time. David
      suggested Ethernet at the centre rather than contended building wifi.
- [ ] **Code organisation narrative.** The coding marker said the file count did
      not reflect a clear division of responsibilities. The shared-module work
      answers this; the answer has to be *shown*.
- [ ] **Handover runbook**: env-var matrix, granting an operator, what to do when
      the queue looks stuck, Firestore emulator setup.
- [ ] **Rotate the committed credentials.** Two WiFi passwords and an SSH
      password are in git history, in a repo with a public upstream.

---

## Group 7: Closing out

- [ ] **YouTube channel ownership to David.**
- [ ] **Infrastructure review with Werner's cloud team**, then merge the fork
      back into the upstream repo.
- [ ] **Real-world test** at a Cape Town library or school code club.

---

## Sequencing notes

- **Group 2a and 2b are the critical path.** Everything in Group 3 waits on them.
  They touch different files and can run at the same time.
- **Group 5 is parallel throughout** and is where most of the marksheet points
  are. It does not wait for anything.
- **The satellite work (Groups 1, 4) and the cloud work (2b, 3) touch nearly
  disjoint files**, so they split cleanly between people.
- **Do not run the run-model migration during a phase.** Land it between them,
  with an export taken first.
