"""
Run operations tests - per-yard execution state (User Story 361).

Tests the separation of missions (programs) from runs (execution attempts),
with concurrency scoped to (mission_id, yard_id) instead of globally.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import mission_store
import store.db as store_db  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(store_db, 'DB_PATH', str(tmp_path / 'missions.db'))
    mission_store.init_db()


def _mission(mission_id, **overrides):
    m = {
        'id': mission_id,
        'name': f'Mission {mission_id}',
        'yardId': 'curiosity',
        'code': 'rover.forward(10)',
        'blocklyState': '{"blocks":{}}',
        'status': 'queued',
        'submittedAt': '2026-07-14T08:00:00Z',
    }
    m.update(overrides)
    return m


# ---------------------------------------------------------------------------
# Run creation and querying
# ---------------------------------------------------------------------------

def test_create_first_run_for_mission():
    """First acquire_run creates the run from queued state."""
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')

    ok, reason, run = mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    assert ok is True
    assert reason is None
    assert run is not None
    assert run['mission_id'] == 'm1'
    assert run['yard_id'] == 'yard-a'
    assert run['status'] == 'processing'


def test_get_run():
    """Retrieve a run by (mission_id, yard_id)."""
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    run = mission_store.get_run('m1', 'yard-a')
    assert run is not None
    assert run['status'] == 'processing'

    # Different yard has no run yet
    run_b = mission_store.get_run('m1', 'yard-b')
    assert run_b is None


def test_get_runs_lists_all_for_mission():
    """get_runs returns all runs for a mission."""
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')
    mission_store.acquire_run('m1', 'yard-b', '2026-07-14T10:00:00Z')

    runs = mission_store.get_runs('m1')
    assert len(runs) == 2
    yards = {r['yard_id'] for r in runs}
    assert yards == {'yard-a', 'yard-b'}


# ---------------------------------------------------------------------------
# Concurrency: same mission, different yards
# ---------------------------------------------------------------------------

def test_mission_a_can_run_simultaneously_on_yard_a_and_yard_b():
    """Mission A queued for run at both yards; both should acquire without blocking."""
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')

    # Yard A acquires
    ok_a, _, run_a = mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    # Yard B should also acquire (concurrency scoped to yard, not global)
    ok_b, _, run_b = mission_store.acquire_run('m1', 'yard-b', '2026-07-14T10:00:00Z')

    assert ok_a is True
    assert ok_b is True
    assert run_a['yard_id'] == 'yard-a'
    assert run_b['yard_id'] == 'yard-b'


def test_second_acquire_at_same_yard_rejected():
    """Two Sends at one yard produce one run.

    This is the whole duplicate-Send guard now: one processing run per yard,
    with no owner and no expiry to reason about (AB#364).
    """
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')

    # First acquire succeeds
    ok1, _, _ = mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    # Second acquire at same yard is rejected
    ok2, reason2, _ = mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:01:00Z')

    assert ok1 is True
    assert ok2 is False
    assert reason2 == 'already-running'


def test_yard_a_does_not_block_yard_b_when_yard_a_runs():
    """A run at yard A does not stop yard B running anything."""
    mission_store.upsert_missions([_mission('m1'), _mission('m2')], '2026-07-14T09:00:00Z')

    # Yard A acquires M1
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    # Yard B should be able to acquire M1 (different yard, same mission)
    ok, reason, _ = mission_store.acquire_run('m1', 'yard-b', '2026-07-14T10:00:00Z')
    assert ok is True

    # Yard B should also be able to acquire M2
    ok, reason, _ = mission_store.acquire_run('m2', 'yard-b', '2026-07-14T10:00:00Z')
    assert ok is True


# ---------------------------------------------------------------------------
# Release and status transitions
# ---------------------------------------------------------------------------

def test_a_finished_run_can_be_started_again_as_a_rerun():
    """Finishing frees the yard, and rerun is how it starts again.

    A plain Send is deliberately refused on a finished run: restarting
    something that already completed is what the rerun button is for, and a
    Send that quietly re-drives a rover is a surprise.
    """
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')
    mission_store.release_run('m1', 'yard-a', 'completed', '2026-07-14T10:05:00Z')

    refused, reason, _ = mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:06:00Z')
    assert refused is False
    assert reason == 'not-queued'

    ok, _, _ = mission_store.acquire_run(
        'm1', 'yard-a', '2026-07-14T10:06:00Z', for_rerun=True,
    )
    assert ok is True


def test_release_run_sets_status_and_completed_at():
    """Releasing with 'completed' status sets both status and completedAt."""
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    mission_store.release_run('m1', 'yard-a', 'completed', '2026-07-14T10:05:00Z')

    run = mission_store.get_run('m1', 'yard-a')
    assert run['status'] == 'completed'
    assert run['completed_at'] == '2026-07-14T10:05:00Z'


def test_release_run_with_review_reason():
    """Releasing with review_reason flags the run for operator attention."""
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    mission_store.release_run(
        'm1', 'yard-a', 'processing', '2026-07-14T10:05:00Z',
        review_reason='rover lost signal'
    )

    run = mission_store.get_run('m1', 'yard-a')
    assert run['needs_review'] == 1
    assert run['review_reason'] == 'rover lost signal'


# ---------------------------------------------------------------------------
# Outbox and sync
# ---------------------------------------------------------------------------

def test_acquire_run_queues_outbox_entry():
    """acquire_run enqueues the start for Firestore."""
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    entry = mission_store.peek_run_outbox()
    assert entry is not None
    assert entry['mission_id'] == 'm1'
    assert entry['yard_id'] == 'yard-a'
    assert entry['op'] == 'start'


def test_release_run_queues_outbox_entry():
    """release_run enqueues a status change for Firestore."""
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')
    mission_store.delete_run_outbox(mission_store.peek_run_outbox()['seq'])  # Clear lock entry

    mission_store.release_run('m1', 'yard-a', 'completed', '2026-07-14T10:05:00Z')

    entry = mission_store.peek_run_outbox()
    assert entry is not None
    assert entry['mission_id'] == 'm1'
    assert entry['yard_id'] == 'yard-a'
    assert entry['op'] == 'release'


def test_run_has_pending():
    """run_has_pending detects unflushed outbox entries."""
    mission_store.upsert_missions([_mission('m1')], '2026-07-14T09:00:00Z')
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    assert mission_store.run_has_pending('m1', 'yard-a') is True
    assert mission_store.run_has_pending('m1', 'yard-b') is False


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------

def test_backfill_creates_implicit_runs_from_missions():
    """Backfill converts existing mission execution state to runs."""
    mission_store.upsert_missions([
        _mission('m1', yardId='yard-a', status='completed', completedAt='2026-07-14T10:00:00Z'),
        _mission('m2', yardId='yard-b', status='processing', startedAt='2026-07-14T09:00:00Z'),
    ], '2026-07-14T09:00:00Z')

    created, skipped, errors = mission_store.backfill_missions_to_runs()

    assert created == 2
    assert skipped == 0
    assert errors == []

    # Runs should exist now
    run1 = mission_store.get_run('m1', 'yard-a')
    assert run1 is not None
    assert run1['status'] == 'completed'
    assert run1['completed_at'] == '2026-07-14T10:00:00Z'

    run2 = mission_store.get_run('m2', 'yard-b')
    assert run2 is not None
    assert run2['status'] == 'processing'


def test_backfill_skips_existing_runs():
    """Backfill is idempotent - skips missions with existing runs."""
    mission_store.upsert_missions([_mission('m1', yardId='yard-a')], '2026-07-14T09:00:00Z')

    # Create a run manually
    mission_store.acquire_run('m1', 'yard-a', '2026-07-14T10:00:00Z')

    # Backfill should skip it
    created, skipped, errors = mission_store.backfill_missions_to_runs()

    assert created == 0
    assert skipped == 1


def test_backfill_skips_missions_without_yard():
    """Backfill ignores missions without a yardId."""
    # Create a mission without yardId
    conn = mission_store._connect()
    conn.execute("""
        INSERT INTO mission_mirror
            (id, name, code, blockly_state, status, submitted_at)
        VALUES (?,?,?,?,?,?)
    """, ('m1', 'No Yard Mission', 'code', '{}', 'queued', '2026-07-14T08:00:00Z'))
    conn.commit()
    conn.close()

    created, skipped, errors = mission_store.backfill_missions_to_runs()

    assert created == 0
    assert skipped == 0  # Not counted as skipped, just not processed

    run = mission_store.get_run('m1', '')  # Empty string (NULL in SQL)
    assert run is None
