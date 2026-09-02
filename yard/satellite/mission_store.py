"""
The satellite's local mirror of Firestore.

This module is a facade. It was 1379 lines doing six jobs; the code now lives
in the `store` package, one module per job, and this file re-exports the names
so every existing caller keeps working:

    store/db.py        the database: where it lives, opening it, the schema
    store/outbox.py    local writes waiting to reach Firestore
    store/missions.py  mission-level reads and writes
    store/runs.py      one yard's attempt at a mission
    store/review.py    the needs-review flow and the conflict log
    store/meta.py      sync cursors

The dependency graph is a DAG and stays one: db has no dependencies, outbox
depends only on db, and missions/runs/review/meta depend on those two. Nothing
in the package imports this facade, and nothing should - that would make a
cycle out of a structure that is currently acyclic.

DB_PATH is re-exported here for the many callers that read it, but a test
pointing the mirror at a temporary file must patch `store.db.DB_PATH`, which
is where _connect() actually reads it.
"""

# Deliberately explicit rather than `import *`: the names below ARE the
# module's public surface, and listing them means adding to that surface is a
# visible decision rather than a side effect of defining a function.

from store.db import (  # noqa: F401
    DB_PATH,
    DEFAULT_FINISHED_PAGE,
    _SCHEMA,
    _FORCE_KEY,
    _db_lock,
    _now_iso,
    _connect,
    init_db,
    _migrate,
)
from store.outbox import (  # noqa: F401
    MAX_FLUSH_ATTEMPTS,
    parked_entries,
    unpark_outbox,
    outbox_count,
    write_and_enqueue,
    peek_outbox,
    delete_outbox,
    mark_attempt,
    _enqueue,
    peek_run_outbox,
    delete_run_outbox,
    mark_run_attempt,
    _enqueue_run,
)
from store.meta import (  # noqa: F401
    get_meta,
    set_meta,
)
from store.missions import (  # noqa: F401
    upsert_missions,
    get_missions,
    last_synced_at,
    status_counts,
    completed_without_video,
    get_mission,
    clear_dirty,
    mission_has_pending,
    set_mirror_only,
    set_mission_field,
    release_mission,
    find_interrupted,
    newest_submitted_at,
    active_mission_ids,
    forget_mission,
    delete_mission,
    backfill_missions_to_runs,
)
from store.runs import (  # noqa: F401
    get_run,
    get_runs,
    get_active_runs,
    upsert_runs,
    _rollup_mission_status,
    acquire_run,
    release_run,
    set_run_field,
    set_run_recording_state,
    clear_run_dirty,
    run_has_pending,
)
from store.review import (  # noqa: F401
    flag_for_review,
    get_needs_review,
    resolve_review,
    log_conflict,
    get_conflicts,
)
