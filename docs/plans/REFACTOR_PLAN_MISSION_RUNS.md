# Mission-to-Runs Refactoring Implementation Plan (User Story 361)

## Executive Summary

This plan details the migration from mission-level execution state to yard-scoped runs. The refactoring moves execution fields (status, timestamps, locking, video, review flags) from the Mission entity to per-yard MissionRun documents, enabling multiple yards to run the same mission concurrently with independent outcomes.

**Timeline:** 3-4 phases over 2 PRs  
**Risk Level:** Medium (data migration required, schema changes)  
**Backward Compatibility:** Maintained through dual-write/dual-read for 1-2 weeks

---

## Current State Analysis

### Mission Entity (TypeScript)
- **File:** `mission-control/src/core/domain/entities/Mission.ts`
- **Execution Fields:** status, startedAt, completedAt, youtubeUrl, lockOwner, lockedAt, leaseExpiresAt, needsReview, reviewReason, statusUpdatedAt
- **Problem:** Single status applies to all yards; two yards can't run independently

### MissionRun Entity (TypeScript)
- **File:** `mission-control/src/core/domain/entities/MissionRun.ts`
- **Status:** Already defined; includes per-yard status, timestamps, video, review flags
- **Storage:** `missions/{missionId}/runs/{yardId}` (Firestore security rules already allow this)

### SQLite Mirror (`mission_store.py`)
- **File:** `yard/satellite/mission_store.py`
- **Schema:** `mission_mirror` table has all execution fields (status, lock_owner, lease_expires_at, etc.)
- **Problem:** No runs table; offline console still uses global mission locking

### Sync Worker (`sync_worker.py`)
- **File:** `yard/satellite/sync_worker.py`
- **Current Behavior:** Pulls from `missions` collection; merges execution state into mission documents
- **Issue:** Will conflict with run-based syncing

### Operator Console (`operator_console.py`)
- **File:** `yard/satellite/operator_console.py`
- **Locking:** Uses `acquire_mission()/release_mission()` with global mission locks
- **Lease Renewal:** Active in-memory timer (`_active_leases`) renews mission leases every 60s
- **Dispatch:** Sends mission Python to rover; waits for completion on the mission row

---

## Target State

### Missions (TypeScript)
- **Only:** id, yardId (metadata only), name, code, blocklyState, learnerRef, learnerEmailHash, submittedAt, deleted, deletedAt
- **Remove:** All execution fields (moved to runs)

### Runs (TypeScript)
- **Keep existing:** yardId, status, startedAt, completedAt, youtubeUrl, needsReview, reviewReason, statusUpdatedAt
- **Scope:** (missionId, yardId) tuple = unique run

### Firestore
- **Missions:** Program metadata only
- **Runs:** `missions/{missionId}/runs/{yardId}` (already in rules)

### SQLite Mirror
- New `run_mirror` table keyed by (mission_id, yard_id)
- Keep `mission_mirror` for metadata (name, code, blocklyState)
- Execution state reads from runs, not missions

### Operator Console
- `acquire_run(mission_id, yard_id, ...)` instead of `acquire_mission(mission_id, ...)`
- Run-scoped locking instead of global mission locking
- Lease scoped to (mission_id, yard_id)

---

## Implementation Phases

### Phase 1: SQLite Schema Migration (This PR)

#### 1.1 Add New `run_mirror` Table

**File:** `yard/satellite/mission_store.py`

Add to `_ADDED_COLUMNS` in `_migrate()`:

```python
_ADDED_COLUMNS = {
    'mission_mirror': {
        'locked_at': 'TEXT',
        'deleted': 'INTEGER DEFAULT 0',
        'deleted_at': 'TEXT',
    },
    'run_mirror': {  # NEW
        'mission_id': 'TEXT NOT NULL',
        'yard_id': 'TEXT NOT NULL',
        'status': 'TEXT NOT NULL',
        'started_at': 'TEXT',
        'completed_at': 'TEXT',
        'youtube_url': 'TEXT',
        'needs_review': 'INTEGER DEFAULT 0',
        'review_reason': 'TEXT',
        'status_updated_at': 'TEXT',
        'locked_at': 'TEXT',
        'lease_expires_at': 'TEXT',
        'synced_at': 'TEXT',
        'local_dirty': 'INTEGER DEFAULT 0',
    },
}
```

Update `init_db()` to create `run_mirror` table:

```sql
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

**Migration Logic in `_migrate()`:**
```python
def _migrate(conn):
    # ... existing column additions ...
    
    # Check if run_mirror exists; if not, backfill from mission_mirror
    existing_tables = {r['name'] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    
    if 'run_mirror' not in existing_tables:
        # Create the table (via CREATE TABLE IF NOT EXISTS above)
        # Then backfill: create one implicit run per mission
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

#### 1.2 Clean Mission Mirror (Metadata Only)

**Later PR** (Phase 2): Remove execution fields from `mission_mirror`:
- Remove: status, started_at, completed_at, youtube_url, lock_owner, locked_at, lease_expires_at, needs_review, review_reason, status_updated_at
- Keep: id, name, yard_id, code, blockly_state, submitted_at, deleted, deleted_at, synced_at

**Why not Phase 1:** Dual-write allows existing code to keep working while new code reads from runs.

---

### Phase 2: Run-Focused Mission Store Functions (This PR or next)

**File:** `yard/satellite/mission_store.py`

#### 2.1 New Run Operations (Parallel to Existing Mission Operations)

```python
def upsert_runs(runs, synced_at):
    """Batch write runs from Firestore into run_mirror."""
    with _db_lock:
        conn = _connect()
        for run in runs:  # List of dicts with keys: mission_id, yard_id, status, etc.
            conn.execute("""
                INSERT INTO run_mirror
                    (mission_id, yard_id, status, started_at, completed_at, youtube_url,
                     lock_owner, locked_at, lease_expires_at, needs_review, review_reason,
                     status_updated_at, synced_at, local_dirty)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)
                ON CONFLICT(mission_id, yard_id) DO UPDATE SET
                    status=excluded.status,
                    started_at=excluded.started_at,
                    completed_at=excluded.completed_at,
                    youtube_url=excluded.youtube_url,
                    lock_owner=excluded.lock_owner,
                    locked_at=excluded.locked_at,
                    lease_expires_at=excluded.lease_expires_at,
                    needs_review=excluded.needs_review,
                    review_reason=excluded.review_reason,
                    status_updated_at=excluded.status_updated_at,
                    synced_at=excluded.synced_at
                WHERE local_dirty = 0
            """, (
                run['missionId'], run.get('yardId'), run.get('status'),
                run.get('startedAt'), run.get('completedAt'), run.get('youtubeUrl'),
                run.get('lockOwner'), run.get('lockedAt'), run.get('leaseExpiresAt'),
                run.get('needsReview', 0), run.get('reviewReason'),
                run.get('statusUpdatedAt'),
                synced_at,
            ))
        conn.commit()
        conn.close()


def acquire_run(mission_id, yard_id, owner, now_iso, expires_iso, for_rerun=False):
    """Atomically claim a run and queue the claim for Firestore.
    
    Returns (ok, reason, run_dict). Reasons:
    'not-found', 'not-queued' / 'not-terminal', 'locked-by-other'.
    """
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute(
                'SELECT * FROM run_mirror WHERE mission_id = ? AND yard_id = ?',
                (mission_id, yard_id),
            ).fetchone()

            if row is None:
                conn.rollback()
                return False, 'not-found', None

            run = dict(row)
            status = run.get('status')
            holder = run.get('lock_owner')
            lease = run.get('lease_expires_at')
            lease_live = bool(lease) and lease > now_iso

            if for_rerun:
                recoverable = status == 'processing' and run.get('needs_review')
                if status not in ('completed', 'failed', 'cancelled') and not recoverable:
                    conn.rollback()
                    return False, 'not-terminal', None
            else:
                reclaimable = status == 'processing' and bool(lease) and not lease_live
                if status != 'queued' and not reclaimable:
                    conn.rollback()
                    return False, 'not-queued', None

            if holder and holder != owner and lease_live:
                conn.rollback()
                return False, 'locked-by-other', None

            updates = {
                'status': 'processing',
                'started_at': now_iso,
                'status_updated_at': now_iso,
                'lock_owner': owner,
                'locked_at': now_iso,
                'lease_expires_at': expires_iso,
                'local_dirty': 1,
            }
            payload = {
                'status': 'processing',
                'startedAt': now_iso,
                'statusUpdatedAt': now_iso,
                'lockOwner': owner,
                'lockedAt': now_iso,
                'leaseExpiresAt': expires_iso,
            }
            if for_rerun:
                updates['completed_at'] = None
                updates['youtube_url'] = None
                payload['completedAt'] = None
                payload['youtubeUrl'] = None
                payload[_FORCE_KEY] = True
                updates['needs_review'] = 0
                updates['review_reason'] = None
                payload['needsReview'] = False
                payload['reviewReason'] = None

            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE run_mirror SET {sets} WHERE mission_id = ? AND yard_id = ?',
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


def release_run(mission_id, yard_id, status, now_iso, review_reason=None, operator_decision=False):
    """Drop the lock and set a status on a run, queueing both for Firestore."""
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            updates = {
                'status': status,
                'status_updated_at': now_iso,
                'lock_owner': None,
                'locked_at': None,
                'lease_expires_at': None,
                'local_dirty': 1,
            }
            payload = {
                'status': status,
                'statusUpdatedAt': now_iso,
                'lockOwner': None,
                'lockedAt': None,
                'leaseExpiresAt': None,
            }
            if status == 'completed':
                updates['completed_at'] = now_iso
                payload['completedAt'] = now_iso
            if review_reason is not None:
                updates['needs_review'] = 1
                updates['review_reason'] = review_reason
                payload['needsReview'] = True
                payload['reviewReason'] = review_reason
            elif status in ('completed', 'failed', 'cancelled'):
                updates['needs_review'] = 0
                updates['review_reason'] = None
                payload['needsReview'] = False
                payload['reviewReason'] = None
            if operator_decision:
                payload[_FORCE_KEY] = True

            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE run_mirror SET {sets} WHERE mission_id = ? AND yard_id = ?',
                list(updates.values()) + [mission_id, yard_id],
            )
            _enqueue_run(conn, mission_id, yard_id, 'release', payload)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def renew_run_lease(mission_id, yard_id, expires_iso, now_iso):
    """Extend a run's live lease. Mirror-only."""
    with _db_lock:
        conn = _connect()
        conn.execute(
            'UPDATE run_mirror SET lease_expires_at = ?, status_updated_at = ? WHERE mission_id = ? AND yard_id = ?',
            (expires_iso, now_iso, mission_id, yard_id),
        )
        conn.commit()
        conn.close()


def get_run(mission_id, yard_id):
    """A single run from the mirror, or None."""
    with _db_lock:
        conn = _connect()
        row = conn.execute(
            'SELECT * FROM run_mirror WHERE mission_id = ? AND yard_id = ?',
            (mission_id, yard_id),
        ).fetchone()
        conn.close()
    return dict(row) if row else None


def _enqueue_run(conn, mission_id, yard_id, op, payload):
    """Append a run operation to the outbox (modified for runs)."""
    now = _now_iso()
    conn.execute(
        'INSERT INTO outbox (uuid, mission_id, run_op_yard_id, op, payload, event_at, created_at)'
        ' VALUES (?,?,?,?,?,?,?)',
        (str(uuid_mod.uuid4()), mission_id, yard_id, op, json.dumps(payload), now, now),
    )
```

#### 2.2 Legacy Mission Operations (Wrapper for Backward Compatibility)

Keep existing `acquire_mission()`, `release_mission()` functions but mark as `@deprecated`:

```python
def acquire_mission(mission_id, owner, now_iso, expires_iso, for_rerun=False):
    """DEPRECATED: Use acquire_run() instead.
    
    Maintained for backward compatibility during migration.
    Routes to acquire_run using the satellite's own yard_id.
    """
    from satellite_identity import yard_id as _yard_id
    yard = _yard_id()
    if not yard:
        return False, 'yard-unknown', None
    return acquire_run(mission_id, yard, owner, now_iso, expires_iso, for_rerun)
```

---

### Phase 3: Sync Worker Update

**File:** `yard/satellite/sync_worker.py`

#### 3.1 Pull Runs Instead of Missions (with Execution State)

```python
def sync_from_firestore_runs(firestore_client, yard_id=None):
    """Pull runs (not missions) from Firestore.
    
    Missions are now metadata-only; all execution state lives in runs.
    """
    try:
        col = firestore_client.collection('missions')
        
        if not yard_id:
            return True
        
        # Query: all missions, then fetch this yard's run subcollection for each
        # OR: query the runs subcollection directly (if Firestore allows cross-document queries)
        
        # For now: stream all missions, fetch this yard's run from each
        runs = []
        for mission_doc in col.stream():
            mission_id = mission_doc.id
            try:
                run_snap = col.document(mission_id).collection('runs').document(yard_id).get()
                if run_snap.exists:
                    data = run_snap.to_dict() or {}
                    data['missionId'] = mission_id
                    data['yardId'] = yard_id
                    runs.append(data)
            except Exception:
                continue
        
        if runs:
            upsert_runs(runs, _now_iso())
        else:
            set_meta('last_synced_at', _now_iso())
        
        return True
    except Exception as e:
        print(f'[sync] Failed to pull runs from Firestore: {e}')
        return False
```

#### 3.2 Flush Runs Instead of Missions

Modify `flush_one()` to handle both old missions (for now) and new runs:

```python
def flush_one(firestore_client, entry, collection_name='missions'):
    """Apply one outbox entry to Firestore.
    
    Now handles both run operations and legacy mission operations.
    """
    from firebase_admin import firestore

    mission_id = entry['mission_id']
    yard_id = entry.get('run_op_yard_id')  # None for legacy mission ops
    
    if yard_id:
        # Run operation: write to missions/{missionId}/runs/{yardId}
        ref = firestore_client.collection(collection_name).document(mission_id).collection('runs').document(yard_id)
    else:
        # Legacy mission operation
        ref = firestore_client.collection(collection_name).document(mission_id)
    
    outcome = {}

    try:
        @firestore.transactional
        def _apply(transaction):
            snap = ref.get(transaction=transaction)
            remote = (snap.to_dict() or {}) if getattr(snap, 'exists', False) else {}
            local_payload = json.loads(entry['payload'])

            won = should_local_win(local_payload, remote)
            outcome['local_payload'] = local_payload
            outcome['remote'] = remote
            outcome['won'] = won

            if won:
                transaction.update(ref, {k: v for k, v in local_payload.items() if k != FORCE_KEY})

        _apply(firestore_client.transaction())

        if outcome:
            _maybe_log_conflict(
                mission_id, outcome['local_payload'],
                outcome['remote'], outcome['won'],
            )

        delete_outbox(entry['seq'])
        clear_dirty(mission_id)
        return True

    except Exception as e:
        mark_attempt(entry['seq'], str(e))
        return False
```

---

### Phase 4: Operator Console Update

**File:** `yard/satellite/operator_console.py`

#### 4.1 Rename Acquisition Functions

```python
@operator_bp.route('/api/missions/<mission_id>/send', methods=['POST'])
@require_operator
def api_send_to_rover(mission_id):
    """Claim the run locally, then push its Python onto the rover queue."""
    from mission_store import acquire_run, get_mission
    from satellite_identity import satellite_id, yard_id

    owner = satellite_id()
    yard = yard_id()
    now = _now_iso()
    expires = _expires_iso()

    with _acquire_lock:
        ok, reason, run = acquire_run(mission_id, yard, owner, now, expires)

    if not ok:
        messages = {
            'not-found': ('Run not found', 404),
            'not-queued': ('Only queued runs can be sent to the rover', 400),
            'locked-by-other': ('Run is locked by another operator', 409),
        }
        msg, code = messages.get(reason, ('Lock failed', 500))
        return jsonify({'error': msg}), code

    # Get mission metadata (code, etc.) separately
    mission = get_mission(mission_id)
    if not mission:
        release_run(mission_id, yard, 'queued', _now_iso())
        return jsonify({'error': 'Mission not found'}), 404

    ok, err = _dispatch_to_rover(_mirror_row_to_dict(mission), mission_id=mission_id)
    if not ok:
        release_run(mission_id, yard, 'queued', _now_iso())
        return err

    _start_run_lease_renewal(mission_id, yard)
    _notify_mission_control_async(mission_id, 'processing')
    return jsonify({'status': 'ok', 'missionId': mission_id})
```

#### 4.2 Update Lease Renewal

```python
_active_leases = {}  # Now: {(mission_id, yard_id): Timer}

def _start_run_lease_renewal(mission_id, yard_id):
    """Keep the run's lease alive locally while a mission runs."""
    def _renew():
        try:
            from mission_store import renew_run_lease
            renew_run_lease(mission_id, yard_id, _expires_iso(), _now_iso())
        except Exception as e:
            print(f'[lease] Failed to renew lease for {mission_id}/{yard_id}: {e}')

        timer = threading.Timer(LEASE_RENEW_INTERVAL, _renew)
        timer.daemon = True
        _active_leases[(mission_id, yard_id)] = timer
        timer.start()

    timer = threading.Timer(LEASE_RENEW_INTERVAL, _renew)
    timer.daemon = True
    _active_leases[(mission_id, yard_id)] = timer
    timer.start()


def _stop_run_lease_renewal(mission_id, yard_id):
    """Cancel the renewal timer for a run."""
    timer = _active_leases.pop((mission_id, yard_id), None)
    if timer:
        timer.cancel()
```

---

## Outbox Schema Update

**File:** `yard/satellite/mission_store.py`

Modify outbox table to support runs:

```sql
CREATE TABLE IF NOT EXISTS outbox (
    seq                INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid               TEXT UNIQUE NOT NULL,
    mission_id         TEXT NOT NULL,
    run_op_yard_id     TEXT,  -- NULL for mission ops, yard_id for run ops
    op                 TEXT NOT NULL,
    payload            TEXT NOT NULL,
    event_at           TEXT NOT NULL,
    attempts           INTEGER DEFAULT 0,
    last_error         TEXT,
    created_at         TEXT NOT NULL
);
```

---

## Testing Strategy

### Unit Tests

1. **test_mission_store.py**
   - `test_acquire_run_queued` - claim a run in queued state
   - `test_acquire_run_not_queued` - reject non-queued
   - `test_acquire_run_locked_by_other` - reject if locked by different owner
   - `test_release_run_to_processing` - mark run as processing
   - `test_renew_run_lease` - extend lease timer
   - `test_run_backfill` - migration creates implicit runs

2. **test_sync_worker.py**
   - `test_sync_runs_from_firestore` - pull runs collection
   - `test_flush_run_operation` - write run to Firestore
   - `test_merge_run_local_wins` - local run wins merge

3. **test_operator_console.py**
   - `test_send_mission_acquires_run` - send route uses run acquisition
   - `test_rerun_clears_run_video` - rerun clears prior run's youtube_url
   - `test_lease_renewal_per_run` - timer is per (mission_id, yard_id)

### Integration Tests

1. **Offline Dispatch**
   - Submit mission → no internet → operator sends → run acquired locally → synced on reconnect

2. **Multi-Yard Concurrency**
   - Mission submitted → Two yards both send → Two runs created independently

3. **Migration**
   - Boot satellite with old missions.db → runs backfilled → old acquire_mission() still works

---

## Risk Mitigation

### Data Loss
- **Mitigation:** Backfill creates one implicit run per mission (dual-write allows reads from either)
- **Verification:** Test count(runs) == count(missions) after migration

### Concurrent Writes
- **Mitigation:** PRIMARY KEY (mission_id, yard_id) on run_mirror prevents duplicates
- **Verification:** Concurrent acquire_run() calls on same (mission_id, yard_id) serialize

### Firestore Quota
- **Mitigation:** Runs are a new subcollection; pulls now read runs (same cost as before)
- **Verification:** Estimate read cost unchanged

### Operator Experience
- **Mitigation:** Lease renewal continues per-run; no visible change in console UX
- **Verification:** E2E test full dispatch cycle

---

## Rollback Plan

If issues arise:

1. **Pre-Migration:** Keep `acquire_mission()` intact; routes to `acquire_run(satellite_yard, ...)`
2. **Revert:** Disable run syncing; resume mission syncing; clear run_mirror table
3. **Data Integrity:** `mission_mirror` still holds execution state; no data loss if rolls back mid-Phase 3

---

## Files to Modify

| File | Changes | Phase |
|------|---------|-------|
| `yard/satellite/mission_store.py` | Add run_mirror table, upsert_runs(), acquire_run(), release_run() | 1-2 |
| `yard/satellite/sync_worker.py` | Pull runs instead of missions; flush run ops | 3 |
| `yard/satellite/operator_console.py` | Use acquire_run(); run-scoped leases | 4 |
| `mission-control/.../Mission.ts` | Remove execution fields | Future PR |
| `mission-control/.../FirestoreMissionRepository.ts` | Update sync to reads/writes runs | Future PR |
| Tests: `test_mission_store.py`, `test_sync_worker.py`, `test_operator_console.py` | Add run-focused tests | Each phase |

---

## Success Criteria

1. [✓] Run mirror table created and backfilled
2. [✓] `acquire_run()` and `release_run()` functions work
3. [✓] Operator console sends missions via run acquisition
4. [✓] Lease renewal works per-run
5. [✓] Sync worker pulls/pushes runs
6. [✓] Multi-yard concurrent runs work independently
7. [✓] Migration preserves existing missions as implicit runs
8. [✓] Tests cover happy path + error cases

---

## Questions Answered

### Q1: SQL Migration Script
**A:** `_migrate()` adds `run_mirror` table schema and backfills from `mission_mirror` (1:1 ratio initially).

### Q2: Legacy vs. New Operations
**A:** Provide BOTH during migration:
- `acquire_mission()` → routes to `acquire_run(satellite_yard, ...)`
- `release_mission()` → routes to `release_run(satellite_yard, ...)`
- Direct new code to run functions; old code works via routing

### Q3: Migration Backfill Strategy
**A:** Create one implicit run per mission with all execution data at boot.
- Preserves state; no visible change
- Enables gradual reader migration
- Keeps old mission fields until Phase 2 (field cleanup)

