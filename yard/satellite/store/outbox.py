"""
The outbox: local writes waiting to reach Firestore.

Every change the console makes is written to the mirror AND queued here in one
transaction, so a write survives the satellite being offline, restarted or
unplugged. sync_worker drains it, oldest first, and only deletes an entry once
Firestore has accepted it.

There are two near-identical sets of functions, one for missions and one for
runs. They are deliberately not unified yet: they touch different tables with
different key shapes, and merging them is a behaviour change rather than a
move. Worth doing, but not in the same pass as splitting this package apart.
"""

import json

import uuid as uuid_mod

from store.db import _connect, _db_lock, _now_iso

def outbox_count():
    """Number of local writes not yet flushed to Firestore."""
    with _db_lock:
        conn = _connect()
        row = conn.execute("SELECT COUNT(*) AS n FROM outbox").fetchone()
        conn.close()
    return row['n']


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


def _enqueue(conn, mission_id, op, payload):
    """Append to the outbox on an already-open transaction."""
    now = _now_iso()
    conn.execute(
        'INSERT INTO outbox (uuid, mission_id, op, payload, event_at, created_at)'
        ' VALUES (?,?,?,?,?,?)',
        (str(uuid_mod.uuid4()), mission_id, op, json.dumps(payload), now, now),
    )


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


def _enqueue_run(conn, mission_id, yard_id, op, payload):
    """Append to the run outbox on an already-open transaction."""
    now = _now_iso()
    conn.execute(
        'INSERT INTO run_outbox (uuid, mission_id, yard_id, op, payload, event_at, created_at)'
        ' VALUES (?,?,?,?,?,?,?)',
        (str(uuid_mod.uuid4()), mission_id, yard_id, op, json.dumps(payload), now, now),
    )
