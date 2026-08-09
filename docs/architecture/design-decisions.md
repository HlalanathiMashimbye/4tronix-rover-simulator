# Design decisions: what we chose, why, and what we rejected

Companion to [diagram-spec.md](diagram-spec.md). Written to be defended out loud.
Each entry follows the same shape: the forcing constraint, the decision, the
alternative we turned down, where it lives in the code, and the honest limitation.
The limitation matters. A reviewer who finds a weakness you did not name will
discount everything else you said.

---

## 0. The four constraints everything follows from

Almost every non-obvious choice in this codebase traces back to one of these. If
you can only remember one slide, remember this one.

1. **Actions are physical and not replayable.** A rover crossing a room cannot be
   undone, retried idempotently, or rolled back. Anything that would be a cheap
   retry in a normal web system is a hazard here.
2. **The venue is frequently offline.** On Mandela Day the science centre wifi
   could not sustain Firebase sign-in. The system that fails at the door on a bad
   network is not a system that ran 45 missions that day.
3. **The users are children, and the data is theirs.** Learner email addresses on
   world-readable documents is a POPIA problem, not a code-style problem. A
   learner seeing "Failed" on their own work is a product failure even when it is
   technically accurate.
4. **We are running on free tiers with hard quotas.** Firestore allows 50,000
   document reads a day, shared between every learner loading the public feed and
   every satellite polling for work. Architecture that ignores read cost stops
   working in production and nowhere else.

Everything below is one of these four constraints, made concrete.

---

## 1. Ports and Adapters at the hardware edge

**Constraint.** Constraint 1. We cannot run a test suite against a real rover.
There is one rover, it is at a science centre, and it moves.

**Decision.** The rover backend is built as hexagonal architecture with two
explicit abstract boundaries:

- `RoverQueuePort` (abstract base) implemented by `RoverQueueService`, in
  [yard/rover/service.py](../../yard/rover/service.py). The Flask layer depends
  on the port, not the service.
- `RoverDriver` (abstract base) with `FakeRoverDriver` and `RealRoverDriver`, in
  [yard/rover/drivers.py](../../yard/rover/drivers.py). The driver is injected.

**Why this and not a mock or a flag.** A boolean like `if SIMULATION_MODE:`
sprinkled through the service means the tested path and the production path are
different code. Injecting a driver means the queue logic, the worker thread, the
history, the SSE broadcast and the sandbox are byte-for-byte the same in both
modes; only the last inch differs. That is the difference between a test that
proves something and a test that proves the test harness works.

**The detail worth pointing at.** `RoverDriver` carries a `hardware` class
attribute, and the `/status` page shows an amber badge when it is `False`. The
abstraction is not hidden from the operator. Someone standing in the yard can see
that the rover is faked, which is exactly the failure mode a clean abstraction
would otherwise conceal.

**Rejected.** Mocking `rover.py` in tests only. It would have left the fake path
untested in real use, and the fake path is what every developer runs every day.

**Limitation.** `RealRoverDriver` imports the `rover` module at construction, so
it is only constructible on a Pi. The abstraction is honest but it is not
uniform, and there is no integration test that runs the real driver in CI.

---

## 2. Sandboxing learner code, and why static analysis is not enough

**Constraint.** Constraints 1 and 3. Learner Python executes on a Raspberry Pi
that is wired to motors.

**Decision, three layers, each assuming the previous one failed.**

1. **Client-side allowlist** in
   [ast-allowlist-analyzer.ts](../../mission-control/src/infrastructure/sandbox/ast-allowlist-analyzer.ts)
   and
   [rover-command-allowlist.ts](../../mission-control/src/infrastructure/sandbox/rover-command-allowlist.ts).
   This layer exists for *feedback*, not security. A learner finds out at line 4
   that `import os` is not available, in the editor, immediately.
2. **Server-side validation** at the API edge: Zod schema, then the same
   allowlist re-run through `AllowlistService`, in
   [schemas.ts](../../mission-control/src/infrastructure/validation/schemas.ts).
   This layer exists because the client is attacker-controlled.
3. **Bounded execution** in `RoverQueueService.run_python`. Code is `compile()`d
   with the filename `<student-code>` so the trace function can tell student
   frames from rover internals, then run under a `sys.settrace` hook that raises
   `StudentCodeInterrupted` when either the stop button is pressed or a 120 second
   wall-clock deadline passes. `time.sleep` is swapped for an interruptible
   version so a sleeping program is still stoppable.

**Why the allowlist is a pattern matcher and not a real AST.** Real Python AST
parsing in the browser needs Pyodide or Skulpt, which is megabytes of WASM
shipped to a tablet on a science centre network, to gain precision on a layer
whose job is fast feedback. The security decision is made at layer 3, where the
code actually runs, so layer 1 is allowed to be approximate. This is stated in the
file header rather than left as an inference. Naming the weakness at the point
where the weakness lives is the difference between a shortcut and a decision.

**Rejected.** A denylist. Denylists are unbounded and each new Python feature is a
new hole. The allowlist starts restrictive and widens on demand, and a rejection
produces a message aimed at a learner rather than a stack trace.

**Limitation.** The trace-based watchdog stops Python-level execution; it does not
contain a process. A C-level call that blocks without returning to the
interpreter is not interruptible by `settrace`. Real containment would need a
subprocess with `rlimit` and a seccomp profile, which is the honest next step.

---

## 3. Clean architecture in the hub, and where we deliberately stopped

**Constraint.** The persistence layer was expected to change (Firestore was and
is a migration risk, see the blocked DB migration), and business rules had to be
unit-testable without a database emulator.

**Decision.** Dependency inversion around the storage and email boundaries only.
`MissionService` depends on `IMissionRepository`, not on Firestore;
`MissionNotificationService` depends on `IEmailSender`, not on Resend. The
concrete `FirestoreMissionRepository` and `ResendEmailSender` live in
`infrastructure/` and are wired at the API route.

**The payoff is provable, not theoretical.** Two things happened that this bought:

- Resend was swapped in after a SendGrid detour without touching a single
  application service.
- `MissionService` and `MissionNotificationService` have real unit tests with a
  fake repository, in `src/__tests__/unit/`, which is only possible because
  neither one can reach a network.

**Where we stopped, on purpose.** There is no repository abstraction over the
learner records, no CQRS, no domain events, no dependency injection container.
`missionQueryService` reads Firestore directly from the client for the public
feed, because that page is a read of world-readable data by an unauthenticated
browser and routing it through a server layer would add a Cloud Run hop and a
second read for no gain.

**Say this if challenged on "why isn't it consistent".** Abstraction is a cost
paid in indirection and repaid only when the thing behind it changes or needs
faking. We paid it exactly where we had a live migration risk (persistence) and a
live vendor risk (email). We did not pay it for the public feed, where neither
risk exists. Uniform abstraction is not a virtue; matched abstraction is.

**Limitation.** `IMissionRepository` has leaked slightly toward Firestore: the
cursor type is `{ submittedAt, id }`, which is a Firestore composite-cursor shape.
A different store would honour it, but the interface is not perfectly neutral.

---

## 4. Pseudonymisation: two hashes that are not the same decision

**Constraint.** Constraint 3, plus a structural fact: mission documents are
world-readable. The public discovery feed lists them, the Firebase web config
ships in the browser bundle, and Firestore rules cannot filter fields on read.
Anything stored on a mission is public. Full stop.

**Decision.** Nothing identifying goes on a mission document. Two separate
one-way SHA-256 hashes, for two different reasons, in
[learnerRef.ts](../../mission-control/src/core/domain/services/learnerRef.ts) and
[learnerEmailHash.ts](../../mission-control/src/core/domain/services/learnerEmailHash.ts).

**`learnerRef` is genuine pseudonymisation.** A learner id is a 21-character
nanoid, roughly 124 bits of entropy. Its hash cannot be reversed or brute forced.
The raw id never leaves `localStorage`. This restored a security property we had
lost: when raw ids were printed on every public card, possession of an id proved
nothing, so `POST /api/learners/[id]/email` could not authenticate its caller and
anyone could write an address onto anyone's record.

**`learnerEmailHash` is damage limitation, and we say so.** Email addresses are
low entropy. Someone who already suspects an address can confirm it by hashing
their guess. What the hash removes is **bulk harvesting**, which was the actual
exposure: read the feed, collect ids, fetch each learner document by exact id,
read a child's address in plaintext. The hash exists so a learner can find their
own missions from a second device by hashing the address they already know.

**Being able to articulate that difference is the whole point.** Two hashes that
look identical in the code have different threat models and different strengths,
and both file headers state which is which. A reviewer asking "isn't hashing an
email pointless?" is asking a good question, and the answer is "yes against a
targeted guess, no against enumeration, and enumeration was the real risk".

**The address itself** lives in `learners/{id}/private/contact`, a subcollection
browsers are denied entirely and only the Admin SDK reaches.

**Limitation, and it is in the rules file as a comment.** These rules stop the
bulk read. They cannot stop a forged write, because learner ids are still public
on older documents. Closing that needs ids to stop being published at all.

---

## 5. Firestore rules as least privilege, not as the security model

**Decision.** Every write that creates or advances a mission goes through the
Admin SDK, which bypasses rules entirely. The browser therefore needs almost no
access, and [firestore.rules](../../firestore.rules) is written to grant almost
none. Anything not matched is denied.

The browser has exactly **one** write in the entire system: stamping
`learnerEmailHash` onto a mission submitted before the learner supplied an
address. That single rule is pinned four ways:

```
allow update: if touchedKeys().hasOnly(['learnerEmailHash'])
              && !('learnerEmailHash' in resource.data)   // fill a blank, never overwrite
              && request.resource.data.learnerEmailHash is string
              && request.resource.data.learnerEmailHash.size() == 64
              && request.resource.data.learnerEmailHash.matches('^[0-9a-f]{64}$');
```

**Why the regex matters.** Without the shape check, that one permitted write is a
channel for smuggling a plaintext address onto a world-readable document. The
64-character hex constraint pins the field to a SHA-256 digest and closes it.

**Rejected.** Letting the client write mission status directly. It would have
removed a server hop, and it would have let any browser mark any mission
complete.

---

## 6. Mission locking with leases, and why the satellite is the lock owner

**Constraint.** Constraint 1. Two operators on two tablets tapping Send on the
same mission means the rover runs it twice, in front of a room of children.

**Decision.** A lease-based lock, taken inside a real transaction, in
`acquire_mission` in [yard/satellite/mission_store.py](../../yard/satellite/mission_store.py):

```python
conn.execute('BEGIN IMMEDIATE')     # write lock taken at statement one, not at commit
...
lease_live = bool(lease) and lease > now_iso
if holder and holder != owner and lease_live:
    return False, 'locked-by-other', None
```

**Three details worth defending.**

- **`BEGIN IMMEDIATE`, not `BEGIN`.** SQLite's default deferred transaction takes
  its write lock lazily, which leaves a read-then-write check-and-set open to a
  race under a threaded Flask server. `IMMEDIATE` takes the write lock up front,
  which is what makes the claim atomic.
- **A lease, not a lock.** A plain lock held by a process that loses power is held
  forever, and the mission is stuck. An expired lease on a `processing` mission is
  reclaimable, and reclaiming it is the entire point of having an expiry.
- **A missing lease is deliberately NOT reclaimable.** That is legacy data, not a
  dead holder, and guessing about legacy data would be guessing about a physical
  action.

**The subtle one, and the best story in this section.** The lock owner is the
**satellite**, not the operator, and there is a specific reason recorded in
[satellite_identity.py](../../yard/satellite/satellite_identity.py). The event-day
escape hatch `OPERATOR_AUTH=off` makes `current_operator()` return one shared stub
whose uid is the literal string `'offline'`. If the operator uid were the lock
principal, then in that mode every operator is the same principal, `holder !=
owner` never fires, both tablets acquire, and the rover runs the mission twice.
The lock would have been disabled in precisely the conditions that created the
need for it.

The lock is about which *machine* owns the rover, not which human is tapping. One
satellite owns one rover, so the satellite is the correct principal, and its
identity is a UUID persisted to disk so a restart reclaims its own leases instead
of looking like a different box.

**This is the strongest single answer to "what was technically difficult".** It is
a real distributed-systems bug, found by reasoning about an interaction between
two features, in the mode where it would have hurt most.

---

## 7. Offline-first: local SQLite, an outbox, and push before pull

**Constraint.** Constraint 2.

**Decision.** Every Flask request handler on the satellite reads and writes
**SQLite only**. A single background worker,
[sync_worker.py](../../yard/satellite/sync_worker.py), is the only component that
talks to Firestore. The console therefore has no network in its request path, so
losing the uplink degrades freshness instead of breaking the console.

**The ordering rule, which is the part to defend.** Flush the outbox **before**
pulling. Not a preference, a correctness requirement:

> A local write records a physical event. The rover actually moved across the
> yard. The Firestore copy is stale by definition, because it never heard about
> that run. Pulling first would overwrite ground truth with staleness and silently
> erase the fact that a mission ran.

**How it holds together.** A local change sets `local_dirty = 1` on the mirror row
and appends to `outbox`. The pull's `UPSERT` carries `WHERE local_dirty = 0`, so a
pull physically cannot clobber an unsynced local change. `local_dirty` is cleared
only once nothing is queued for that row.

**Conflict resolution without coordination.** Status is **monotonic**: it only
moves up the ladder `queued < processing < cancelled < failed < completed`, never
back down. So the merge rule is "higher rank wins, later timestamp breaks ties",
in `should_local_win`, and most reconnect conflicts resolve themselves with no
coordination at all. Every resolution is written to a `conflict_log` table and
surfaced in the console, so the automation is auditable rather than silent.

**Rejected.** Firestore's own offline persistence. It is a client SDK feature, it
does not span the satellite's Python process and its background threads, and it
gives no control over the push/pull ordering that correctness here depends on.

**Limitation, and volunteer it.** Multi-site is still open. Two satellites on
different networks both holding a stale view can still conflict in ways the rank
rule resolves plausibly rather than correctly.

---

## 8. Read-cost budget as an architectural constraint

**Constraint.** Constraint 4. This one is usually invisible in student projects
and it is worth showing precisely because it is.

**The arithmetic we started from.** The naive sync worker pulled 200 documents
every 30 seconds:

```
2,880 cycles/day x 200 docs = 576,000 reads/day
```

against a 50,000/day free-tier quota shared with every learner loading the public
feed. That is eleven times the entire daily budget, from one satellite, before a
single learner opens the site.

**Decision, three mechanisms, same freshness, roughly one hundredth the cost.**

1. **Incremental pull.** New missions only, via `submittedAt > cursor`. A quiet
   cycle reads nothing (an empty result bills as one read), so the floor is about
   2,880 reads a day.
2. **Active reconcile.** Missions can also change remotely, which an
   incremental-by-`submittedAt` query cannot see. So every Nth cycle re-reads
   **only** the missions that can still change: `queued` and `processing`.
   Terminal missions are never re-read, because they do not move.
3. **Cursor pagination, not offset**, in `IMissionRepository`. Firestore bills
   every document an offset skips over, so page 5 of an offset scheme costs five
   pages' worth of reads. The cursor carries both ordering fields
   (`submittedAt`, `id`) so ties cannot skip or repeat a row.

**And it is tunable at runtime** via `SYNC_INTERVAL` and `SYNC_RECONCILE_EVERY`,
because the right trade-off differs by day: during an event freshness matters and
there is an operator watching; on a quiet day the same settings burn quota for
nobody.

---

## 9. Human-in-the-loop as an invariant, not a policy

**Constraint.** Constraints 1 and 3. Three rules are enforced in code, not in a
runbook.

**Never move the robot without a human.** No component auto-dispatches. The
`mission_watcher` polls the rover and is deliberately one-directional: it only
ever *reads* `/queue/status`. It can complete a mission, never fail one, never
send one. The distinction it rests on is worth stating out loud: recording an
outcome the rover already reported moves nothing, whereas dispatching is a
physical action that cannot be replayed.

**"I could not tell" must never be read as "it finished".** Both
[recovery.py](../../yard/satellite/recovery.py) and the watcher return an empty
set on any failure: unreachable, malformed JSON, non-200, all of it. A silent
rover is not a completed mission. This is fail-safe defaulting applied to a case
where the unsafe default would mark a mission complete that never ran.

**Crash recovery refuses to guess.** If the satellite loses power mid-mission, the
mirror holds a `processing` row that this satellite owns, and that state is
genuinely ambiguous. Recovery resolves it only when the **rover itself** confirms
the outcome. Everything else is flagged `needs_review` for an operator. It
specifically does not re-dispatch, and it specifically does not mark the mission
failed, because "failed" asserts an outcome nobody established.

**And the learner never sees "Failed".**
[discoveryStatus.ts](../../mission-control/src/lib/discoveryStatus.ts) collapses
five internal statuses into two learner-facing ones, Completed or Pending. The
operator console shows the full accurate status. This is not the system lying; it
is two audiences with different needs, and the code names the reason: a learner
should not be made to feel bad by seeing their own work marked "Failed".

**Say this if asked why the automation is so timid.** In a normal web system the
safe default under uncertainty is to retry. Here the safe default under
uncertainty is to stop and ask a human, because the failure mode is a machine
moving in a room with children in it. The invariants are asymmetric on purpose.

---

## 10. Deployment: no long-lived credentials, and prod runs staging's bytes

**Decision.** Infrastructure is Terraform with remote state in GCS
([infra/](../../infra)). CI authenticates to GCP with **Workload Identity
Federation** over GitHub's OIDC token, so there is no downloaded JSON service
account key anywhere in the pipeline, which is the most common way a student
project leaks production access.

Staging builds an image, tags it with the git SHA, and deploys that exact digest.
Prod promotion is `workflow_dispatch`, gated by a GitHub Environment with required
reviewers, and it promotes **the digest currently serving on staging**. No
rebuild. Prod runs the same bytes that were smoke-checked, and rollback is the
same mechanism pointed at the previous digest.

`terraform-plan.yml` runs a plan on any PR touching `infra/`, so an infrastructure
change is reviewable as a diff rather than as a description of a diff.

**Limitation, state it before someone finds it.** Firebase itself (the Firestore
database, Auth, the web app) is provisioned through the console by the migration
workstream, not by Terraform. Infrastructure as code coverage is real but partial,
and the diagram marks this.

---

## 11. Anticipated challenges, with the short answer

| Challenge | Short answer |
|---|---|
| "Why SQLite instead of just using Firestore offline persistence?" | It is a client SDK feature that does not span a Python process and its threads, and it gives no control over push-before-pull ordering, which is where correctness lives here. |
| "Isn't a client-side allowlist security theatre?" | It is not the security layer; it is the feedback layer. Security is the server allowlist plus the bounded interpreter, and the file header says so rather than implying otherwise. |
| "Hashing an email is weak." | Correct against a targeted guess, which we state in the source. It defeats bulk harvesting, which was the actual exposure, and the address itself is not on a public document at all. |
| "Why not a message queue instead of Firestore-as-queue?" | One rover, tens of missions a day, and a hard requirement that the same store be readable by an unauthenticated public feed. A broker adds an operational component with no capability we need at this scale. |
| "Why is `OPERATOR_AUTH=off` allowed to exist?" | Because it is what got 45 missions run on an event day when the venue wifi could not sustain Firebase sign-in. It is scoped, documented, marked in the UI, and the locking model was deliberately designed to keep working with it on, which is the interesting part. |
| "The architecture is not uniformly layered." | Correct and intended. We inverted the dependencies where we had live change risk (persistence, email) and did not where we had none (public feed reads). |
| "How do you know the read-cost design works?" | The arithmetic is in the source comments with the before figure, the after figure, and three tuning presets. It is a measured constraint, not an intuition. |

---

## 12. One-paragraph version

The system is a cloud authoring app, an offline-capable field satellite, and a
physical rover, and every hard decision in it comes from one of four constraints:
physical actions cannot be replayed, the venue is often offline, the users are
children whose data is public by default, and the free-tier quotas are real. So
the rover backend is hexagonal with an injected driver, learner code runs under a
time-bounded interruptible interpreter behind three independent validation layers,
identifiers on world-readable documents are one-way hashes with two different and
explicitly stated threat models, the browser holds exactly one narrowly shaped
write permission, mission dispatch is guarded by an expiring lease owned by the
satellite rather than the operator (because the event-day auth bypass would
otherwise have collapsed every operator into one principal), the satellite is
offline-first with an outbox that always pushes before pulling so a witnessed
physical event can never be overwritten by a stale cloud read, the sync worker was
rebuilt around a read-cost budget after the naive version came to eleven times the
daily quota, no component ever moves the robot or asserts an unobserved outcome
without a human, and the whole thing deploys through keyless OIDC with prod
running the exact image digest staging smoke-tested.
