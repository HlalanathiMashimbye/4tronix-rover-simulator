# User Story 361 - Separate Mission from Execution/Run

## Current State Analysis

### Architecture Issues
- **Mission entity** contains execution state: `status`, `startedAt`, `completedAt`, `youtubeUrl`, `lockOwner`, `leaseExpiresAt`, `needsReview`
- **Firestore**: `missions/{id}` stores full execution data
- **SQLite mirror**: `mission_mirror` table has execution columns
- **Locking model**: Global satellite lease on missions - prevents concurrency
- **Runs subcollection**: Exists at `missions/{id}/runs/{yardId}` but not used for execution state
- **MissionRun entity**: Exists but not authoritative - mission fields still used

### Problems
1. Only one `youtubeUrl` per mission → collision when two yards run the same mission
2. Global satellite lease → Mission A on Yard A blocks Mission A on Yard B
3. Execution state mixed with program state → Hard to reason about
4. Sync worker syncs missions with execution → Wrong collection

## Implementation Plan

### Phase 1: SQLite Migration (Local Mirror)

**Add `runs_mirror` table to track run execution state:**

```sql
CREATE TABLE IF NOT EXISTS runs_mirror (
    mission_id     TEXT NOT NULL,
    yard_id        TEXT NOT NULL,
    status         TEXT NOT NULL,
    started_at     TEXT,
    completed_at   TEXT,
    youtube_url    TEXT,
    needs_review   INTEGER DEFAULT 0,
    review_reason  TEXT,
    status_updated_at TEXT,
    lock_owner     TEXT,
    locked_at      TEXT,
    lease_expires_at TEXT,
    deleted        INTEGER DEFAULT 0,
    deleted_at     TEXT,
    synced_at      TEXT,
    local_dirty    INTEGER DEFAULT 0,
    PRIMARY KEY (mission_id, yard_id)
);

CREATE TABLE IF NOT EXISTS run_outbox (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid       TEXT UNIQUE NOT NULL,
    mission_id TEXT NOT NULL,
    yard_id    TEXT NOT NULL,
    op         TEXT NOT NULL,
    payload    TEXT NOT NULL,
    event_at   TEXT NOT NULL,
    attempts   INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL
);
```

**Remove execution columns from `mission_mirror`:**
- Remove: `status`, `started_at`, `completed_at`, `lock_owner`, `locked_at`, `lease_expires_at`, `needs_review`, `review_reason`, `status_updated_at`, `youtube_url`
- Keep: `id`, `name`, `yard_id`, `code`, `blockly_state`, `submitted_at`, `deleted`, `deleted_at`, `synced_at`, `local_dirty` (for outbox coordination)

### Phase 2: Mission Store Functions

**New run-specific operations in `mission_store.py`:**

```python
# Read operations
def get_run(mission_id, yard_id) -> dict | None
def get_runs(mission_id) -> list[dict]
def get_active_runs(yard_id) -> list[dict]  # status='processing'

# Write operations  
def acquire_run(mission_id, yard_id, owner, now_iso, expires_iso) -> tuple[bool, str, dict|None]
def release_run(mission_id, yard_id, status, now_iso, review_reason=None, operator_decision=False)
def renew_run_lease(mission_id, yard_id, expires_iso, now_iso)
def set_run_field(mission_id, yard_id, updates, payload)

# Backfill: create implicit run from existing mission execution state
def backfill_mission_to_run(mission_id) -> bool  # Returns True if created
```

**Concurrency key changes:**
- Old: Mission `lock_owner` prevents any yard from running it
- New: Run `lock_owner` at `(mission_id, yard_id)` - only this yard's run is locked
- Result: Mission A on Yard A can run while Mission A on Yard B can queue

### Phase 3: Sync Worker Refactor

**Current: Pulls missions with execution state**
```python
missions = col.where('yardId', '==', yard_id).stream()
```

**New: Pull missions (program only) AND runs (execution):**
```python
# Pull missions (program-only)
missions = col.where('yardId', '==', yard_id).stream()

# Pull runs for this yard
runs = col.collection_group('runs').where('yardId', '==', yard_id).stream()
```

**Changes to `sync_cycle()`:**
1. Flush run outbox BEFORE mission outbox (runs are the execution source of truth)
2. Pull missions incrementally by `submittedAt` (unchanged)
3. Pull runs for active missions by `statusUpdatedAt` cursor
4. No more `lease_expires_at` on missions

### Phase 4: Backfill Existing Missions

**Migration script in mission-control:**

```typescript
// backfill-missions-to-runs.mjs
// For each existing mission with status != 'queued':
//   - Create run at missions/{id}/runs/{yardId}
//   - Copy: status, startedAt, completedAt, youtubeUrl, needsReview, reviewReason
//   - Clear these fields from mission (set to null)
// Idempotent: skip if run already exists
// Dry-run by default, --apply to commit
```

### Phase 5: Operator Console Changes

**Current:**
```python
ok, reason, mission = acquire_mission(mission_id, owner, now, expires)
```

**New:**
```python
# Get mission (program only)
mission = get_mission(mission_id)  # No execution state

# Acquire run for this yard
yard_id = satellite_id().yard_id()
ok, reason, run = acquire_run(mission_id, yard_id, owner, now, expires)

# Dispatch uses mission.code + run status updates
_dispatch_to_rover(mission, run)
```

**Key changes:**
- `api_send_to_rover()`: acquire run, not mission
- `api_rerun()`: acquire run, not mission  
- `api_stop_mission()`: release run, not mission
- `api_complete_mission()`: release run, not mission
- Lease renewal on `(mission_id, yard_id)` tuple, not just `mission_id`

### Phase 6: Firestore Changes

**Mission document (cleaned):**
```typescript
{
  id: string
  name: string
  code: string
  blocklyState: string
  learnerRef: string
  sessionId: string
  learnerEmailHash: string
  submitted: string
  yardId: string
  deleted: boolean
  deletedAt: string
  // NO: status, startedAt, completedAt, youtubeUrl, lockOwner, etc.
}
```

**Run document (execution):**
```typescript
// At: missions/{missionId}/runs/{yardId}
{
  yardId: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt: string
  youtubeUrl: string
  needsReview: boolean
  reviewReason: string
  statusUpdatedAt: string
  lockOwner: string
  lockedAt: string
  leaseExpiresAt: string
}
```

**Firestore rules:** Already correct - `missions/{missionId}/runs/{yardId}` is readable and writable only by Admin SDK

## Testing Strategy

### Unit Tests

**mission_store.py:**
- `test_acquire_run_succeeds_if_no_other_run_processing_at_yard`
- `test_acquire_run_rejects_if_run_already_processing_at_yard`
- `test_mission_a_on_yard_a_and_yard_b_both_acquire`
- `test_release_run_updates_runs_mirror`
- `test_run_outbox_separate_from_mission_outbox`

**sync_worker.py:**
- `test_sync_pulls_missions_without_execution_state`
- `test_sync_pulls_runs_separately`
- `test_flush_run_outbox_before_mission_outbox`
- `test_reconcile_active_runs`

**FirestoreMissionRepository:**
- `test_upsert_mission_does_not_include_execution_fields`
- `test_upsert_run_is_idempotent`

### Integration Tests

1. **Backward compatibility:**
   - Existing mission without run: should backfill implicit run
   - Existing run: should read from run, not mission

2. **Concurrency:**
   - Mission A on Yard A queued for run
   - Mission A on Yard B also queued for run
   - Both acquire successfully
   - Both dispatch independently
   - Each has own status/video/timestamps
   - Neither blocks the other

3. **Lease:** 
   - Lease renewed per `(mission_id, yard_id)`, not globally
   - Expired lease on Yard A's run doesn't unblock Yard B's queue

4. **Video collision:**
   - Yard A records video for Mission X → `runs/{X}/runs/yard-a/youtubeUrl`
   - Yard B records video for Mission X → `runs/{X}/runs/yard-b/youtubeUrl`
   - No collision, distinct URLs

## Files to Change

1. **mission_store.py** - Add run table schema, run operations
2. **sync_worker.py** - Pull runs, flush run outbox first
3. **operator_console.py** - Use acquire_run instead of acquire_mission
4. **mission_watcher.py** - Release run instead of mission
5. **Mission.ts** - Remove execution fields
6. **MissionRun.ts** - Already exists, stays current
7. **firestore.rules** - Already correct
8. **FirestoreMissionRepository.ts** - Already has upsertRun, ensure missions don't write execution

## Rollout Strategy

1. **Phase 1-2:** Add run tables and functions to mission_store (no behavior change yet)
2. **Phase 3:** Backfill all existing missions to implicit runs
3. **Phase 4:** Update operator console to use runs
4. **Phase 5:** Update sync worker to pull/flush runs
5. **Phase 6:** Remove execution fields from missions (after backfill succeeds)

## Acceptance Criteria

✓ Existing mission → operator → rover flow still works  
✓ Mission A can run on Yard A and Yard B simultaneously  
✓ Yard A's status/video/review never overwrites Yard B's  
✓ Second active run of Mission A on Yard A is rejected  
✓ Mission A on Yard A does NOT block Mission A on Yard B  
✓ Existing missions work through migrated implicit runs  
✓ Recording uniquely associated with (mission, yard) run  
✓ Satellite lease removed (replaced with per-run concurrency)  
✓ All existing tests pass  
✓ New concurrency tests added and passing
