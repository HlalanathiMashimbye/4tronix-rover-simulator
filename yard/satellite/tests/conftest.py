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
    """Point every test at a throwaway config, always.

    This used to redirect the Firestore mirror as well, and had a long note
    about a test that quietly read the developer's real missions.db and passed
    for a reason unrelated to the code under test. There is no mirror any more.

    What is left still matters: satellite_identity caches the yard id and
    writes it back to a config file, so without this a test would read and
    write the real one on the machine running it.
    """
    import satellite_identity
    import camera_state

    monkeypatch.setattr(satellite_identity, 'CONFIG_FILE', str(tmp_path / 'isolated-sat.json'))
    satellite_identity.reset_cache()
    # camera_state caches its snapshot in a module global, so without this a
    # test inherits whatever the previous one probed - the same leak that
    # recording_control's _paths produced, and just as confusing to chase.
    camera_state.invalidate()

    # And no test may open a real socket to find out about a camera that is not
    # there. Every request to /api/status builds a snapshot, so leaving this
    # real took the suite from 0.5s to 20s - one second of connect timeout at a
    # time. A suite that slow stops being run.
    #
    # Default is "nothing listening", which is true of the machine running the
    # tests. A test that cares about camera state patches this itself.
    monkeypatch.setattr(camera_state, '_listening', lambda host, port: False)

    # Nor may a test reach for the rover. /api/status health-checks ROVER_URL,
    # which defaults to the mDNS name marspi.local - and resolving a .local
    # name that is not on the network takes about five seconds before it gives
    # up. Four tests calling /api/status was twenty seconds of the suite spent
    # waiting for DNS. Pointed at a closed local port, the same call refuses
    # instantly and the code path is identical.
    import web_server
    monkeypatch.setattr(web_server, 'ROVER_URL', 'http://127.0.0.1:9')

    yield
    camera_state.invalidate()


try:  # pragma: no cover - trivial import probe
    import playwright.sync_api  # noqa: F401
except ImportError:
    collect_ignore.append('test_blockly_codegen.py')
    collect_ignore.append('test_status_page.py')

# requirements-test.txt deliberately excludes opencv-python/numpy to keep CI
# light (recording_control.py imports them lazily for exactly this reason);
# test_recording_control.py exercises the real encode/decode path, so it needs
# them installed. Same collection-time skip as the playwright guard above.
try:  # pragma: no cover - trivial import probe
    import cv2  # noqa: F401
except ImportError:
    collect_ignore.append('test_recording_control.py')


def pytest_report_header(config):
    if collect_ignore:
        return (
            'optional dependencies not installed: skipping '
            f'({", ".join(collect_ignore)})'
        )
    return None
