"""
The needs-review flow, and the conflict log.

A mission that was running when the satellite stopped cannot be assumed
finished or failed, so it is flagged for a human rather than guessed at. The
conflict log records merges where the losing side was already terminal, so the
team can see that reconciliation made a real decision rather than silently
picking one.
"""

import json

from store.db import _FORCE_KEY, _connect, _db_lock, _now_iso
from store.outbox import _enqueue, _enqueue_run

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

    'completed' means the operator confirmed the run finished; 'queued' puts
    it back in the queue to be run again; 'cancelled' means the operator
    decided the interrupted run should not count (BACKLOG 338). Either way
    the yard is free afterwards: a status outside 'processing' is all that
    means now (AB#364).

    Also updates the run row for this mission's yard, not just the mission
    rollup (BACKLOG 335/336/338 gap fix): before this, resolving a review
    left runs_mirror stuck at 'processing'/needs_review=1 forever, because
    nothing but release_run ever wrote to it, and this function never called
    that. Any run-level consumer - recording finalization included - needs
    the run's own state to actually change, not just the mission's.
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
                # Re-queued or cancelled: clear the previous run's stamps so a
                # requeued mission looks fresh, and a cancelled one carries no
                # stale timing into whatever rerun follows it.
                updates['started_at'] = None
                payload['startedAt'] = None

            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE mission_mirror SET {sets} WHERE id = ?',
                list(updates.values()) + [mission_id],
            )
            _enqueue(conn, mission_id, 'resolve', payload)

            yard_row = conn.execute(
                'SELECT yard_id FROM mission_mirror WHERE id = ?', (mission_id,)
            ).fetchone()
            if yard_row and yard_row['yard_id']:
                yard_id = yard_row['yard_id']
                run_sets = ', '.join(f'{k} = ?' for k in updates)
                conn.execute(
                    f'UPDATE runs_mirror SET {run_sets} WHERE mission_id = ? AND yard_id = ?',
                    list(updates.values()) + [mission_id, yard_id],
                )
                _enqueue_run(conn, mission_id, yard_id, 'resolve', payload)

            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
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
