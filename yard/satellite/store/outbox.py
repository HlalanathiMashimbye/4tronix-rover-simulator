"""
The outbox: local writes waiting to reach Firestore.

Every change the console makes is written to the mirror AND queued here in one
transaction, so a write survives the satellite being offline, restarted or
unplugged. sync_worker drains it, oldest first, and only deletes an entry once
Firestore has accepted it.

An entry that can never be delivered is parked rather than retried forever:
the drain loop takes the oldest entry and stops the whole cycle when it
fails, so without parking a single undeliverable write blocks every later
write AND the pull half of sync, indefinitely. See mark_attempt.

There are two near-identical sets of functions, one for missions and one for
runs. They are deliberately not unified yet: they touch different tables with
different key shapes, and merging them is a behaviour change rather than a
move. Worth doing, but not in the same pass as splitting this package apart.
"""

import json

import uuid as uuid_mod

from store.db import _connect, _db_lock, _now_iso

# How many times a flush may fail before the entry is parked. Attempts only
# accrue on the entry at the head of the queue, one per sync cycle, so at the
# default 30s interval this is roughly 25 minutes of continuous failure: long
# enough that an ordinary outage or a Firestore blip never parks a good write.
# Permanent failures do not wait for it, see mark_attempt.
MAX_FLUSH_ATTEMPTS = 50

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
    """The oldest deliverable unflushed entry, or None.

    Ordering is by `seq`, never by a timestamp: the Pi has no real-time clock,
    so an offline boot can produce wildly wrong wall-clock values (plan 7.2).

    Parked entries are skipped, not returned: they are kept for diagnosis but
    must not hold up the entries behind them.
    """
    with _db_lock:
        conn = _connect()
        row = conn.execute(
            'SELECT * FROM outbox WHERE parked = 0 ORDER BY seq ASC LIMIT 1'
        ).fetchone()
        conn.close()
    return dict(row) if row else None


def delete_outbox(seq):
    """Drop an entry once Firestore has confirmed the write."""
    with _db_lock:
        conn = _connect()
        conn.execute('DELETE FROM outbox WHERE seq = ?', (seq,))
        conn.commit()
        conn.close()


def mark_attempt(seq, error_msg, permanent=False):
    """Record a failed flush, parking the entry if it can never succeed.

    `permanent` is for a rejection that retrying cannot fix: the document was
    deleted in Mission Control, or this satellite is not allowed to write it.
    Those park immediately, because the alternative is retrying a 404 every
    30 seconds forever. Anything else parks only after MAX_FLUSH_ATTEMPTS, so
    a network outage is ridden out rather than treated as a dead letter.

    Parking never deletes: the row keeps its payload and last_error for an
    operator to look at, and unpark_outbox puts it back in the queue.
    """
    with _db_lock:
        conn = _connect()
        conn.execute(
            'UPDATE outbox'
            ' SET attempts = attempts + 1, last_error = ?,'
            '     parked = CASE WHEN ? OR attempts + 1 >= ? THEN 1 ELSE 0 END'
            ' WHERE seq = ?',
            (error_msg, 1 if permanent else 0, MAX_FLUSH_ATTEMPTS, seq),
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
    """The oldest deliverable unflushed run entry, or None. Parked entries skipped."""
    with _db_lock:
        conn = _connect()
        row = conn.execute(
            'SELECT * FROM run_outbox WHERE parked = 0 ORDER BY seq ASC LIMIT 1'
        ).fetchone()
        conn.close()
    return dict(row) if row else None


def delete_run_outbox(seq):
    """Drop an entry once Firestore has confirmed the write."""
    with _db_lock:
        conn = _connect()
        conn.execute('DELETE FROM run_outbox WHERE seq = ?', (seq,))
        conn.commit()
        conn.close()


def mark_run_attempt(seq, error_msg, permanent=False):
    """Record a failed run flush, parking the entry if it can never succeed.

    Same rules as mark_attempt, on the run queue.
    """
    with _db_lock:
        conn = _connect()
        conn.execute(
            'UPDATE run_outbox'
            ' SET attempts = attempts + 1, last_error = ?,'
            '     parked = CASE WHEN ? OR attempts + 1 >= ? THEN 1 ELSE 0 END'
            ' WHERE seq = ?',
            (error_msg, 1 if permanent else 0, MAX_FLUSH_ATTEMPTS, seq),
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


def parked_entries():
    """Every parked entry from both queues, newest failure first.

    Surfaced so a parked write is something an operator can see and act on
    rather than something that just silently never arrives.
    """
    with _db_lock:
        conn = _connect()
        rows = []
        for table, queue in (('outbox', 'mission'), ('run_outbox', 'run')):
            for row in conn.execute(
                f'SELECT * FROM {table} WHERE parked = 1 ORDER BY seq DESC'
            ):
                entry = dict(row)
                entry['queue'] = queue
                rows.append(entry)
        conn.close()
    return rows


def unpark_outbox():
    """Put every parked entry back in the queue with a clean attempt count.

    For after the cause is fixed: the mission was restored, or the credentials
    were. Returns how many entries were released.
    """
    with _db_lock:
        conn = _connect()
        n = 0
        for table in ('outbox', 'run_outbox'):
            cur = conn.execute(
                f'UPDATE {table} SET parked = 0, attempts = 0 WHERE parked = 1'
            )
            n += cur.rowcount
        conn.commit()
        conn.close()
    return n
