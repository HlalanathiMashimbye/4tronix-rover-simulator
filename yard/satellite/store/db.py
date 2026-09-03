"""
The mirror database itself: where it lives, how to open it, and its schema.

Everything else in this package goes through _connect(). DB_PATH is read at
connect time rather than captured at import, which is what lets a test point
one at a throwaway file.
"""

import os
import sqlite3
import threading
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
#
# NOTE this now lives one directory deeper than mission_store.py did, so the
# path climbs out of store/ to keep resolving to yard/satellite/missions.db.
DB_PATH = os.environ.get(
    'MISSION_MIRROR_DB',
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'missions.db'),
)

# Finished missions are paged rather than capped. This is only a page size:
# the console asks for more as the operator scrolls, and it all comes from
# local SQLite, so a larger page costs DOM nodes and nothing else.
DEFAULT_FINISHED_PAGE = 40
_db_lock = threading.Lock()

# Kept in step with sync_worker.FORCE_KEY by hand rather than imported: the
# sync worker imports this package, so importing it back would be circular.
_FORCE_KEY = '__operatorDecision'

# The single source of truth for the mirror's shape. _migrate reads the column
# list back out of this script (see _expected_columns), so adding a column here
# is the whole job: existing databases widen themselves on the next boot and
# there is no second hand-maintained list to forget to update.
_SCHEMA = """
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
        local_dirty       INTEGER DEFAULT 0,
        -- Mirrored copy of the run's recording_status, for the frontend
        -- contract only (BACKLOG 335/336/338) - see set_run_recording_state.
        recording_status  TEXT NOT NULL DEFAULT 'none'
    );

    -- Write queue: local changes not yet accepted by Firestore.
    CREATE TABLE IF NOT EXISTS outbox (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid       TEXT UNIQUE NOT NULL,
        mission_id TEXT NOT NULL,
        op         TEXT NOT NULL,
        payload    TEXT NOT NULL,
        event_at   TEXT NOT NULL,
        attempts   INTEGER DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        -- Set when an entry can never be delivered, so the queue behind it can
        -- still drain. See store.outbox.mark_attempt.
        parked     INTEGER NOT NULL DEFAULT 0
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
        -- Recording lifecycle, satellite-local only - never queued to
        -- run_outbox, see set_run_recording_state.
        recording_status     TEXT NOT NULL DEFAULT 'none',  -- none|recording|kept|discarded
        recording_path       TEXT,
        recording_started_at TEXT,
        recording_stopped_at TEXT,
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
        created_at TEXT NOT NULL,
        parked     INTEGER NOT NULL DEFAULT 0
    );
"""


def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """Create the tables if they don't exist, and widen them if they are old."""
    with _db_lock:
        conn = _connect()
        conn.executescript(_SCHEMA)
        _migrate(conn)
        conn.commit()
        conn.close()


def _expected_columns():
    """The columns _SCHEMA declares, per table, read back out of _SCHEMA itself.

    Building this by running the script against an empty in-memory database
    means the declaration cannot drift from what _migrate reconciles against:
    there is one schema, written once.
    """
    probe = sqlite3.connect(':memory:')
    probe.row_factory = sqlite3.Row
    try:
        probe.executescript(_SCHEMA)
        # sqlite_sequence is created implicitly by AUTOINCREMENT and is not ours.
        tables = [
            r['name'] for r in probe.execute(
                "SELECT name FROM sqlite_master"
                " WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {
            table: {r['name']: dict(r) for r in probe.execute(f'PRAGMA table_info({table})')}
            for table in tables
        }
    finally:
        probe.close()


def _add_column_sql(table, info):
    """ALTER statement that adds one column back onto an existing table.

    SQLite cannot add a NOT NULL column without a default to a populated table,
    so a column declared that way is added nullable rather than not at all: a
    slightly loose column beats a mirror that stays broken forever.
    """
    decl = f"{info['name']} {info['type']}"
    if info['dflt_value'] is not None:
        if info['notnull']:
            decl += ' NOT NULL'
        decl += f" DEFAULT {info['dflt_value']}"
    return f'ALTER TABLE {table} ADD COLUMN {decl}'


def _migrate(conn):
    """Widen any table that predates a column _SCHEMA now declares.

    CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
    a mirror written by an older build keeps its old, narrower shape forever.
    Every query naming a newer column then fails with a bare "no such column",
    once per poll, with nothing to say which build it came from or what to do:
    that is exactly how a satellite sat for hours logging
    "no such column: youtube_url" while the mirror quietly stayed unusable.

    Reconciling against the whole schema rather than a hand-kept list of recent
    additions means a database that has drifted by any amount repairs itself,
    including one that drifted before this function knew how to notice.
    """
    for table, expected in _expected_columns().items():
        existing = {r['name'] for r in conn.execute(f'PRAGMA table_info({table})')}
        if not existing:
            continue  # Table absent entirely; the CREATE above already made it.
        for name, info in expected.items():
            if name in existing:
                continue
            try:
                conn.execute(_add_column_sql(table, info))
            except sqlite3.OperationalError as e:
                # A PRIMARY KEY column cannot be added back. The mirror is a
                # cache of Firestore, so say plainly that deleting it is the
                # fix, rather than failing again on every later query.
                raise RuntimeError(
                    f"Mirror at {DB_PATH} is too old to repair automatically: "
                    f"table '{table}' is missing column '{name}' and SQLite "
                    f"refused to add it ({e}). Flush the outbox, then delete "
                    f"the file and let it rebuild from Firestore."
                ) from e
