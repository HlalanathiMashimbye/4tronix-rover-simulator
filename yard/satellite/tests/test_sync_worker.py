"""
Sync worker tests - the offline reconciliation contract.

Plan reference: yard/docs/offline-sync-plan.md section 8. The plan calls
push-before-pull "the single most important behavioural test in the story",
because getting it backwards silently erases the fact that a mission ran.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import mission_store
import store.db as store_db  # noqa: E402
import sync_worker  # noqa: E402


# --- Fakes -----------------------------------------------------------------
#
# The Firestore doubles live in tests/firestore_fakes.py, shared with
# test_operator_console.py. Both files used to carry their own copy of the
# same classes under slightly different names, drifting apart wherever one
# file's tests needed something the other's did not. See that module and
# ports.py for why.

from tests.firestore_fakes import (  # noqa: E402
    FakeFirestore,
    FakeSnapshot,
    FakeTransaction,
)

# This suite called the snapshot double FakeSnap; the shared name is
# FakeSnapshot. Aliased rather than renamed at every call site to keep this
# change a move rather than a rewrite.
FakeSnap = FakeSnapshot


@pytest.fixture(autouse=True)
def _mirror(tmp_path, monkeypatch):
    monkeypatch.setattr(store_db, 'DB_PATH', str(tmp_path / 'm.db'))
    mission_store.init_db()
    # firebase_admin's real decorator expects a real transaction; the fake
    # applies writes directly, so pass the function through.
    import firebase_admin.firestore as fs
    monkeypatch.setattr(fs, 'transactional', lambda fn: fn)


def _seed_local(mission_id='m1', status='queued'):
    mission_store.upsert_missions(
        [{'id': mission_id, 'yardId': 'curiosity', 'status': status,
          'submittedAt': '2026-07-14T08:00:00Z'}],
        '2026-07-14T09:00:00Z',
    )


# --- Push before pull ------------------------------------------------------

def test_no_pull_happens_while_the_outbox_is_non_empty():
    """The single most important behavioural guarantee. Pulling first would
    overwrite the record of a mission that physically ran."""
    _seed_local()
    remote = {}  # empty: the document does not exist remotely
    db = FakeFirestore(remote)

    # Queue a local change, then make the flush fail.
    mission_store.release_mission('m1', 'completed', '2026-07-14T10:00:00Z')

    def boom(*a, **k):
        raise RuntimeError('network down')
    db.transaction = boom

    ok = sync_worker.sync_cycle(db)

    assert ok is False
    assert db.pulls == 0, 'pulled while a local write was still pending'
    assert mission_store.outbox_count() == 1, 'entry must be retried, not dropped'


def test_pull_happens_once_the_outbox_drains():
    _seed_local()
    db = FakeFirestore({'m1': {'status': 'queued', 'submittedAt': '2026-07-14T08:00:00Z'}})

    assert sync_worker.sync_cycle(db) is True
    assert db.pulls == 1


def test_a_failed_flush_retries_the_same_entry_without_skipping_ahead():
    _seed_local()
    mission_store.release_mission('m1', 'completed', '2026-07-14T10:00:00Z')
    mission_store.write_and_enqueue('m1', {'youtube_url': 'u'}, 'youtube', {'youtubeUrl': 'u'})

    first_seq = mission_store.peek_outbox()['seq']

    db = FakeFirestore({})
    def boom(*a, **k):
        raise RuntimeError('down')
    db.transaction = boom
    sync_worker.sync_cycle(db)

    assert mission_store.peek_outbox()['seq'] == first_seq, 'must not skip ahead'
    assert mission_store.peek_outbox()['attempts'] == 1


def test_entries_flush_in_seq_order_not_timestamp_order():
    """The Pi has no real-time clock, so an offline boot can stamp wildly wrong
    times. Ordering must come from seq (plan 7.2)."""
    _seed_local()
    mission_store.release_mission('m1', 'processing', '2999-01-01T00:00:00Z')  # bogus future clock
    mission_store.release_mission('m1', 'completed', '2020-01-01T00:00:00Z')   # bogus past clock

    applied = []
    remote = {'m1': {'status': 'queued'}}
    db = FakeFirestore(remote)
    real_update = FakeTransaction.update

    def record(self, ref, fields):
        applied.append(fields.get('status'))
        real_update(self, ref, fields)
    FakeTransaction.update = record
    try:
        sync_worker.sync_cycle(db)
    finally:
        FakeTransaction.update = real_update

    assert applied == ['processing', 'completed'], 'seq order, not clock order'


# --- Merge rule (plan section 6) -------------------------------------------

@pytest.mark.parametrize('local,remote,expected_local_wins', [
    ('completed', 'queued', True),
    ('completed', 'processing', True),
    ('completed', 'cancelled', True),
    ('completed', 'failed', True),
    ('failed', 'cancelled', True),
    ('processing', 'completed', False),
    ('queued', 'completed', False),
    ('queued', 'processing', False),
    ('queued', 'failed', False),
])
def test_merge_rule_table(local, remote, expected_local_wins):
    assert sync_worker.should_local_win(
        {'status': local, 'statusUpdatedAt': '2026-01-01T00:00:00Z'},
        {'status': remote, 'statusUpdatedAt': '2026-01-01T00:00:00Z'},
    ) is expected_local_wins


def test_same_rank_is_broken_by_the_later_timestamp():
    assert sync_worker.should_local_win(
        {'status': 'completed', 'statusUpdatedAt': '2026-01-02T00:00:00Z'},
        {'status': 'completed', 'statusUpdatedAt': '2026-01-01T00:00:00Z'},
    ) is True
    assert sync_worker.should_local_win(
        {'status': 'completed', 'statusUpdatedAt': '2026-01-01T00:00:00Z'},
        {'status': 'completed', 'statusUpdatedAt': '2026-01-02T00:00:00Z'},
    ) is False


def test_a_non_status_change_always_applies():
    """Attaching a YouTube URL has no status to compare against."""
    assert sync_worker.should_local_win({'youtubeUrl': 'u'}, {'status': 'completed'}) is True


def test_remote_ahead_is_not_downgraded():
    _seed_local()
    remote = {'m1': {'status': 'completed', 'statusUpdatedAt': '2026-07-14T11:00:00Z'}}
    db = FakeFirestore(remote)

    mission_store.release_mission('m1', 'queued', '2026-07-14T10:00:00Z')
    sync_worker.sync_cycle(db)

    assert remote['m1']['status'] == 'completed', 'a terminal remote must not be resurrected'
    assert mission_store.outbox_count() == 0, 'the entry is still consumed, just not applied'


# --- Conflict logging ------------------------------------------------------

def test_a_losing_terminal_state_is_logged():
    _seed_local()
    remote = {'m1': {'status': 'cancelled', 'statusUpdatedAt': '2026-07-14T09:00:00Z'}}
    db = FakeFirestore(remote)

    mission_store.release_mission('m1', 'completed', '2026-07-14T10:00:00Z')
    sync_worker.sync_cycle(db)

    conflicts = mission_store.get_conflicts()
    assert len(conflicts) == 1
    assert conflicts[0]['local_state'] == 'completed'
    assert conflicts[0]['remote_state'] == 'cancelled'
    assert conflicts[0]['resolution'] == 'local'


def test_normal_forward_progress_is_not_logged_as_a_conflict():
    """queued losing to completed is not a conflict; logging it would bury the
    real ones in noise."""
    _seed_local()
    remote = {'m1': {'status': 'queued', 'statusUpdatedAt': '2026-07-14T09:00:00Z'}}
    db = FakeFirestore(remote)

    mission_store.release_mission('m1', 'completed', '2026-07-14T10:00:00Z')
    sync_worker.sync_cycle(db)

    assert mission_store.get_conflicts() == []


# --- Durability ------------------------------------------------------------

def test_an_entry_is_only_deleted_after_firestore_confirms():
    _seed_local()
    mission_store.release_mission('m1', 'completed', '2026-07-14T10:00:00Z')
    assert mission_store.outbox_count() == 1

    db = FakeFirestore({})
    def boom(*a, **k):
        raise RuntimeError('down')
    db.transaction = boom
    sync_worker.sync_cycle(db)
    assert mission_store.outbox_count() == 1, 'kept for retry'

    db2 = FakeFirestore({'m1': {'status': 'queued'}})
    sync_worker.sync_cycle(db2)
    assert mission_store.outbox_count() == 0, 'dropped once confirmed'


def test_flushing_releases_the_mirror_row_so_pulls_can_refresh_it():
    """local_dirty protects unflushed changes. Never clearing it would freeze
    that mission in the mirror forever."""
    _seed_local()
    mission_store.release_mission('m1', 'completed', '2026-07-14T10:00:00Z')
    assert mission_store.get_mission('m1')['local_dirty'] == 1

    sync_worker.sync_cycle(FakeFirestore({'m1': {'status': 'queued'}}))

    assert mission_store.get_mission('m1')['local_dirty'] == 0


def test_a_dirty_row_is_not_overwritten_by_a_pull():
    _seed_local()
    mission_store.release_mission('m1', 'completed', '2026-07-14T10:00:00Z')

    # A pull arrives carrying the stale remote state while the write is pending.
    mission_store.upsert_missions(
        [{'id': 'm1', 'status': 'queued', 'yardId': 'curiosity'}],
        '2026-07-14T10:30:00Z',
    )

    assert mission_store.get_mission('m1')['status'] == 'completed', \
        'a pending local write must survive a pull'


def test_replaying_an_applied_entry_is_idempotent():
    _seed_local()
    remote = {'m1': {'status': 'queued', 'statusUpdatedAt': '2026-07-14T09:00:00Z'}}
    db = FakeFirestore(remote)

    mission_store.release_mission('m1', 'completed', '2026-07-14T10:00:00Z')
    entry = mission_store.peek_outbox()

    assert sync_worker.flush_one(db, entry) is True
    first = dict(remote['m1'])
    # Replay the same entry: a lost acknowledgement would cause exactly this.
    sync_worker.flush_one(db, entry)

    assert remote['m1'] == first, 'replay must produce one net effect'


def test_worker_keeps_running_when_the_client_cannot_be_built_yet(monkeypatch):
    """A satellite booted with no internet must still start syncing, and pick
    up once the network returns - not sit dead until someone restarts it."""
    attempts = {'n': 0}
    remote = {}

    def factory():
        attempts['n'] += 1
        if attempts['n'] == 1:
            raise RuntimeError('no internet at boot')
        return FakeFirestore(remote)

    timers = []
    monkeypatch.setattr(sync_worker.threading, 'Timer',
                        lambda i, f: type('T', (), {'daemon': False, 'start': lambda s: timers.append(f)})())

    sync_worker.start_sync_worker(factory, interval=1)
    assert attempts['n'] == 1, 'first cycle attempted despite being offline'
    assert timers, 'a retry must be scheduled even though the first cycle failed'

    timers.pop()()  # fire the scheduled retry, now "online"
    assert attempts['n'] == 2, 'the factory is retried rather than given up on'


# --- Read cost (Firestore free tier is 50,000 docs/day) --------------------

def _seed_many(n, status='completed'):
    mission_store.upsert_missions(
        [{'id': f'm{i}', 'yardId': 'curiosity', 'status': status,
          'submittedAt': f'2026-07-{(i % 27) + 1:02d}T08:00:00Z'} for i in range(n)],
        '2026-07-28T09:00:00Z',
    )


def test_a_quiet_cycle_reads_almost_nothing():
    """The regression that matters. Re-pulling the collection every 30 seconds
    cost 576,000 reads/day against a 50,000/day quota."""
    _seed_many(200)
    remote = {f'm{i}': {'status': 'completed', 'submittedAt': '2026-07-01T08:00:00Z'}
              for i in range(200)}
    db = FakeFirestore(remote)

    sync_worker.sync_cycle(db, yard_id='curiosity')

    assert db.meter['docs_read'] <= 2, (
        f"a quiet cycle read {db.meter['docs_read']} documents; it must read ~nothing"
    )


def test_only_new_missions_are_pulled():
    _seed_many(5)  # newest submittedAt is 2026-07-05
    remote = {f'm{i}': {'status': 'completed', 'yardId': 'curiosity',
                        'submittedAt': f'2026-07-{i+1:02d}T08:00:00Z'}
              for i in range(5)}
    remote['brand-new'] = {'status': 'queued', 'yardId': 'curiosity',
                           'submittedAt': '2026-07-28T10:00:00Z'}
    db = FakeFirestore(remote)

    sync_worker.sync_cycle(db, yard_id='curiosity')

    assert mission_store.get_mission('brand-new') is not None
    assert db.meter['docs_read'] <= 2, 'only the new mission should have been read'


def test_another_yards_missions_are_never_pulled():
    """The pull is scoped to this satellite's yard.

    Regression: sync_from_firestore accepted a yard_id and never used it, so
    every yard's missions landed in every mirror - visible in the console and
    dispatchable from it, on a rover in a different building.
    """
    remote = {
        'ours': {'status': 'queued', 'yardId': 'curiosity',
                 'submittedAt': '2026-07-28T10:00:00Z'},
        'theirs': {'status': 'queued', 'yardId': 'durban-rover-1',
                   'submittedAt': '2026-07-28T11:00:00Z'},
    }
    db = FakeFirestore(remote)

    sync_worker.sync_cycle(db, yard_id='curiosity')

    assert mission_store.get_mission('ours') is not None
    assert mission_store.get_mission('theirs') is None


def test_a_foreign_yard_row_does_not_poison_the_cursor():
    """The cursor is yard-scoped too.

    A mirror written before the pull was filtered still holds other yards'
    rows. If the cursor were MAX(submitted_at) across all of them, a newer
    foreign row would push it past this yard's real missions and the queue
    would sit permanently empty with nothing logged to say why.
    """
    mission_store.upsert_missions([
        {'id': 'theirs', 'status': 'queued', 'yardId': 'durban-rover-1',
         'submittedAt': '2026-09-01T08:00:00Z'},
    ], '2026-08-01T00:00:00Z')

    remote = {'ours': {'status': 'queued', 'yardId': 'curiosity',
                       'submittedAt': '2026-08-15T10:00:00Z'}}
    db = FakeFirestore(remote)

    sync_worker.sync_cycle(db, yard_id='curiosity')

    assert mission_store.get_mission('ours') is not None, \
        "a newer row from another yard must not advance this yard's cursor"


def test_an_empty_mirror_does_one_bounded_first_pull():
    remote = {f'm{i}': {'status': 'completed', 'submittedAt': '2026-07-01T08:00:00Z'}
              for i in range(500)}
    db = FakeFirestore(remote)

    sync_worker.sync_cycle(db, yard_id='curiosity')

    assert db.meter['docs_read'] <= sync_worker.FIRST_PULL_LIMIT, 'the first pull must be bounded'


def test_active_missions_are_reconciled_periodically():
    """An incremental pull keyed on submittedAt cannot see a status change made
    elsewhere, so non-terminal missions are re-read on a slower cadence."""
    _seed_many(3, status='queued')
    remote = {
        'm0': {'status': 'completed', 'yardId': 'curiosity', 'submittedAt': '2026-07-01T08:00:00Z'},
        'm1': {'status': 'queued', 'yardId': 'curiosity', 'submittedAt': '2026-07-02T08:00:00Z'},
        'm2': {'status': 'queued', 'yardId': 'curiosity', 'submittedAt': '2026-07-03T08:00:00Z'},
    }
    db = FakeFirestore(remote)

    # Cycles before the reconcile point must not pick the change up...
    for _ in range(sync_worker.RECONCILE_EVERY - 1):
        sync_worker.sync_cycle(db, yard_id='curiosity')
    assert mission_store.get_mission('m0')['status'] == 'queued'

    # ...and the reconcile cycle must.
    sync_worker.sync_cycle(db, yard_id='curiosity')
    assert mission_store.get_mission('m0')['status'] == 'completed'


def test_reconcile_does_not_re_read_terminal_missions():
    """Completed missions do not move, so paying to re-read them is waste."""
    _seed_many(3, status='queued')
    remote = {f'done{i}': {'status': 'completed', 'yardId': 'curiosity',
                           'submittedAt': '2026-07-01T08:00:00Z'} for i in range(100)}
    remote['live'] = {'status': 'queued', 'yardId': 'curiosity',
                      'submittedAt': '2026-07-02T08:00:00Z'}
    db = FakeFirestore(remote)

    sync_worker.reconcile_active(db, yard_id='curiosity')

    assert db.meter['docs_read'] <= 3, (
        f"reconcile read {db.meter['docs_read']} docs; it must only touch active ones"
    )


def test_freshness_is_still_reported_on_a_cycle_that_pulls_nothing():
    """Otherwise the console shows itself as stale despite being connected."""
    _seed_many(2)
    db = FakeFirestore({'m0': {'status': 'completed', 'submittedAt': '2026-07-01T08:00:00Z'}})

    mission_store.set_meta('last_synced_at', '2020-01-01T00:00:00Z')
    sync_worker.sync_cycle(db, yard_id='curiosity')

    _, last_synced, _total = mission_store.get_missions()
    assert last_synced > '2026-01-01', 'last_synced_at must advance on a quiet cycle'


def test_reconcile_drops_a_mission_deleted_remotely():
    """Nothing else prunes the mirror, so a deleted mission would otherwise sit
    in the console forever - and stay dispatchable."""
    _seed_local('gone', status='queued')
    _seed_local('alive', status='queued')
    remote = {'alive': {'status': 'queued', 'yardId': 'curiosity'}}

    sync_worker.reconcile_active(FakeFirestore(remote), yard_id='curiosity')

    assert mission_store.get_mission('gone') is None
    assert mission_store.get_mission('alive') is not None


def test_a_mission_with_unflushed_writes_is_never_pruned():
    """Removing it would silently discard a local change that never reached
    Firestore - exactly the loss push-before-pull exists to prevent."""
    _seed_local('gone', status='queued')
    mission_store.release_mission('gone', 'completed', '2026-07-28T10:00:00Z')

    sync_worker.reconcile_active(FakeFirestore({}), yard_id='curiosity')

    assert mission_store.get_mission('gone') is not None
    assert mission_store.outbox_count() == 1


# --- Operator bookkeeping from the desk (AB#379) ----------------------------
#
# Mission Control became a second writer of run documents when complete,
# cancel, attach-video and resolve moved off the satellite. These pin the rule
# that settles the two: a human decision outranks a replayed machine event.

def test_run_merge_unchanged_when_nobody_decided_remotely():
    """The ordinary case. A yard that is online and working is untouched."""
    local = {'status': 'completed', 'statusUpdatedAt': '2026-08-29T10:00:00Z'}

    assert sync_worker.merge_run_payload(local, {}) == local
    assert sync_worker.merge_run_payload(local, {'status': 'processing'}) == local


def test_stale_satellite_replay_cannot_undo_a_desk_decision():
    """The case this rule exists for.

    The yard was offline all afternoon. An operator marked the mission complete
    from the desk. The yard reconnects that evening and replays a 'processing'
    it recorded hours earlier. Without the rule it wins, because a merge with
    no rule always does, and the operator watches their decision revert.
    """
    local = {'status': 'processing', 'statusUpdatedAt': '2026-08-29T10:00:00Z'}
    remote = {
        'status': 'completed',
        'decidedAt': '2026-08-29T14:30:00Z',
        'decidedBy': 'operator@example.com',
    }

    assert sync_worker.merge_run_payload(local, remote) == {}


def test_a_rover_that_finished_after_the_decision_still_wins():
    """Not everything late is stale.

    An operator cancels a mission at 14:30 believing it stuck. The rover was in
    fact still driving and finished at 14:35. That is news rather than a replay,
    and the run should record what actually happened.
    """
    local = {'status': 'completed', 'statusUpdatedAt': '2026-08-29T14:35:00Z'}
    remote = {'status': 'cancelled', 'decidedAt': '2026-08-29T14:30:00Z'}

    assert sync_worker.merge_run_payload(local, remote) == local


def test_a_locally_attached_video_survives_a_remote_decision():
    """Suppress the conflict, not the whole entry.

    The video is not in conflict with the status somebody set in the cloud, and
    dropping the entry wholesale would lose the only link to the recording.
    """
    local = {
        'status': 'processing',
        'statusUpdatedAt': '2026-08-29T10:00:00Z',
        'youtubeUrl': 'https://youtu.be/abcdefghijk',
    }
    remote = {'status': 'completed', 'decidedAt': '2026-08-29T14:30:00Z'}

    assert sync_worker.merge_run_payload(local, remote) == {
        'youtubeUrl': 'https://youtu.be/abcdefghijk',
    }


def test_a_stale_review_flag_cannot_reopen_a_resolved_review():
    """Resolving is a decision too.

    recovery.py flags an interrupted run. The operator resolves it from the
    desk. The satellite must not re-raise the flag when it reconnects, or the
    review list refills with work somebody already did.
    """
    local = {
        'status': 'processing',
        'statusUpdatedAt': '2026-08-29T09:00:00Z',
        'needsReview': True,
        'reviewReason': 'Satellite restarted mid-mission',
    }
    remote = {'status': 'completed', 'needsReview': False, 'decidedAt': '2026-08-29T14:30:00Z'}

    assert sync_worker.merge_run_payload(local, remote) == {}


# flush_run_one had no test at all before this. It is the function that
# actually writes a run to Firestore, so the rule above is only worth as much
# as its application here.

# The run-subcollection doubles that used to sit here were a second copy of
# the Firestore fakes above, differing only in supporting missions/{id}/runs
# nesting and set(merge=). The shared FakeFirestore does both, so this is now
# just a name for what these tests are exercising.
FakeRunFirestore = FakeFirestore


def _run_entry(payload, seq=1):
    return {'seq': seq, 'mission_id': 'm1', 'yard_id': 'curiosity',
            'payload': json.dumps(payload)}


def test_the_private_merge_key_never_reaches_a_run_document():
    """FORCE_KEY is an instruction to the merge, not part of a run.

    It was written straight through to Firestore, where run documents are
    world-readable (firestore.rules allows public read on runs), because this
    path never had the strip that flush_one has always had. Every run an
    operator stopped carried it.
    """
    store = {}
    entry = _run_entry({
        'status': 'queued',
        'statusUpdatedAt': '2026-08-29T10:00:00Z',
        sync_worker.FORCE_KEY: True,
    })

    assert sync_worker.flush_run_one(FakeRunFirestore(store), entry) is True

    written = store['m1/curiosity']
    assert written['status'] == 'queued'
    assert sync_worker.FORCE_KEY not in written


def test_flush_leaves_a_desk_decision_standing():
    """End to end through the real flush, not just the rule."""
    store = {'m1/curiosity': {
        'status': 'completed',
        'decidedAt': '2026-08-29T14:30:00Z',
        'decidedBy': 'operator@example.com',
    }}
    entry = _run_entry({'status': 'processing', 'statusUpdatedAt': '2026-08-29T10:00:00Z'})

    # True: the entry is consumed rather than retried forever. It was applied,
    # and applying it correctly meant writing nothing.
    assert sync_worker.flush_run_one(FakeRunFirestore(store), entry) is True
    assert store['m1/curiosity']['status'] == 'completed'
