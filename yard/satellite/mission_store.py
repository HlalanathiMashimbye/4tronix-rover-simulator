import json
import os
import sqlite3
import threading
import uuid as uuid_mod
from datetime import datetime, timezone

# Anchored to this file's directory, not the working directory, matching
# satellite_identity.CONFIG_FILE and web_server.CONFIG_FILE. A bare relative
# 'missions.db' made the mirror's location depend on wherever the process
# happened to be started from: it works in production only because the systemd
# unit sets WorkingDirectory, and it silently created stray empty databases
# anywhere else (one got committed at the repo root). The failure mode if that
# WorkingDirectory line were ever dropped is the bad one - the satellite comes
# up pointing at a brand-new empty mirror and simply shows no missions, with
# nothing logged to say why.
DB_PATH = os.environ.get(
    'MISSION_MIRROR_DB',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'missions.db'),
)

# Finished missions are paged rather than capped. This is only a page size:
# the console asks for more as the operator scrolls, and it all comes from
# local SQLite, so a larger page costs DOM nodes and nothing else.
DEFAULT_FINISHED_PAGE = 40
_db_lock = threading.Lock()

# Kept in step with sync_worker.FORCE_KEY by hand rather than imported: the
# sync worker imports this module, so importing it back would be circular.
_FORCE_KEY = '__operatorDecision'


def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """Create the tables if they don't exist."""
    with _db_lock:
        conn = _connect()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS mission_mirror (
                id                TEXT PRIMARY KEY,
                name              TEXT,
                yard_id           TEXT,
                code              TEXT,
                blockly_state     TEXT,
                status            TEXT NOT NULL,
                submitted_at      TEXT,
                started_at        TEXT,
                completed_at      TEXT,
                youtube_url       TEXT,
                needs_review      INTEGER DEFAULT 0,
                review_reason     TEXT,
                status_updated_at TEXT,
                deleted           INTEGER DEFAULT 0,
                deleted_at        TEXT,
                synced_at         TEXT,
                local_dirty       INTEGER DEFAULT 0
            );

            -- Write queue: local changes not yet accepted by Firestore. Unused
            -- until PR 3 (outbox + push-before-pull sync), but the schema
            -- lands now so the mirror doesn't need a second migration.
            CREATE TABLE IF NOT EXISTS outbox (
                seq        INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid       TEXT UNIQUE NOT NULL,
                mission_id TEXT NOT NULL,
                op         TEXT NOT NULL,
                payload    TEXT NOT NULL,
                event_at   TEXT NOT NULL,
                attempts   INTEGER DEFAULT 0,
                last_error TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_meta (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS conflict_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                mission_id   TEXT NOT NULL,
                local_state  TEXT NOT NULL,
                remote_state TEXT NOT NULL,
                resolution   TEXT NOT NULL,
                logged_at    TEXT NOT NULL
            );

            -- Run mirror: execution state for each (mission, yard) pair.
            -- A mission is a program; a run is one yard's attempt to execute it.
            -- Keyed by (mission_id, yard_id) so multiple yards can attempt the same
            -- mission concurrently without contention or overwrites.
            CREATE TABLE IF NOT EXISTS runs_mirror (
                mission_id        TEXT NOT NULL,
                yard_id           TEXT NOT NULL,
                status            TEXT NOT NULL,
                started_at        TEXT,
                completed_at      TEXT,
                youtube_url       TEXT,
                needs_review      INTEGER DEFAULT 0,
                review_reason     TEXT,
                status_updated_at TEXT,
                deleted           INTEGER DEFAULT 0,
                deleted_at        TEXT,
                synced_at         TEXT,
                local_dirty       INTEGER DEFAULT 0,
                PRIMARY KEY (mission_id, yard_id)
            );

            -- Run outbox: execution state changes queued for Firestore.
            -- Separate from mission outbox so run updates flush independently.
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
        """)
        _migrate(conn)
        conn.commit()
        conn.close()


# Columns added after the first release, with the type to add them as. init_db
# runs this every boot so a satellite that already has a mirror on disk from an
# earlier version picks them up instead of failing on the first write.
_ADDED_COLUMNS = {
    'mission_mirror': {
        'deleted': 'INTEGER DEFAULT 0',
        'deleted_at': 'TEXT',
    },
}


def _migrate(conn):
    for table, columns in _ADDED_COLUMNS.items():
        existing = {r['name'] for r in conn.execute(f'PRAGMA table_info({table})')}
        for name, coltype in columns.items():
            if name not in existing:
                conn.execute(f'ALTER TABLE {table} ADD COLUMN {name} {coltype}')


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


def outbox_count():
    """Number of local writes not yet flushed to Firestore."""
    with _db_lock:
        conn = _connect()
        row = conn.execute("SELECT COUNT(*) AS n FROM outbox").fetchone()
        conn.close()
    return row['n']



# --- Write side: mirror + outbox (plan section 3.2 / PR 3) -----------------

def write_and_enqueue(mission_id, mirror_updates, op, payload):
    """Apply a local change to the mirror and queue it for Firestore, atomically.

    One SQLite transaction covers both, so the console can never show a state
    that has no matching outbox entry (which would silently never sync), nor
    queue a change it did not apply locally.

    `local_dirty` marks the row so the next Firestore pull cannot overwrite a
    change that has not been flushed yet - push-before-pull at the row level.
    """
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            updates = dict(mirror_updates)
            updates['local_dirty'] = 1
            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE mission_mirror SET {sets} WHERE id = ?',
                list(updates.values()) + [mission_id],
            )
            now = _now_iso()
            conn.execute(
                'INSERT INTO outbox (uuid, mission_id, op, payload, event_at, created_at)'
                ' VALUES (?,?,?,?,?,?)',
                (str(uuid_mod.uuid4()), mission_id, op, json.dumps(payload), now, now),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def peek_outbox():
    """The oldest unflushed entry, or None.

    Ordering is by `seq`, never by a timestamp: the Pi has no real-time clock,
    so an offline boot can produce wildly wrong wall-clock values (plan 7.2).
    """
    with _db_lock:
        conn = _connect()
        row = conn.execute('SELECT * FROM outbox ORDER BY seq ASC LIMIT 1').fetchone()
        conn.close()
    return dict(row) if row else None


def delete_outbox(seq):
    """Drop an entry once Firestore has confirmed the write."""
    with _db_lock:
        conn = _connect()
        conn.execute('DELETE FROM outbox WHERE seq = ?', (seq,))
        conn.commit()
        conn.close()


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


def mark_attempt(seq, error_msg):
    """Record a failed flush so a stuck entry is visible rather than silent."""
    with _db_lock:
        conn = _connect()
        conn.execute(
            'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE seq = ?',
            (error_msg, seq),
        )
        conn.commit()
        conn.close()


def log_conflict(mission_id, local_state, remote_state, resolution):
    """Record a merge where the losing side was already terminal (plan 6)."""
    with _db_lock:
        conn = _connect()
        conn.execute(
            'INSERT INTO conflict_log (mission_id, local_state, remote_state, resolution, logged_at)'
            ' VALUES (?,?,?,?,?)',
            (mission_id, local_state, remote_state, resolution, _now_iso()),
        )
        conn.commit()
        conn.close()


def get_conflicts(limit=50):
    with _db_lock:
        conn = _connect()
        rows = conn.execute(
            'SELECT * FROM conflict_log ORDER BY id DESC LIMIT ?', (limit,)
        ).fetchall()
        conn.close()
    return [dict(r) for r in rows]


# --- Mission-level writes, review flow, and sync metadata -------------------
#
# This header used to describe mission locking, which no longer exists: the
# lease went with AB#364, and per-yard runs removed what it arbitrated. What
# remains here writes mission-level state and drives the needs-review flow.
#
# The one piece of that reasoning still worth keeping: BEGIN IMMEDIATE takes a
# write lock before the read, so a second caller waits rather than acting on
# stale state. That is what makes a duplicate Send safe now that the guard is
# simply "is this run already processing" - see acquire_run.

def _enqueue(conn, mission_id, op, payload):
    """Append to the outbox on an already-open transaction."""
    now = _now_iso()
    conn.execute(
        'INSERT INTO outbox (uuid, mission_id, op, payload, event_at, created_at)'
        ' VALUES (?,?,?,?,?,?)',
        (str(uuid_mod.uuid4()), mission_id, op, json.dumps(payload), now, now),
    )


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


def flag_for_review(mission_id, reason):
    """Mark a mission as needing a human decision, and queue that for Firestore.

    Deliberately does NOT change status: moving it to 'failed' would assert an
    outcome nobody established, and 'failed' reaches the learner as a run that
    went wrong. It stays 'processing' with the flag on top.
    """
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            conn.execute(
                'UPDATE runs_mirror SET needs_review = 1, review_reason = ? WHERE mission_id ='
                ' ? AND yard_id = (SELECT yard_id FROM mission_mirror WHERE id = ?)',
                (reason, mission_id, mission_id),
            )
            conn.execute(
                'UPDATE mission_mirror SET needs_review = 1, review_reason = ?, local_dirty = 1'
                ' WHERE id = ?',
                (reason, mission_id),
            )
            _enqueue(conn, mission_id, 'review', {'needsReview': True, 'reviewReason': reason})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def get_needs_review():
    with _db_lock:
        conn = _connect()
        # Deleted missions are excluded: a soft-deleted mission still carrying
        # the flag would keep inflating the count with something the operator
        # cannot open or act on.
        rows = conn.execute(
            'SELECT * FROM mission_mirror WHERE needs_review = 1 AND deleted = 0'
            ' ORDER BY submitted_at DESC'
        ).fetchall()
        conn.close()
    return [dict(r) for r in rows]


def resolve_review(mission_id, status, now_iso):
    """Clear the review flag and set the status a human chose.

    'completed' means the operator confirmed the run finished; 'queued' puts it
    back in the queue to be run again. Either way the yard is free afterwards:
    a status outside 'processing' is all that means now (AB#364).
    """
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            updates = {
                'status': status,
                'status_updated_at': now_iso,
                'needs_review': 0,
                'review_reason': None,
                'local_dirty': 1,
            }
            payload = {
                'status': status,
                'statusUpdatedAt': now_iso,
                'needsReview': False,
                'reviewReason': None,
                # This IS the operator's decision about an ambiguous mission -
                # the whole point of the review flow. Re-queuing moves it back
                # from 'processing', which the merge ladder would drop.
                _FORCE_KEY: True,
            }
            if status == 'completed':
                updates['completed_at'] = now_iso
                payload['completedAt'] = now_iso
            else:
                # Re-queued: clear the previous run's stamps so it looks fresh.
                updates['started_at'] = None
                payload['startedAt'] = None

            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE mission_mirror SET {sets} WHERE id = ?',
                list(updates.values()) + [mission_id],
            )
            _enqueue(conn, mission_id, 'resolve', payload)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


# --- Sync cursors (read-cost control) --------------------------------------

def get_meta(key, default=None):
    with _db_lock:
        conn = _connect()
        row = conn.execute('SELECT value FROM sync_meta WHERE key = ?', (key,)).fetchone()
        conn.close()
    return row['value'] if row else default


def set_meta(key, value):
    with _db_lock:
        conn = _connect()
        conn.execute('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?,?)', (key, value))
        conn.commit()
        conn.close()


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


# --- Run operations (User Story 361: Mission = program, Run = execution) ----
#
# Runs separate execution state from missions, keyed by (mission_id, yard_id).
# Multiple yards can run the same mission concurrently without contention: each
# holds its own lock, has its own status, recording, and timestamps.

def get_run(mission_id, yard_id):
    """A single run from the mirror, or None if it isn't there."""
    with _db_lock:
        conn = _connect()
        row = conn.execute(
            'SELECT * FROM runs_mirror WHERE mission_id = ? AND yard_id = ?',
            (mission_id, yard_id),
        ).fetchone()
        conn.close()
    return dict(row) if row else None


def get_runs(mission_id):
    """All runs for a mission."""
    with _db_lock:
        conn = _connect()
        rows = conn.execute(
            'SELECT * FROM runs_mirror WHERE mission_id = ? ORDER BY yard_id',
            (mission_id,),
        ).fetchall()
        conn.close()
    return [dict(r) for r in rows]


def get_active_runs(yard_id=None):
    """Runs this yard still considers non-terminal.

    Used for reconciliation and for the yard selector in the console.
    """
    with _db_lock:
        conn = _connect()
        sql = "SELECT * FROM runs_mirror WHERE deleted = 0 AND status IN ('queued','processing')"
        params = []
        if yard_id:
            sql += ' AND yard_id = ?'
            params.append(yard_id)
        rows = conn.execute(sql + ' ORDER BY mission_id', params).fetchall()
        conn.close()
    return [dict(r) for r in rows]


def upsert_runs(runs, synced_at):
    """Write a batch of runs from Firestore into the runs mirror.

    Mirrors upsert_missions: pulls read runs where `runs_mirror.local_dirty = 0`.
    A pending outbox entry blocks the pull (push-before-pull at the row level).
    """
    with _db_lock:
        conn = _connect()
        for r in runs:
            conn.execute("""
                INSERT INTO runs_mirror
                    (mission_id, yard_id, status, started_at, completed_at,
                     youtube_url, needs_review, review_reason, status_updated_at,
                     deleted, deleted_at,
                     synced_at, local_dirty)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)
                ON CONFLICT(mission_id, yard_id) DO UPDATE SET
                    status=excluded.status,
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
                r.get('missionId') or r.get('mission_id'),
                r.get('yardId') or r.get('yard_id'),
                r.get('status'), r.get('startedAt'), r.get('completedAt'),
                r.get('youtubeUrl'), r.get('needsReview', 0), r.get('reviewReason'),
                r.get('statusUpdatedAt'),
                1 if r.get('deleted') else 0, r.get('deletedAt'),
                synced_at,
            ))
        conn.commit()
        conn.close()



def _rollup_mission_status(conn, mission_id, status, now_iso, extra_cols=None,
                           extra_payload=None, operator_decision=False):
    """Mirror a run's status onto the mission row, and queue it for Firestore.

    WHY THIS EXISTS, GIVEN STATUS NOW LIVES ON THE RUN.

    Mission Control still reads missions/{id}.status: getDiscoveryStatus turns
    it into the learner's Completed/Pending, the feed sorts on it, and the
    operator queue selects on it. If the satellite wrote only to the run, that
    field would freeze at 'queued' forever - every learner would see Pending
    for a mission that finished, and the operator queue would never clear.

    So the run is the truth and the mission carries a rollup of it. That keeps
    the change additive, which is what PR #91 was careful to be, until the
    cloud reads runs directly (AB#368).

    SAFE WITH SEVERAL YARDS. Each yard rolls up only its own run, so two yards
    can disagree. sync_worker's _RANK ladder settles it, and 'completed' (4)
    outranks 'failed' (3) and 'cancelled' (2): a mission that succeeded
    anywhere reads as completed, and one yard failing cannot take that away.
    That is the same rule the learner-facing view already relies on.
    """
    cols = {'status': status, 'status_updated_at': now_iso, 'local_dirty': 1}
    payload = {'status': status, 'statusUpdatedAt': now_iso}
    cols.update(extra_cols or {})
    payload.update(extra_payload or {})

    # Carry the operator's decision onto the mission entry as well. Without it
    # the run would be forced through the merge and the mission rollup would
    # not, so a rover an operator stopped would show as still running to every
    # learner watching. See sync_worker.should_local_win.
    if operator_decision:
        payload[_FORCE_KEY] = True

    sets = ', '.join(f'{k} = ?' for k in cols)
    conn.execute(
        f'UPDATE mission_mirror SET {sets} WHERE id = ?',
        list(cols.values()) + [mission_id],
    )
    _enqueue(conn, mission_id, 'status', payload)


def acquire_run(mission_id, yard_id, now_iso, for_rerun=False):
    """Atomically start a run at this yard, and queue that for Firestore.

    Returns (ok, reason, run_dict). Reasons: 'not-queued', 'already-running'.

    NO LEASE, NO OWNER, NO EXPIRY (AB#364). The lease was built when a mission
    had one global lock and two yards could genuinely contend for it. Runs are
    keyed by yard, so two yards now write different documents and there is
    nothing left to arbitrate between them.

    Within a yard there is exactly one satellite, so a second Send is two
    requests to one process rather than a distributed race: BEGIN IMMEDIATE
    plus "is this run already processing" is the whole guard. The rover
    serialises the rest physically, its queue being a FIFO with a single
    worker thread.

    What the expiry was really for was reclaiming a run whose satellite died
    mid-drive. recovery.py does that better on startup: it asks the ROVER
    whether the run finished rather than inferring from a clock, and flags the
    run for a human when it cannot tell. A timeout would have guessed.
    """
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')

            row = conn.execute(
                'SELECT * FROM runs_mirror WHERE mission_id = ? AND yard_id = ?',
                (mission_id, yard_id),
            ).fetchone()

            if row is None:
                # First attempt at this yard: create the run as queued, then
                # fall through and claim it below.
                run = {'mission_id': mission_id, 'yard_id': yard_id, 'status': 'queued'}
                conn.execute(
                    'INSERT INTO runs_mirror (mission_id, yard_id, status, local_dirty)'
                    ' VALUES (?,?,?,1)',
                    (mission_id, yard_id, 'queued'),
                )
            else:
                run = dict(row)

            status = run.get('status')

            # The entire duplicate-Send guard. Reading state we already hold,
            # rather than asking who owns a lease and whether it is still live.
            # Distinct from 'not-queued' because the two mean different things
            # to an operator: one is "someone already started this here", the
            # other is "this is not in a state you can start".
            # A run recovery flagged is stuck in 'processing' with nobody
            # driving it: the satellite died mid-drive and startup could not
            # establish what happened. Rerun is precisely how an operator
            # resolves that, so it is the one case where a processing run may
            # be restarted - and restarting it IS the operator's answer, so
            # the flag clears.
            rescuing = for_rerun and status == 'processing' and run.get('needs_review')

            if status == 'processing' and not rescuing:
                conn.rollback()
                return False, 'already-running', None

            # Send starts queued work only. Restarting something already
            # finished is what rerun is for, and it says so on the button - a
            # plain Send that quietly re-drives a completed mission is a
            # surprise nobody asked for.
            allowed = ('queued', 'completed', 'failed', 'cancelled') if for_rerun else ('queued',)
            if rescuing:
                # The flagged-run case above; 'processing' is exactly what it is.
                allowed = allowed + ('processing',)
            if status not in allowed:
                conn.rollback()
                return False, 'not-queued', None

            updates = {
                'status': 'processing',
                'started_at': now_iso,
                'status_updated_at': now_iso,
                'local_dirty': 1,
            }
            payload = {
                'status': 'processing',
                'startedAt': now_iso,
                'statusUpdatedAt': now_iso,
            }

            if rescuing:
                updates['needs_review'] = 0
                updates['review_reason'] = None
                payload['needsReview'] = False
                payload['reviewReason'] = None

            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE runs_mirror SET {sets} WHERE mission_id = ? AND yard_id = ?',
                list(updates.values()) + [mission_id, yard_id],
            )
            _enqueue_run(conn, mission_id, yard_id, 'start', payload)
            _rollup_mission_status(
                conn, mission_id, 'processing', now_iso,
                {'started_at': now_iso}, {'startedAt': now_iso},
            )
            conn.commit()

            run.update(updates)
            return True, None, run
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def release_run(mission_id, yard_id, status, now_iso, review_reason=None, operator_decision=False):
    """Set a run's status, and queue it for Firestore.

    There is no lock to drop any more (AB#364): finishing a run is just a
    status write. The mission row gets the same status rolled onto it so
    Mission Control keeps working - see _rollup_mission_status.
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
                # Clear review flag on terminal transitions
                updates['needs_review'] = 0
                updates['review_reason'] = None
                payload['needsReview'] = False
                payload['reviewReason'] = None

            if operator_decision:
                payload[_FORCE_KEY] = True

            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE runs_mirror SET {sets} WHERE mission_id = ? AND yard_id = ?',
                list(updates.values()) + [mission_id, yard_id],
            )
            _enqueue_run(conn, mission_id, yard_id, 'release', payload)
            _rollup_mission_status(
                conn, mission_id, status, now_iso,
                {'completed_at': now_iso} if status == 'completed' else None,
                {'completedAt': now_iso} if status == 'completed' else None,
                operator_decision=operator_decision,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def set_run_field(mission_id, yard_id, updates, payload, mirror_to_mission=None):
    """Generic run mirror write + run outbox enqueue (e.g., YouTube URL).

    `mirror_to_mission` names the columns that must ALSO land on the mission
    row. The video is the case that matters: the learner's mission page reads
    missions/{id}.youtubeUrl, so a URL written only to the run would attach a
    recording nobody can watch. Same reasoning as _rollup_mission_status, and
    the same temporary state of affairs - it goes when the cloud reads runs
    directly (AB#368).
    """
    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            updates_dict = dict(updates)
            updates_dict['local_dirty'] = 1
            sets = ', '.join(f'{k} = ?' for k in updates_dict)
            conn.execute(
                f'UPDATE runs_mirror SET {sets} WHERE mission_id = ? AND yard_id = ?',
                list(updates_dict.values()) + [mission_id, yard_id],
            )
            _enqueue_run(conn, mission_id, yard_id, 'youtube', payload)

            if mirror_to_mission:
                cols = {c: updates[c] for c in mirror_to_mission if c in updates}
                if cols:
                    cols['local_dirty'] = 1
                    m_sets = ', '.join(f'{k} = ?' for k in cols)
                    conn.execute(
                        f'UPDATE mission_mirror SET {m_sets} WHERE id = ?',
                        list(cols.values()) + [mission_id],
                    )
                    _enqueue(conn, mission_id, 'youtube',
                             {k: v for k, v in payload.items()})

            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def peek_run_outbox():
    """The oldest unflushed run entry, or None."""
    with _db_lock:
        conn = _connect()
        row = conn.execute('SELECT * FROM run_outbox ORDER BY seq ASC LIMIT 1').fetchone()
        conn.close()
    return dict(row) if row else None


def delete_run_outbox(seq):
    """Drop an entry once Firestore has confirmed the write."""
    with _db_lock:
        conn = _connect()
        conn.execute('DELETE FROM run_outbox WHERE seq = ?', (seq,))
        conn.commit()
        conn.close()


def mark_run_attempt(seq, error_msg):
    """Record a failed flush so a stuck entry is visible."""
    with _db_lock:
        conn = _connect()
        conn.execute(
            'UPDATE run_outbox SET attempts = attempts + 1, last_error = ? WHERE seq = ?',
            (error_msg, seq),
        )
        conn.commit()
        conn.close()


def clear_run_dirty(mission_id, yard_id):
    """Release a run row once nothing is queued for it."""
    with _db_lock:
        conn = _connect()
        still_queued = conn.execute(
            'SELECT 1 FROM run_outbox WHERE mission_id = ? AND yard_id = ? LIMIT 1',
            (mission_id, yard_id),
        ).fetchone()
        if not still_queued:
            conn.execute(
                'UPDATE runs_mirror SET local_dirty = 0 WHERE mission_id = ? AND yard_id = ?',
                (mission_id, yard_id),
            )
            conn.commit()
        conn.close()


def run_has_pending(mission_id, yard_id):
    """True if the run outbox holds an unflushed entry for this run."""
    with _db_lock:
        conn = _connect()
        row = conn.execute(
            'SELECT 1 FROM run_outbox WHERE mission_id = ? AND yard_id = ? LIMIT 1',
            (mission_id, yard_id),
        ).fetchone()
        conn.close()
    return row is not None


def _enqueue_run(conn, mission_id, yard_id, op, payload):
    """Append to the run outbox on an already-open transaction."""
    now = _now_iso()
    conn.execute(
        'INSERT INTO run_outbox (uuid, mission_id, yard_id, op, payload, event_at, created_at)'
        ' VALUES (?,?,?,?,?,?,?)',
        (str(uuid_mod.uuid4()), mission_id, yard_id, op, json.dumps(payload), now, now),
    )


# --- Backfill: migrate existing missions to implicit runs (User Story 361) ----

# --- Backfill: missions that predate the run model --------------------------

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
