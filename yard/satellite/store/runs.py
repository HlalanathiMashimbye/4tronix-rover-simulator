"""
Run-level reads and writes: one yard's attempt at a mission.

A mission is a program; a run is an attempt at it, keyed by yard. Any yard may
run any mission, and each attempt keeps its own status, timestamps and video,
which is why a failed run at one yard is simply absent from what a learner
sees rather than shown as a failure.

_rollup_mission_status is the important one: a run and its parent mission
disagreeing about status is the bug this module exists to prevent, so the roll
up happens in the same transaction as the run write.
"""

import json

from store.db import _FORCE_KEY, _connect, _db_lock, _now_iso
from store.outbox import _enqueue, _enqueue_run

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


def set_run_recording_state(mission_id, yard_id, status, path=None, started_at=None, stopped_at=None):
    """Mirror-only write of the recording lifecycle (BACKLOG 335/336/338).

    Writes both runs_mirror (the source of truth) and mission_mirror's
    mirrored recording_status column, same reasoning as set_run_field's
    mirror_to_mission - the operator console's row-to-dict mapper only reads
    mission_mirror. Unlike set_run_field, never enqueues anything: whether a
    video file is being written on this SD card is a satellite-local fact,
    not something Firestore needs until BACKLOG 337 (upload) exists.
    """
    updates = {'recording_status': status}
    if path is not None:
        updates['recording_path'] = path
    if started_at is not None:
        updates['recording_started_at'] = started_at
    if stopped_at is not None:
        updates['recording_stopped_at'] = stopped_at

    with _db_lock:
        conn = _connect()
        try:
            conn.execute('BEGIN IMMEDIATE')
            sets = ', '.join(f'{k} = ?' for k in updates)
            conn.execute(
                f'UPDATE runs_mirror SET {sets} WHERE mission_id = ? AND yard_id = ?',
                list(updates.values()) + [mission_id, yard_id],
            )
            conn.execute(
                'UPDATE mission_mirror SET recording_status = ? WHERE id = ?',
                (status, mission_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
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
