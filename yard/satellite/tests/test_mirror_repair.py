"""
Two failures that let the satellite run for hours while syncing nothing.

Both were found in a developer's real mirror on 2026-08-31, which had been
logging "no such column: youtube_url" once per poll for most of a day while
seventeen queued writes sat behind a single undeliverable one.

1. A mirror created by an older build keeps its narrow shape forever, because
   CREATE TABLE IF NOT EXISTS does nothing to a table that already exists and
   the migration only knew about a hand-kept list of recent additions.
2. The drain loop takes the oldest entry and aborts the cycle when it fails,
   so one write Firestore will never accept blocks every later write and the
   pull half of sync too, for as long as the satellite stays up.
"""

import sqlite3

import pytest

import mission_store
import store.db as store_db
from store.missions import completed_without_video
from store.outbox import (
    MAX_FLUSH_ATTEMPTS,
    mark_attempt,
    mark_run_attempt,
    parked_entries,
    peek_outbox,
    unpark_outbox,
)
from sync_worker import _is_permanent


@pytest.fixture
def drifted_mirror(tmp_path, monkeypatch):
    """A mirror with the shape the real broken database actually had.

    Not a hypothetical narrow table: these are the columns that survived on
    disk, which is why the repair has to reconstruct almost the whole row.
    """
    db = str(tmp_path / 'drifted.db')
    conn = sqlite3.connect(db)
    conn.executescript(
        """
        CREATE TABLE mission_mirror (
            id TEXT PRIMARY KEY, status TEXT NOT NULL, deleted INTEGER DEFAULT 0,
            deleted_at TEXT, recording_status TEXT
        );
        CREATE TABLE outbox (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL,
            mission_id TEXT NOT NULL, op TEXT NOT NULL, payload TEXT NOT NULL,
            event_at TEXT NOT NULL, attempts INTEGER DEFAULT 0, last_error TEXT,
            created_at TEXT NOT NULL
        );
        """
    )
    conn.execute("INSERT INTO mission_mirror (id, status) VALUES ('m1', 'completed')")
    conn.commit()
    conn.close()
    monkeypatch.setattr(store_db, 'DB_PATH', db)
    return db


def _columns(db, table):
    conn = sqlite3.connect(db)
    try:
        return [r[1] for r in conn.execute(f'PRAGMA table_info({table})')]
    finally:
        conn.close()


class TestSchemaRepair:
    def test_the_reported_query_fails_before_repair(self, drifted_mirror):
        """The bug itself, so the repair below is shown to fix something real."""
        with pytest.raises(sqlite3.OperationalError, match='no such column'):
            completed_without_video()

    def test_init_db_widens_a_drifted_table(self, drifted_mirror):
        mission_store.init_db()

        columns = _columns(drifted_mirror, 'mission_mirror')
        assert 'youtube_url' in columns
        # Not just the one column the error happened to name: every column the
        # schema declares, or the next query hits the next missing one.
        for expected in ('name', 'yard_id', 'code', 'blockly_state', 'submitted_at',
                         'started_at', 'completed_at', 'needs_review', 'review_reason',
                         'status_updated_at', 'synced_at', 'local_dirty'):
            assert expected in columns, expected

    def test_repair_preserves_the_rows_already_there(self, drifted_mirror):
        """A mirror is a cache, but silently emptying one is still a bug."""
        mission_store.init_db()

        assert completed_without_video() == ['m1']

    def test_repair_is_idempotent(self, drifted_mirror):
        mission_store.init_db()
        first = _columns(drifted_mirror, 'mission_mirror')
        mission_store.init_db()

        assert _columns(drifted_mirror, 'mission_mirror') == first

    def test_every_declared_table_is_reconciled(self, drifted_mirror):
        """The guard against this class of bug returning.

        _migrate reads its expectations out of _SCHEMA rather than a separate
        list, so a column added to the schema and forgotten elsewhere still
        reaches existing databases. This asserts the two cannot drift apart.
        """
        mission_store.init_db()

        for table, expected in store_db._expected_columns().items():
            assert set(_columns(drifted_mirror, table)) >= set(expected), table


class TestPoisonEntryParking:
    """A write Firestore will never accept must not hold up the ones behind it."""

    @pytest.fixture
    def queued(self):
        mission_store.upsert_missions(
            [{'id': f'm{i}', 'status': 'queued'} for i in (1, 2, 3)],
            '2026-08-31T00:00:00Z',
        )
        for i in (1, 2, 3):
            mission_store.write_and_enqueue(
                f'm{i}', {'status': 'processing'}, 'status', {'status': 'processing'}
            )

    def test_permanent_rejection_parks_immediately(self, queued):
        assert peek_outbox()['mission_id'] == 'm1'

        mark_attempt(1, '404 No document to update', permanent=True)

        # The whole point: the queue moves on rather than retrying a 404 every
        # thirty seconds while m2 and m3 never leave the satellite.
        assert peek_outbox()['mission_id'] == 'm2'

    def test_a_parked_entry_is_kept_and_visible(self, queued):
        mark_attempt(1, '404 No document to update', permanent=True)

        parked = parked_entries()
        assert [(e['queue'], e['mission_id']) for e in parked] == [('mission', 'm1')]
        # Kept whole, so an operator can see what would have been written.
        assert parked[0]['last_error'] == '404 No document to update'
        assert parked[0]['payload']

    def test_an_outage_is_ridden_out_rather_than_parked(self, queued):
        """The risk of parking: doing it to a write that would have succeeded."""
        for _ in range(MAX_FLUSH_ATTEMPTS - 1):
            mark_attempt(1, 'connection reset by peer')

        assert peek_outbox()['mission_id'] == 'm1'

    def test_a_hopeless_entry_parks_eventually_even_without_a_status(self, queued):
        """Backstop for a failure that never reports a code we can classify."""
        for _ in range(MAX_FLUSH_ATTEMPTS):
            mark_attempt(1, 'connection reset by peer')

        assert peek_outbox()['mission_id'] == 'm2'

    def test_unparking_puts_entries_back_in_order(self, queued):
        mark_attempt(1, 'gone', permanent=True)

        assert unpark_outbox() == 1
        entry = peek_outbox()
        assert entry['mission_id'] == 'm1'
        # Attempts reset too, or the entry parks again on its next failure.
        assert entry['attempts'] == 0

    def test_run_queue_parks_on_the_same_rules(self):
        mission_store.upsert_runs(
            [{'missionId': 'm1', 'yardId': 'curiosity', 'status': 'queued'}],
            '2026-08-31T00:00:00Z',
        )
        mission_store.acquire_run('m1', 'curiosity', '2026-08-31T00:01:00Z')

        mark_run_attempt(1, '403 Missing permissions', permanent=True)

        assert [(e['queue'], e['mission_id']) for e in parked_entries()] == [('run', 'm1')]


class TestPermanentClassification:
    """Read from the status code, never the message wording."""

    @pytest.mark.parametrize('code', [400, 403, 404])
    def test_client_rejections_are_permanent(self, code):
        assert _is_permanent(type('E', (Exception,), {'code': code})())

    @pytest.mark.parametrize('code', [429, 500, 503, 504])
    def test_server_and_throttling_errors_are_retried(self, code):
        assert not _is_permanent(type('E', (Exception,), {'code': code})())

    def test_an_error_without_a_code_is_retried(self):
        """Safe direction to be wrong in: a retry lands, a bad park never does."""
        assert not _is_permanent(RuntimeError('connection reset'))

    def test_a_grpc_style_callable_code_is_not_mistaken_for_a_status(self):
        """grpc exposes `code` as a method; treating it as a status would park at random."""
        assert not _is_permanent(type('E', (Exception,), {'code': lambda self: 404})())
