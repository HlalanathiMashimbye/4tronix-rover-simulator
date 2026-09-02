"""
Mission-level reads and writes against the mirror.

A mission is the program a learner submitted. What happened when a yard tried
to run it lives in runs.py; this module is about the mission itself and the
console's view of the queue.

Writes go through the outbox rather than straight to Firestore, so the console
keeps working with no internet.
"""

import json

from store.db import DEFAULT_FINISHED_PAGE, _FORCE_KEY, _connect, _db_lock, _now_iso
from store.outbox import _enqueue, write_and_enqueue

def upsert_missions(missions, synced_at):
    """Write a batch of missions from Firestore into the mirror."""
    with _db_lock:
        conn = _connect()
        for m in missions:
            conn.execute("""
                INSERT INTO mission_mirror
                    (id, name, yard_id, code, blockly_state, status,
                     submitted_at, started_at, completed_at, youtube_url,
                     needs_review,
                     review_reason, status_updated_at, deleted, deleted_at,
                     synced_at, local_dirty)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,
                    yard_id=excluded.yard_id,
                    code=excluded.code,
                    blockly_state=excluded.blockly_state,
                    status=excluded.status,
                    submitted_at=excluded.submitted_at,
                    started_at=excluded.started_at,
                    completed_at=excluded.completed_at,
                    youtube_url=excluded.youtube_url,
                    needs_review=excluded.needs_review,
                    review_reason=excluded.review_reason,
                    status_updated_at=excluded.status_updated_at,
                    deleted=excluded.deleted,
                    deleted_at=excluded.deleted_at,
                    synced_at=excluded.synced_at
                WHERE local_dirty = 0
            """, (
                m['id'], m.get('name'), m.get('yardId'),
                m.get('code'), m.get('blocklyState'), m.get('status'),
                m.get('submittedAt'), m.get('startedAt'), m.get('completedAt'),
                m.get('youtubeUrl'),
                m.get('needsReview', 0), m.get('reviewReason'),
                m.get('statusUpdatedAt'),
                1 if m.get('deleted') else 0, m.get('deletedAt'),
                synced_at,
            ))
        conn.execute("INSERT OR REPLACE INTO sync_meta VALUES ('last_synced_at', ?)", (synced_at,))
        conn.commit()
        conn.close()


def get_missions(limit=DEFAULT_FINISHED_PAGE, yard_id=None):
    """Missions for the operator console, read from the local mirror.

    `limit` caps only the FINISHED missions - it is the page size, not a
    ceiling. Everything still actionable (queued, processing, needs-review) is
    always returned in full.

    A flat "newest N" cap drops the oldest rows first, and the oldest rows are
    exactly the ones with work outstanding: a completed mission whose video was
    never attached, or a mission queued days ago and never run. Those would
    vanish from the console with no way to reach them.

    Returns (missions, last_synced_at, finished_total) so the caller can offer
    "show more" rather than silently truncating.

    `yard_id` scopes the list to this satellite's own yard (plan 3.3).
    """
    yard_clause = ' AND yard_id = ?' if yard_id else ''
    yard_params = [yard_id] if yard_id else []

    with _db_lock:
        conn = _connect()

        active = conn.execute(
            "SELECT * FROM mission_mirror"
            " WHERE deleted = 0 AND status IN ('queued','processing')" + yard_clause +
            " ORDER BY submitted_at DESC",
            yard_params,
        ).fetchall()

        finished = conn.execute(
            "SELECT * FROM mission_mirror"
            " WHERE deleted = 0 AND status IN ('completed','failed')" + yard_clause +
            " ORDER BY submitted_at DESC LIMIT ?",
            yard_params + [limit],
        ).fetchall()

        finished_total = conn.execute(
            "SELECT COUNT(*) AS n FROM mission_mirror"
            " WHERE deleted = 0 AND status IN ('completed','failed')" + yard_clause,
            yard_params,
        ).fetchone()['n']

        # Cancelled missions used to be excluded here outright, which made
        # cancelling a one-way door: the console offered a "put back in queue"
        # action for them that could never render, because the rows never
        # reached the client. They are returned now and the queue keeps them
        # out of its default view, so an operator can still find one they
        # cancelled by mistake. Paged like the rest, and deliberately NOT part
        # of finished_total, which drives the Finished tile and its paging.
        cancelled = conn.execute(
            "SELECT * FROM mission_mirror"
            " WHERE deleted = 0 AND status = 'cancelled'" + yard_clause +
            " ORDER BY submitted_at DESC LIMIT ?",
            yard_params + [limit],
        ).fetchall()

        meta = conn.execute("SELECT value FROM sync_meta WHERE key = 'last_synced_at'").fetchone()
        conn.close()

    missions = [dict(r) for r in active] + [dict(r) for r in finished] + [dict(r) for r in cancelled]
    missions.sort(key=lambda m: m.get('submitted_at') or '', reverse=True)

    last_synced = meta[0] if meta else None
    return missions, last_synced, finished_total


def last_synced_at():
    """When the mirror last agreed with Firestore, without reading missions.

    get_missions() returns this alongside a page of rows, which is fine for the
    queue but wrong for a diagnostics panel: the Settings page only wants the
    timestamp, and going through the mission list to get it made a status card
    depend on an operator-only endpoint.
    """
    with _connect() as conn:
        row = conn.execute(
            "SELECT value FROM sync_meta WHERE key = 'last_synced_at'"
        ).fetchone()
    return row[0] if row else None


def status_counts(yard_id=None):
    """How many live missions sit in each status, for the queue's filters.

    Counted in SQL rather than from the returned page, because the page caps
    finished missions - counting those rows would have told an operator there
    were 39 completed missions when there were 74.
    """
    sql = "SELECT status, COUNT(*) AS n FROM mission_mirror WHERE deleted = 0"
    params = []
    if yard_id:
        sql += ' AND yard_id = ?'
        params.append(yard_id)
    sql += ' GROUP BY status'

    with _db_lock:
        conn = _connect()
        rows = conn.execute(sql, params).fetchall()
        conn.close()
    return {r['status']: r['n'] for r in rows}


def completed_without_video(yard_id=None):
    """Ids of completed missions that have no video attached yet.

    The YouTube poll used to get this list by streaming every completed mission
    out of Firestore, every five minutes, forever - a cost that grew by one
    read per child who finished a run, and on this yard was already ~21,000
    reads a day against a 50,000 free tier shared with the public site.

    The mirror holds `status` and `youtube_url` for the same documents and is
    kept current by the sync worker, so the candidate list costs nothing.
    """
    sql = ("SELECT id FROM mission_mirror"
           " WHERE deleted = 0 AND status = 'completed'"
           " AND (youtube_url IS NULL OR youtube_url = '')")
    params = []
    if yard_id:
        sql += ' AND yard_id = ?'
        params.append(yard_id)

    with _db_lock:
        conn = _connect()
        rows = conn.execute(sql, params).fetchall()
        conn.close()
    return [r['id'] for r in rows]


def get_mission(mission_id, include_deleted=False):
    """A single mission from the mirror, or None if it isn't there.

    Deleted missions are excluded by DEFAULT. Every action endpoint reaches a
    mission through here, so defaulting the other way meant a deleted mission
    stayed dispatchable to anyone who knew its id - it only disappeared from
    the lists. Callers that genuinely need to see a deleted row (the delete
    endpoint's double-delete guard) opt in explicitly.
    """
    sql = "SELECT * FROM mission_mirror WHERE id = ?"
    if not include_deleted:
        sql += " AND deleted = 0"
    with _db_lock:
        conn = _connect()
        row = conn.execute(sql, (mission_id,)).fetchone()
        conn.close()
    return dict(row) if row else None


def clear_dirty(mission_id):
    """Release a mirror row once nothing is queued for it, so Firestore pulls
    can refresh it again."""
    with _db_lock:
        conn = _connect()
        still_queued = conn.execute(
            'SELECT 1 FROM outbox WHERE mission_id = ? LIMIT 1', (mission_id,)
        ).fetchone()
        if not still_queued:
            conn.execute('UPDATE mission_mirror SET local_dirty = 0 WHERE id = ?', (mission_id,))
            conn.commit()
        conn.close()


def mission_has_pending(mission_id):
    """True if the outbox holds an unflushed entry for this mission."""
    with _db_lock:
        conn = _connect()
        row = conn.execute(
            'SELECT 1 FROM outbox WHERE mission_id = ? LIMIT 1', (mission_id,)
        ).fetchone()
        conn.close()
    return row is not None


def set_mirror_only(mission_id, updates):
    """Update the mirror WITHOUT queueing an outbox entry.

    For changes that were already written straight to Firestore (the YouTube
    poll), where enqueueing would push the same value back a second time.
    """
    with _db_lock:
        conn = _connect()
        sets = ', '.join(f'{k} = ?' for k in updates)
        conn.execute(
            f'UPDATE mission_mirror SET {sets} WHERE id = ?',
            list(updates.values()) + [mission_id],
        )
        conn.commit()
        conn.close()


def set_mission_field(mission_id, mirror_updates, payload):
    """Generic mirror write + outbox enqueue for non-status changes (YouTube)."""
    write_and_enqueue(mission_id, mirror_updates, 'youtube', payload)


def release_mission(mission_id, status, now_iso, review_reason=None, operator_decision=False):
    """Set a mission-level status, queueing it for Firestore.

    No longer drops a lock: there is none (AB#364). Kept because the mission
    row is still what Mission Control reads, and sync_worker's merge rules are
    exercised through it.

    Used for terminal transitions and for rolling back when a dispatch never
    reached the rover.

    `operator_decision` marks the change as a human's call so the sync merge
    lets it through even when it moves the mission backwards - stopping a rover
    is the case that matters (see sync_worker.should_local_win). Left False for
    changes that happen on their own, so the normal merge still protects
    against a stale local copy overwriting real progress.
    """
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            updates = {
                'status': status,
                'status_updated_at': now_iso,
                'local_dirty': 1,
            }
            payload = {
                'status': status,
                'statusUpdatedAt': now_iso,
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
                # A terminal mission is not ambiguous any more, so it must not
                # stay in the needs-review list. Until now resolve_review was
                # the ONLY thing that ever cleared this flag, so a mission that
                # was flagged, rerun and completed normally stayed flagged
                # forever - the count never went down and no action available
                # to the operator could bring it down.
                updates['needs_review'] = 0
                updates['review_reason'] = None
                payload['needsReview'] = False
                payload['reviewReason'] = None
            if operator_decision:
                payload[_FORCE_KEY] = True

            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE mission_mirror SET {sets} WHERE id = ?',
                list(updates.values()) + [mission_id],
            )
            _enqueue(conn, mission_id, 'release', payload)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def find_interrupted(yard_id):
    """Runs left 'processing' at this yard after a restart.

    These are genuinely ambiguous: the rover may have finished the run, or the
    power may have gone out mid-drive. Nothing here decides which - that is a
    human's call (plan 2.3, never move the robot without a human).

    Was "missions this satellite owns", matched on lock_owner. With the lease
    gone (AB#364) the set is identified by yard instead, which selects exactly
    the same rows: one satellite serves one yard, so a processing run here is
    by definition one this satellite was executing.

    Returns run rows carrying mission_id, which is what recovery.py needs.
    """
    with _db_lock:
        conn = _connect()
        rows = conn.execute(
            "SELECT * FROM runs_mirror WHERE status = 'processing' AND yard_id = ?"
            " AND needs_review = 0",
            (yard_id,),
        ).fetchall()
        conn.close()
    return [dict(r) for r in rows]


def newest_submitted_at(yard_id=None):
    """Highest submittedAt in the mirror - the incremental pull cursor.

    Scoped to a yard for the same reason the pull is: a mirror that already
    holds another yard's missions (every mirror written before the pull was
    filtered) would otherwise report that yard's newest timestamp as the
    cursor, and the incremental query would skip every one of this yard's
    missions submitted before it. The queue would look permanently empty and
    nothing would say why.
    """
    with _db_lock:
        conn = _connect()
        if yard_id:
            row = conn.execute(
                'SELECT MAX(submitted_at) AS m FROM mission_mirror WHERE yard_id = ?',
                (yard_id,),
            ).fetchone()
        else:
            row = conn.execute('SELECT MAX(submitted_at) AS m FROM mission_mirror').fetchone()
        conn.close()
    return row['m'] if row and row['m'] else None


def active_mission_ids(yard_id=None):
    """Ids the mirror still considers non-terminal.

    Reconciliation reads these specific documents. Querying Firestore for
    remotely-active missions instead would miss the transition that matters
    most - a mission that finished elsewhere no longer matches an "active"
    filter, so the mirror would never learn it was done.
    """
    with _db_lock:
        conn = _connect()
        sql = ("SELECT id FROM mission_mirror"
               " WHERE deleted = 0 AND status IN ('queued','processing')")
        params = []
        if yard_id:
            sql += ' AND yard_id = ?'
            params.append(yard_id)
        rows = conn.execute(sql, params).fetchall()
        conn.close()
    return [r['id'] for r in rows]


def forget_mission(mission_id):
    """Drop a mirror row for a mission that no longer exists in Firestore.

    Only ever called for a row with nothing queued for it - see the guard in
    the sync worker. Removing a row with pending writes would silently discard
    a local change that was never pushed.
    """
    with _db_lock:
        conn = _connect()
        pending = conn.execute(
            'SELECT 1 FROM outbox WHERE mission_id = ? LIMIT 1', (mission_id,)
        ).fetchone()
        if pending:
            conn.close()
            return False
        conn.execute('DELETE FROM mission_mirror WHERE id = ?', (mission_id,))
        conn.commit()
        conn.close()
        return True


def delete_mission(mission_id, now_iso):
    """Soft-delete: flag the mission and queue that for Firestore.

    Soft rather than hard on purpose. The operator is told this is permanent -
    and to them it is, there is no undo in the console - but the document
    survives, so a mis-tap on a child's completed mission with a video attached
    is recoverable by someone with database access. A hard delete would make
    a single wrong tap unrecoverable, which is a bad trade for a field that
    costs one integer.

    A deleted mission is left in no state that holds a yard: nothing is
    'processing', so nothing blocks the next Send (AB#364).
    """
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            updates = {
                'deleted': 1,
                'deleted_at': now_iso,
                'status_updated_at': now_iso,
                'local_dirty': 1,
            }
            payload = {
                'deleted': True,
                'deletedAt': now_iso,
                'statusUpdatedAt': now_iso,
            }
            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE mission_mirror SET {sets} WHERE id = ?',
                list(updates.values()) + [mission_id],
            )
            _enqueue(conn, mission_id, 'delete', payload)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def backfill_missions_to_runs():
    """Create one implicit run per mission with existing execution state.

    Idempotent: skips missions that already have a run, and skips missions
    without a yardId (no claiming yard means nobody established that a rover
    attempted it).

    Returns (created, skipped, errors) for logging and verification.
    """
    with _db_lock:
        conn = _connect()
        try:
            created = 0
            skipped = 0
            errors = []

            # Find missions with execution state and a yard
            missions = conn.execute("""
                SELECT id, yard_id, status, started_at, completed_at, youtube_url,
                       needs_review, review_reason, status_updated_at
                FROM mission_mirror
                WHERE yard_id IS NOT NULL AND yard_id != ''
            """).fetchall()

            for mission in missions:
                mission_id = mission['id']
                yard_id = mission['yard_id']

                try:
                    # Check if run already exists
                    existing = conn.execute(
                        'SELECT 1 FROM runs_mirror WHERE mission_id = ? AND yard_id = ?',
                        (mission_id, yard_id),
                    ).fetchone()

                    if existing:
                        skipped += 1
                        continue

                    # Create implicit run with mission's execution state
                    conn.execute("""
                        INSERT INTO runs_mirror
                            (mission_id, yard_id, status, started_at, completed_at,
                             youtube_url, needs_review, review_reason, status_updated_at,
                             synced_at, local_dirty)
                        VALUES (?,?,?,?,?,?,?,?,?,?,0)
                    """, (
                        mission_id, yard_id,
                        mission['status'], mission['started_at'], mission['completed_at'],
                        mission['youtube_url'],
                        mission['needs_review'], mission['review_reason'],
                        mission['status_updated_at'],
                        _now_iso(),
                    ))
                    created += 1
                except Exception as e:
                    # Recorded per mission so one bad row does not abandon the
                    # rest, but the caller must actually look: a silent 0 here
                    # is indistinguishable from "nothing needed doing".
                    errors.append((mission_id, str(e)))
                    print(f'[backfill] {mission_id}: {e}')

            conn.commit()
            return created, skipped, errors
        except Exception as e:
            conn.rollback()
            raise
        finally:
            conn.close()
