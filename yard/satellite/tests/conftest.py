"""Shared pytest configuration for the satellite test-suite.

Two of these files drive a real browser through Playwright, which is a heavy
dependency that is not needed to run the other 200 tests. Without this, a
plain `pytest tests` on a machine that has not installed it fails at
COLLECTION - an ImportError, before a single test runs - so the whole suite
looks broken rather than "two optional files skipped". That was papered over
by passing `--ignore` flags by hand, which meant the real command differed
from the documented one and was easy to get wrong in CI.

Skipping at collection time keeps `pytest tests` correct everywhere: it runs
everything it can, and says plainly what it left out.
"""

import pytest

collect_ignore = []


@pytest.fixture(autouse=True)
def _isolate_satellite_state(tmp_path, monkeypatch):
    """Point every test at a throwaway mirror and config, always.

    mission_store.DB_PATH is a module global read at connect time, so a test
    that does not explicitly redirect it talks to whatever database the
    developer happens to have on disk - yard/satellite/missions.db, the real
    one, with real missions in it.

    That is not hypothetical. test_poll_survives_firestore_error requests
    neither the `missions` fixture nor `client`, and was fine only because it
    never reached SQLite. The moment the YouTube poll started reading its
    candidate list from the mirror, that test began quietly querying the
    developer's real database - and still passed, because that database exists
    locally and has the table. In CI, where it does not, the same test failed
    with "no such table: mission_mirror". It was green for a reason that had
    nothing to do with the code under test.

    Autouse rather than opt-in for exactly that reason: the tests that need
    isolating are the ones nobody thought to isolate. Fixtures that want their
    own seeded mirror (`missions`) redirect DB_PATH themselves and run after
    this, so they are unaffected.
    """
    import mission_store
    import satellite_identity

    monkeypatch.setattr(mission_store, 'DB_PATH', str(tmp_path / 'isolated-mirror.db'))
    monkeypatch.setattr(satellite_identity, 'CONFIG_FILE', str(tmp_path / 'isolated-sat.json'))
    satellite_identity.reset_cache()
    # Create the schema, so a test that reads the mirror without seeding it
    # sees an empty database rather than a missing table: "no missions" is a
    # meaningful state to test against, "no such table" is a broken fixture.
    mission_store.init_db()
    yield
    satellite_identity.reset_cache()

try:  # pragma: no cover - trivial import probe
    import playwright.sync_api  # noqa: F401
except ImportError:
    collect_ignore = ['test_blockly_codegen.py', 'test_status_page.py']


def pytest_report_header(config):
    if collect_ignore:
        return (
            'playwright not installed: skipping browser tests '
            f'({", ".join(collect_ignore)})'
        )
    return None
