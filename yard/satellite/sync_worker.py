"""
Sync worker - the only component that talks to Firestore.

Plan reference: yard/docs/offline-sync-plan.md sections 4, 5 (PR 3) and 6.

The Flask request handlers read and write SQLite only. This worker runs on a
background thread and reconciles that local state with Firestore, which is what
lets the console keep working with no internet instead of failing at the door.

The ordering rule is the important part and it is not arbitrary: flush the
outbox BEFORE pulling. A local write records a physical event - the rover
actually moved across the yard. The Firestore copy is stale by definition,
because it never heard about that run. Pulling first would overwrite ground
truth with staleness and silently erase the fact that a mission ran.
"""

import json
import os
import threading
from datetime import datetime, timezone

from mission_store import (
    clear_dirty,
    clear_run_dirty,
    delete_outbox,
    delete_run_outbox,
    get_meta,
    log_conflict,
    mark_attempt,
    mark_run_attempt,
    active_mission_ids,
    get_active_runs,
    forget_mission,
    newest_submitted_at,
    peek_outbox,
    peek_run_outbox,
    set_meta,
    upsert_missions,
    upsert_runs,
)

# Read-cost budget. Firestore's free tier allows 50,000 document reads a day,
# shared with every learner loading the public feed.
#
# The naive version of this worker pulled 200 documents every 30 seconds:
#
#     2,880 cycles/day x 200 docs = 576,000 reads/day
#
# which is 11x the entire daily quota, from one satellite, before a single
# learner opens the site. What follows keeps the same 30-second freshness at
# roughly 1/100th of the cost:
#
#   - Incremental pull. New missions only, via submittedAt > cursor. A quiet
#     cycle reads nothing (an empty query result is billed as one read), so the
#     floor is ~2,880 reads/day.
#   - Active reconcile. Missions can also change remotely (mission-control
#     PATCH, the YouTube poll), and an incremental-by-submittedAt query cannot
#     see that. So every RECONCILE_EVERY cycles, re-read only the missions that
#     can still change - queued and processing. Terminal missions are not
#     re-read, because they do not move.
#   - A bounded first pull seeds an empty mirror.

FIRST_PULL_LIMIT = 200
INCREMENTAL_LIMIT = 100

# Every Nth cycle re-reads the missions that are still unfinished. At the
# default 30s interval that is every 5 minutes, well inside the time it takes
# an operator to notice anything.
#
# Both are tunable without a code change, because the right trade-off differs
# by day: during an event, freshness matters and there is an operator watching;
# on a quiet day the same settings just burn quota for nobody. Roughly:
#
#   SYNC_INTERVAL=30,  SYNC_RECONCILE_EVERY=10  ->  ~10,000 reads/day
#   SYNC_INTERVAL=60,  SYNC_RECONCILE_EVERY=10  ->  ~5,000 reads/day
#   SYNC_INTERVAL=120, SYNC_RECONCILE_EVERY=5   ->  ~4,000 reads/day
RECONCILE_EVERY = int(os.environ.get('SYNC_RECONCILE_EVERY', 10))
DEFAULT_INTERVAL = int(os.environ.get('SYNC_INTERVAL', 30))
_CYCLE_KEY = 'sync_cycle_count'

# Bounds for the operator-facing setting. The floor is not arbitrary: at 10s a
# single satellite spends ~8,600 reads/day before anything happens, and the
# free tier is 50,000 shared with every learner loading the public site. The
# ceiling is where "live" stops being a fair description of the queue.
MIN_INTERVAL = 10
MAX_INTERVAL = 600
MIN_RECONCILE = 1
MAX_RECONCILE = 60


def _configured(key, default):
    """Read a tunable from satellite_config.json on every use.

    Read per cycle rather than captured at import so a change from the Settings
    page takes effect on the next tick, instead of at the next restart of a
    box that lives in a science centre and is rarely restarted deliberately.
    """
    try:
        import json
        from satellite_identity import CONFIG_FILE
        with open(CONFIG_FILE) as f:
            value = json.load(f).get(key)
        return default if value is None else int(value)
    except Exception:
        return default


def sync_interval():
    return max(MIN_INTERVAL, min(_configured('sync_interval', DEFAULT_INTERVAL), MAX_INTERVAL))


def reconcile_every():
    return max(MIN_RECONCILE, min(_configured('sync_reconcile_every', RECONCILE_EVERY), MAX_RECONCILE))


def estimated_daily_reads(interval=None, reconcile=None, active_missions=10):
    """Rough Firestore reads/day for the current settings, for the Settings page.

    Deliberately an estimate and labelled as one. The incremental pull bills one
    read per cycle even when it returns nothing; the reconcile costs one per
    still-active mission, every Nth cycle.
    """
    interval = sync_interval() if interval is None else interval
    reconcile = reconcile_every() if reconcile is None else reconcile
    cycles = 86400 / max(1, interval)
    return int(cycles + (cycles / max(1, reconcile)) * max(0, active_missions))

# Higher wins. A mission only ever moves up this ladder, never back down, so
# most reconnect conflicts resolve themselves with no coordination.
_RANK = {'queued': 0, 'processing': 1, 'cancelled': 2, 'failed': 3, 'completed': 4}

_TERMINAL = ('completed', 'failed', 'cancelled')

# Marks an outbox payload as a deliberate operator decision (see
# should_local_win). Stripped before the payload reaches Firestore - it is
# instruction to the merge, not part of the mission.
FORCE_KEY = '__operatorDecision'


def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def should_local_win(local_payload, remote_data):
    """Merge rule from plan section 6: higher rank wins, later time breaks ties."""
    # An operator decision beats the ladder. The ranking below assumes missions
    # only ever move forward, which is true of everything that happens on its
    # own - a run finishes, the watcher records it - but not of the things a
    # human deliberately does. Stopping a rover moves 'processing' back to
    # 'queued' (1 -> 0), a rerun moves 'completed' back to 'processing'
    # (4 -> 1), and re-queuing an interrupted mission does the same. Every one
    # of those loses to the remote copy under the ladder, so the local change
    # was flushed, silently rejected, and pulled straight back on the next
    # reconcile: the operator saw the mission revert for no stated reason.
    #
    # Those transitions are marked at the point they are made, rather than
    # inferred here, because "is this a demotion" is not the question - the
    # question is whether a human chose it, and only the caller knows that.
    if local_payload.get(FORCE_KEY):
        return True

    local_status = local_payload.get('status')
    remote_status = remote_data.get('status')

    # A non-status change (attaching a YouTube URL) has nothing to compare.
    if not local_status or not remote_status:
        return True

    local_rank = _RANK.get(local_status, -1)
    remote_rank = _RANK.get(remote_status, -1)

    if local_rank != remote_rank:
        return local_rank > remote_rank

    return local_payload.get('statusUpdatedAt', '') >= remote_data.get('statusUpdatedAt', '')


def _maybe_log_conflict(mission_id, local_payload, remote_data, local_won):
    """Record a merge only when the LOSING side was already terminal.

    Normal forward progression - queued losing to completed - is not a
    conflict. Logging it would bury the real ones in noise nobody reads.
    """
    local_status = local_payload.get('status')
    remote_status = remote_data.get('status')
    if not local_status or not remote_status:
        return

    loser = remote_status if local_won else local_status
    if loser in _TERMINAL:
        log_conflict(
            mission_id,
            local_state=local_status,
            remote_state=remote_status,
            resolution='local' if local_won else 'remote',
        )


def flush_one(firestore_client, entry, collection_name='missions'):
    """Apply one outbox entry to Firestore. Returns True only on confirmation.

    The merge rule is evaluated INSIDE the transaction, so a remote change that
    lands between the read and the write cannot be clobbered. Replaying an
    entry that already applied is safe: every operation is a state assignment
    rather than an increment, and the rule is re-evaluated rather than blindly
    overwriting.
    """
    from firebase_admin import firestore

    ref = firestore_client.collection(collection_name).document(entry['mission_id'])
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
                # The marker is ours, not the mission's; Firestore never sees it.
                transaction.update(ref, {k: v for k, v in local_payload.items() if k != FORCE_KEY})

        _apply(firestore_client.transaction())

        if outcome:
            _maybe_log_conflict(
                entry['mission_id'], outcome['local_payload'],
                outcome['remote'], outcome['won'],
            )

        # Only after Firestore confirms. Dropping the row first would lose the
        # write entirely if the commit had actually failed.
        delete_outbox(entry['seq'])
        # Release the mirror row once nothing else is queued for it, so pulls
        # can refresh it again. Without this, a mission touched offline once
        # stays frozen in the mirror forever.
        clear_dirty(entry['mission_id'])
        return True

    except Exception as e:
        mark_attempt(entry['seq'], str(e))
        return False


def flush_run_one(firestore_client, entry):
    """Apply one run outbox entry to Firestore. Returns True only on confirmation.

    Mirrors flush_one but writes to the runs subcollection at
    missions/{missionId}/runs/{yardId}. No merge rule applied - runs are
    scoped to one yard so only that yard ever writes them.
    """
    from firebase_admin import firestore

    mission_id = entry['mission_id']
    yard_id = entry['yard_id']
    ref = (
        firestore_client
        .collection('missions')
        .document(mission_id)
        .collection('runs')
        .document(yard_id)
    )

    try:
        @firestore.transactional
        def _apply(transaction):
            snap = ref.get(transaction=transaction)
            remote = (snap.to_dict() or {}) if getattr(snap, 'exists', False) else {}
            local_payload = json.loads(entry['payload'])

            # No merge rule: only this yard writes this run, so local always wins
            # if we got here. Just merge in the fields (don't overwrite unrelated ones).
            transaction.set(ref, local_payload, merge=True)

        _apply(firestore_client.transaction())

        delete_run_outbox(entry['seq'])
        clear_run_dirty(mission_id, yard_id)
        return True

    except Exception as e:
        mark_run_attempt(entry['seq'], str(e))
        return False


def sync_from_firestore(firestore_client, collection_name='missions', yard_id=None):
    """Pull only what changed, rather than the whole collection every cycle.

    Returns True on success. Rows with pending local writes are protected by
    `local_dirty` inside upsert_missions.
    """
    try:
        col = firestore_client.collection(collection_name)
        cursor = newest_submitted_at(yard_id=yard_id)

        # Scope every pull to this yard. Without it the mirror ingested EVERY
        # yard's missions: the parameter was accepted here and never used, so a
        # second yard's queue would appear in this console and be dispatchable
        # from it, and the read budget would grow with a yard we do not serve.
        # yard_id is None only if satellite_identity failed to import, in which
        # case pulling everything is still better than pulling nothing.
        scoped = col.where('yardId', '==', yard_id) if yard_id else col

        if cursor:
            # Incremental: missions submitted since the newest one we hold.
            query = (
                scoped.where('submittedAt', '>', cursor)
                .order_by('submittedAt')
                .limit(INCREMENTAL_LIMIT)
            )
        else:
            # Empty mirror (first boot, or the db was cleared): seed it.
            query = scoped.order_by('submittedAt', direction='DESCENDING').limit(FIRST_PULL_LIMIT)

        missions = []
        for doc in query.stream():
            data = doc.to_dict() or {}
            data['id'] = doc.id
            missions.append(data)

        if missions:
            upsert_missions(missions, _now_iso())
        else:
            # Nothing new, but the console still needs to know we reached
            # Firestore just now or it will report itself as stale.
            set_meta('last_synced_at', _now_iso())

        return True
    except Exception as e:
        print(f'[sync] Failed to pull from Firestore: {e}')
        return False


def reconcile_active(firestore_client, collection_name='missions', yard_id=None):
    """Re-read the missions the MIRROR still considers unfinished.

    An incremental pull keyed on submittedAt cannot see a mission whose status
    changed remotely - mission-control marking one complete, or the YouTube
    poll attaching a video.

    It reads the locally-active documents by id rather than querying Firestore
    for remotely-active ones, because the transition that matters most is a
    mission FINISHING elsewhere: once it does, it no longer matches an "active"
    filter, so a remote query would never return it and the mirror would keep
    showing it as queued forever.

    Cost is exactly one read per unfinished mission, which is tens of documents
    on a busy day rather than the whole collection.
    """
    try:
        ids = active_mission_ids(yard_id)
        if not ids:
            return True

        col = firestore_client.collection(collection_name)
        missions = []
        for mission_id in ids:
            snap = col.document(mission_id).get()
            if not getattr(snap, 'exists', False):
                # Deleted remotely. Nothing else prunes the mirror, so without
                # this the console shows a mission that no longer exists - and
                # an operator can still try to dispatch it. Free to do here:
                # the document was read either way. forget_mission refuses if
                # local writes are still queued for it.
                if forget_mission(mission_id):
                    print(f'[sync] {mission_id} no longer exists remotely; removed from the mirror')
                continue
            data = snap.to_dict() or {}
            data['id'] = mission_id
            missions.append(data)

        if missions:
            upsert_missions(missions, _now_iso())
        return True
    except Exception as e:
        print(f'[sync] Failed to reconcile active missions: {e}')
        return False


def sync_cycle(firestore_client, collection_name='missions', yard_id=None):
    """One cycle: flush runs BEFORE missions, then pull both.

    Push-before-pull ordering: runs are the execution source of truth, so they
    flush first. A failed flush stops the whole cycle. Entries apply in `seq`
    order (the Pi's wall-clock timestamps cannot be trusted for ordering).
    """
    # Flush run outbox first: runs are the execution ground truth
    while True:
        entry = peek_run_outbox()
        if entry is None:
            break
        if not flush_run_one(firestore_client, entry):
            return False

    # Then flush mission outbox (program-only data)
    while True:
        entry = peek_outbox()
        if entry is None:
            break
        if not flush_one(firestore_client, entry, collection_name):
            return False

    ok = sync_from_firestore(firestore_client, collection_name, yard_id=yard_id)

    # Periodically re-read the missions that can still change remotely.
    count = int(get_meta(_CYCLE_KEY, '0') or 0) + 1
    set_meta(_CYCLE_KEY, str(count))
    if ok and count % reconcile_every() == 0:
        reconcile_active(firestore_client, collection_name, yard_id=yard_id)

    return ok


def start_sync_worker(client_factory, interval=None):
    """Poll on a background timer.

    Takes a FACTORY, not a client: a satellite that boots with no internet
    cannot build a Firestore client yet, and refusing to start here would mean
    it never syncs even once the network returns. The factory is retried every
    cycle instead.

    Mirrors start_polling's shape - the body can never kill the loop, so one
    bad cycle does not stop syncing forever.
    """
    def _loop():
        try:
            client = client_factory() if callable(client_factory) else client_factory
            try:
                from satellite_identity import yard_id as _yard_id
                yard = _yard_id()
            except Exception:
                yard = None
            sync_cycle(client, yard_id=yard)
        except Exception as e:
            print(f'[sync] Unexpected error: {e}')

        # Re-read every cycle: an explicit `interval` argument still pins it
        # (the tests rely on that), but the default follows the configured
        # value so a change on the Settings page applies without a restart.
        delay = sync_interval() if interval is None else interval
        timer = threading.Timer(delay, _loop)
        timer.daemon = True
        timer.start()

    _loop()
