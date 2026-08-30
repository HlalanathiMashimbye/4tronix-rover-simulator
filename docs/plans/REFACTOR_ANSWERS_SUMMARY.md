# Mission-to-Runs Refactoring: Structured Answers

## Question 1: SQL Migration Script for `mission_store.py`

### New Table Schema

Add to `init_db()` in `mission_store.py`:

```python
CREATE TABLE IF NOT EXISTS run_mirror (
    mission_id        TEXT NOT NULL,
    yard_id           TEXT NOT NULL,
    status            TEXT NOT NULL,
    started_at        TEXT,
    completed_at      TEXT,
    youtube_url       TEXT,
    lock_owner        TEXT,
    locked_at         TEXT,
    lease_expires_at  TEXT,
    needs_review      INTEGER DEFAULT 0,
    review_reason     TEXT,
    status_updated_at TEXT,
    synced_at         TEXT,
    local_dirty       INTEGER DEFAULT 0,
    PRIMARY KEY (mission_id, yard_id)
);
```

### Migration Logic in `_migrate()`

```python
def _migrate(conn):
    """Existing migrations + run_mirror backfill."""
    
    # Step 1: Add any new columns to existing tables (current logic)
    for table, columns in _ADDED_COLUMNS.items():
        existing = {r['name'] for r in conn.execute(f'PRAGMA table_info({table})')}
        for name, coltype in columns.items():
            if name not in existing:
                conn.execute(f'ALTER TABLE {table} ADD COLUMN {name} {coltype}')
    
    # Step 2: Backfill run_mirror from mission_mirror (one-time at boot)
    existing_tables = {r['name'] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    
    if 'run_mirror' not in existing_tables:
        # Table will be created by CREATE TABLE IF NOT EXISTS above
        # This block only runs once, then skipped on future boots
        pass
    else:
        # Table exists but might be empty; check if backfill needed
        backfill_count = conn.execute(
            "SELECT COUNT(*) as cnt FROM run_mirror"
        ).fetchone()['cnt']
        
        if backfill_count == 0:
            # First time: create one implicit run per mission
            conn.execute("""
                INSERT INTO run_mirror
                (mission_id, yard_id, status, started_at, completed_at, youtube_url,
                 lock_owner, locked_at, lease_expires_at, needs_review, review_reason,
                 status_updated_at, synced_at, local_dirty)
                SELECT
                    id, yard_id, status, started_at, completed_at, youtube_url,
                    lock_owner, locked_at, lease_expires_at, needs_review, review_reason,
                    status_updated_at, synced_at, 0
                FROM mission_mirror
                WHERE yard_id IS NOT NULL
            """)
```

### Why This Approach

- **ONE-TIME COST:** Runs only once; subsequent boots skip the backfill
- **ZERO DATA LOSS:** Every mission's execution state copies to its implicit run
- **BACKWARD COMPATIBLE:** Old `mission_mirror` fields stay intact during Phase 1 & 2
- **IDEMPOTENT:** Can be run multiple times without duplication (backfill only if count == 0)

---

## Question 2: Legacy vs. New Operations Strategy

### Recommendation: BOTH + Routing

Provide **dual interface** for gradual migration:

#### Option A: Keep Both, Route Wisely (RECOMMENDED)

**Old functions** (backward compatible):
```python
def acquire_mission(mission_id, owner, now_iso, expires_iso, for_rerun=False):
    """DEPRECATED: Use acquire_run() instead.
    
    Routes to acquire_run() using this satellite's yard_id.
    Allows existing code (operator_console.py) to work unchanged during migration.
    """
    from satellite_identity import yard_id as _yard_id
    yard = _yard_id()
    if not yard:
        return False, 'yard-unknown', None
    return acquire_run(mission_id, yard, owner, now_iso, expires_iso, for_rerun)


def release_mission(mission_id, status, now_iso, review_reason=None, operator_decision=False):
    """DEPRECATED: Use release_run() instead.
    
    Routes to release_run() using this satellite's yard_id.
    """
    from satellite_identity import yard_id as _yard_id
    yard = _yard_id()
    if not yard:
        return False  # or raise
    return release_run(mission_id, yard, status, now_iso, review_reason, operator_decision)
```

**New functions** (run-scoped):
```python
def acquire_run(mission_id, yard_id, owner, now_iso, expires_iso, for_rerun=False):
    """Atomically claim a run (yard-scoped) for execution."""
    # ... (see Phase 2 above)

def release_run(mission_id, yard_id, status, now_iso, review_reason=None, operator_decision=False):
    """Release a run's lock and set status."""
    # ... (see Phase 2 above)
```

#### When to Update Callers

| File | When | Reason |
|------|------|--------|
| `operator_console.py` | Phase 4 | Direct call to `acquire_run()` eliminates routing overhead |
| Other satellites | Never | They call via the deprecated wrappers indefinitely |
| Tests | Phase 2 | New tests use `acquire_run()` directly |

#### Outbox Schema Update

Modify outbox table to support runs:

```python
# In init_db()
CREATE TABLE IF NOT EXISTS outbox (
    seq                INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid               TEXT UNIQUE NOT NULL,
    mission_id         TEXT NOT NULL,
    run_op_yard_id     TEXT,          -- NULL for legacy mission ops
    op                 TEXT NOT NULL, -- 'lock', 'release', 'youtube', etc.
    payload            TEXT NOT NULL,
    event_at           TEXT NOT NULL,
    attempts           INTEGER DEFAULT 0,
    last_error         TEXT,
    created_at         TEXT NOT NULL
);
```

When enqueueing run operations:
```python
def _enqueue_run(conn, mission_id, yard_id, op, payload):
    """Append a run operation to the outbox."""
    now = _now_iso()
    conn.execute(
        'INSERT INTO outbox (uuid, mission_id, run_op_yard_id, op, payload, event_at, created_at)'
        ' VALUES (?,?,?,?,?,?,?)',
        (str(uuid_mod.uuid4()), mission_id, yard_id, op, json.dumps(payload), now, now),
    )
```

### Pros of This Approach

| Aspect | Benefit |
|--------|---------|
| **Gradual** | Old code works; no forced rewrite |
| **Testable** | Test new functions independently before flipping |
| **Safe** | Easy rollback if issues arise during Phase 3 |
| **Auditable** | See which calls are legacy via routing wrapper |

### Cons

| Aspect | Mitigation |
|--------|------------|
| **Code Duplication** | Routing wrapper is 5 lines; acceptable |
| **Sync Worker Complexity** | Handle both `mission_id` and `(mission_id, yard_id)` ops in outbox; see Phase 3 |

---

## Question 3: Migration Backfill Strategy

### Chosen Approach: One Run Per Mission + Dual-Write

#### Initial State (After Migration)

```
MISSION_MIRROR                          RUN_MIRROR
┌──────────────────────────────┐       ┌─────────────────────────────────┐
│ id (PK)                      │       │ mission_id (PK part 1)          │
│ name                         │       │ yard_id (PK part 2)             │
│ yard_id                      │       │ status                          │
│ code                         │       │ started_at                      │
│ blockly_state                │       │ completed_at                    │
│ status ← KEEP FOR NOW        │ ───→ │ youtube_url                     │
│ started_at ← KEEP FOR NOW    │  1:1 │ lock_owner                      │
│ completed_at ← KEEP FOR NOW  │       │ locked_at                       │
│ youtube_url ← KEEP FOR NOW   │       │ lease_expires_at                │
│ lock_owner ← KEEP FOR NOW    │       │ needs_review                    │
│ locked_at ← KEEP FOR NOW     │       │ review_reason                   │
│ lease_expires_at ← KEEP      │       │ status_updated_at               │
│ needs_review ← KEEP FOR NOW  │       │ synced_at                       │
│ review_reason ← KEEP FOR NOW │       │ local_dirty                     │
│ status_updated_at ← KEEP NOW │       └─────────────────────────────────┘
│ deleted                      │
│ deleted_at                   │
└──────────────────────────────┘
```

#### Why This Strategy

| Phase | Why | What Happens |
|-------|-----|--------------|
| **1 (Now)** | Keep mission fields to avoid breaking existing readers | `acquire_mission()` reads from mission_mirror; new code reads from run_mirror |
| **2 (1-2 weeks)** | Gradually migrate readers to run_mirror | Flask routes updated to read `get_run()` instead of `get_mission()` |
| **3 (Cleanup)** | Remove execution fields from mission_mirror | Mission = pure metadata; no redundancy |

#### Dual-Write Implementation

**During Phase 1-2:** When a run is acquired/released, update BOTH tables:

```python
def acquire_run(mission_id, yard_id, owner, now_iso, expires_iso, for_rerun=False):
    """Atomically claim a run and queue the claim for Firestore."""
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            
            # Step 1: Read from run_mirror (primary)
            row = conn.execute(
                'SELECT * FROM run_mirror WHERE mission_id = ? AND yard_id = ?',
                (mission_id, yard_id),
            ).fetchone()
            
            if row is None:
                conn.rollback()
                return False, 'not-found', None
            
            run = dict(row)
            # ... validation logic ...
            
            # Step 2: Update run_mirror
            updates = {
                'status': 'processing',
                'started_at': now_iso,
                # ...
            }
            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE run_mirror SET {sets} WHERE mission_id = ? AND yard_id = ?',
                list(updates.values()) + [mission_id, yard_id],
            )
            
            # Step 3: ALSO update mission_mirror (for backward compat during Phase 1-2)
            # This keeps `get_mission()` returning execution state
            conn.execute(
                f'UPDATE mission_mirror SET {sets} WHERE id = ? AND yard_id = ?',
                list(updates.values()) + [mission_id, yard_id],
            )
            
            _enqueue_run(conn, mission_id, yard_id, 'lock', payload)
            conn.commit()
            return True, None, run
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
```

**Cleanup in Phase 3:** Remove the dual-write; reads come from run_mirror only.

#### Backfill Verification

```python
def verify_backfill(conn):
    """Ensure every mission has at least one run."""
    unmatched = conn.execute("""
        SELECT COUNT(*) as cnt FROM mission_mirror m
        WHERE NOT EXISTS (
            SELECT 1 FROM run_mirror r 
            WHERE r.mission_id = m.id AND r.yard_id = m.yard_id
        )
    """).fetchone()['cnt']
    
    if unmatched > 0:
        print(f"WARNING: {unmatched} missions have no corresponding runs!")
    return unmatched == 0
```

### Three Backfill Options Compared

| Option | Backfill | Readers | Writers | Pros | Cons |
|--------|----------|---------|---------|------|------|
| **Option 1: Dual-Write (CHOSEN)** | 1:1 at boot | Read from mission_mirror OR run_mirror | Write to both | No code changes needed initially | Redundancy for 1-2 weeks |
| **Option 2: Lazy-Create** | Create on first access | Must read run_mirror (fails if missing) | Write to run_mirror only | No redundancy | Must update all readers immediately |
| **Option 3: Background Job** | Async backfill over time | Read from mission_mirror, fall back to run_mirror | Write to run_mirror | Gradual, non-blocking | Complex; hard to verify completion |

**Chosen: Option 1** because:
- ✓ Safest (no reader failures)
- ✓ Fastest (one-time bulk copy at boot)
- ✓ Allows gradual reader migration
- ✓ Easy to verify (count match)

---

## Summary: Changes Needed

### `mission_store.py`

| Item | When | What |
|------|------|------|
| Add `run_mirror` table | Phase 1 | Schema in `init_db()` |
| Add `_migrate()` backfill | Phase 1 | One-time copy mission execution to runs |
| Add `upsert_runs()` | Phase 2 | Batch write runs from Firestore |
| Add `acquire_run()` | Phase 2 | Atomic run claim + outbox |
| Add `release_run()` | Phase 2 | Release lock + set status |
| Add `renew_run_lease()` | Phase 2 | Extend run lease |
| Add `get_run()` | Phase 2 | Fetch single run |
| Deprecate `acquire_mission()` | Phase 2 | Route to `acquire_run(satellite_yard, ...)` |
| Deprecate `release_mission()` | Phase 2 | Route to `release_run(satellite_yard, ...)` |
| Modify outbox schema | Phase 2 | Add `run_op_yard_id` column |
| Dual-write on updates | Phase 1-2 | Write to both mission_mirror AND run_mirror |
| Remove execution fields | Phase 3 | Delete status, started_at, etc. from mission_mirror |

### `sync_worker.py`

| Item | When | What |
|------|------|------|
| Add `sync_from_firestore_runs()` | Phase 3 | Pull runs collection instead of missions |
| Update `flush_one()` | Phase 3 | Handle `run_op_yard_id` to route to runs subcollection |
| Update `reconcile_active()` | Phase 3 | Reconcile active runs, not missions |

### `operator_console.py`

| Item | When | What |
|------|------|------|
| Update `api_send_to_rover()` | Phase 4 | Call `acquire_run(mission_id, yard_id, ...)` |
| Update `api_rerun()` | Phase 4 | Call `acquire_run(..., for_rerun=True)` |
| Update `_start_lease_renewal()` | Phase 4 | Keyed by `(mission_id, yard_id)` instead of `mission_id` |
| Update `_stop_lease_renewal()` | Phase 4 | Keyed by `(mission_id, yard_id)` |
| Update other endpoints | Phase 4 | Use `release_run()`, `get_run()`, etc. |

### TypeScript (Future PRs)

| Item | When | What |
|------|------|------|
| Remove execution fields from Mission | Phase 3+ | Delete status, startedAt, completedAt, lockOwner, etc. |
| Update FirestoreMissionRepository | Phase 3+ | Read/write runs, not mission execution state |
| Update sync to read runs | Phase 3+ | Pull from `runs` subcollection |

---

## Test Cases to Add

### `test_mission_store.py`

```python
def test_run_mirror_backfill():
    """Migration creates one run per mission with execution state."""
    # Setup: mission_mirror with 3 missions
    # Action: Boot satellite (triggers _migrate)
    # Assert: run_mirror has 3 rows; fields match mission_mirror

def test_acquire_run_queued():
    """acquire_run succeeds when run status is queued."""
    # Setup: run with status='queued'
    # Action: acquire_run(mission_id, yard_id, owner, ...)
    # Assert: Returns (True, None, run_dict); run.status='processing'

def test_acquire_run_not_queued_fails():
    """acquire_run fails when run is not queued or reclaimable."""
    # Setup: run with status='completed'
    # Action: acquire_run(mission_id, yard_id, owner, ...)
    # Assert: Returns (False, 'not-terminal', None)

def test_acquire_run_locked_by_other_fails():
    """acquire_run fails when run locked by different owner with live lease."""
    # Setup: run with lock_owner='other', lease_expires_at > now
    # Action: acquire_run(mission_id, yard_id, owner='me', ...)
    # Assert: Returns (False, 'locked-by-other', None)

def test_release_run_completes():
    """release_run sets status to completed and clears lock."""
    # Setup: run with status='processing', lock_owner='me'
    # Action: release_run(mission_id, yard_id, 'completed', ...)
    # Assert: run.status='completed', lock_owner=None

def test_renew_run_lease():
    """renew_run_lease extends lease_expires_at."""
    # Setup: run with lease_expires_at='2026-08-27T10:00:00Z'
    # Action: renew_run_lease(mission_id, yard_id, '2026-08-27T10:05:00Z', ...)
    # Assert: lease_expires_at updated; no outbox entry

def test_dual_write_on_acquire_run():
    """acquire_run updates both run_mirror and mission_mirror."""
    # Setup: run in run_mirror, mission in mission_mirror
    # Action: acquire_run(...)
    # Assert: Both tables show status='processing'

def test_acquire_mission_routes_to_acquire_run():
    """Deprecated acquire_mission() routes to acquire_run()."""
    # Setup: run + mission
    # Action: acquire_mission(mission_id, owner, ...) [old API]
    # Assert: Calls acquire_run(mission_id, satellite_yard, ...)
```

### `test_sync_worker.py`

```python
def test_sync_from_firestore_runs():
    """Pulls runs from Firestore, not missions."""
    # Setup: Mock Firestore with 1 mission + 1 run
    # Action: sync_from_firestore_runs(client, yard_id='test_yard')
    # Assert: run_mirror has 1 row; mission_mirror unchanged

def test_flush_run_operation():
    """flush_one writes run operation to missions/{id}/runs/{yard}."""
    # Setup: outbox with run_op_yard_id='yard1'
    # Action: flush_one(firestore_client, entry, 'missions')
    # Assert: Firestore doc at missions/{mission_id}/runs/yard1 updated

def test_flush_legacy_mission_operation():
    """flush_one still handles missions without run_op_yard_id."""
    # Setup: outbox with run_op_yard_id=None (legacy)
    # Action: flush_one(firestore_client, entry, 'missions')
    # Assert: Firestore doc at missions/{mission_id} updated
```

### `test_operator_console.py`

```python
def test_send_mission_acquires_run_not_mission():
    """POST /api/missions/{id}/send calls acquire_run()."""
    # Setup: Run in queued state; mock rover
    # Action: POST /api/missions/m1/send (logged in as satellite)
    # Assert: acquire_run(m1, satellite_yard, ...) called; rover dispatch succeeds

def test_send_mission_release_run_on_rover_fail():
    """POST /api/missions/{id}/send releases run if rover unreachable."""
    # Setup: Run in queued state; rover unreachable
    # Action: POST /api/missions/m1/send
    # Assert: release_run(m1, yard, 'queued', ...) called; returns 503

def test_lease_renewal_per_run():
    """Lease renewal timer keyed by (mission_id, yard_id)."""
    # Setup: Two missions m1, m2 both running in same yard
    # Action: _start_run_lease_renewal(m1, yard); _start_run_lease_renewal(m2, yard)
    # Assert: Two separate timers; _active_leases has keys (m1, yard) and (m2, yard)

def test_stop_lease_renewal_per_run():
    """_stop_run_lease_renewal cancels only the (mission_id, yard_id) timer."""
    # Setup: Two timers active for (m1, yard) and (m2, yard)
    # Action: _stop_run_lease_renewal(m1, yard)
    # Assert: (m1, yard) timer cancelled; (m2, yard) timer still active
```

---

## Rollback Plan

If critical issues discovered during Phase 3:

1. **Disable run syncing:** Comment out `sync_from_firestore_runs()` call in `sync_cycle()`
2. **Resume mission syncing:** Uncomment old `sync_from_firestore()` for missions collection
3. **Pause outbox flush:** Don't call `flush_one()` for entries with `run_op_yard_id`
4. **Clear run_mirror:** `DELETE FROM run_mirror` (data is redundant; mission_mirror has it)
5. **Revert operator_console:** Route back through deprecated `acquire_mission()`

**Data Integrity:** mission_mirror still holds all execution state; no loss.

---

## Success Metrics

By end of Phase 4:

- [ ] run_mirror table exists and is populated
- [ ] Zero data loss: `COUNT(runs) >= COUNT(missions)` with execution state
- [ ] All tests pass (unit + integration)
- [ ] Two yards can run same mission concurrently with independent outcomes
- [ ] Operator console still works (no visible change in UX)
- [ ] Lease renewal works per-run without issues
- [ ] Firestore read budget unchanged
- [ ] Rollback tested and documented

