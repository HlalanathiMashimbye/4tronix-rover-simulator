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

import asyncio
import contextlib
import threading

import pytest

collect_ignore = []

# Fixtures that mean "this test drives Playwright". Playwright's sync API needs
# its parked loop marker left alone (its internals call get_running_loop() when
# a call switches into the dispatcher greenlet), so _no_phantom_event_loop
# below must stand aside for these.
_PLAYWRIGHT_FIXTURES = {'playwright', 'browser_type', 'browser', 'context', 'page'}


@contextlib.contextmanager
def hidden_running_loop():
    """Hide a parked event loop's running-loop marker for the duration.

    Playwright's sync API parks `loop.run_until_complete(...)` on a greenlet
    "until the end of times" (its own words), and pytest-playwright keeps that
    playwright instance alive for the whole session. Parking a greenlet does
    not clear the thread's running-loop marker, so from the moment the first
    browser test runs, every later test in the process sees a "running" event
    loop that is not actually executing - and its asyncio.run() dies with
    "cannot be called from a running event loop". recording_control.is_ready
    swallows that into ready=False, which is how nine tests failed only in a
    full run while CI, with the browser tests in a separate job, stayed green.

    _set_running_loop is a private asyncio API, but it is the exact
    thread-local the parked loop set on its way in; saving and restoring it
    around code that never switches into the parked greenlet is safe, because
    nothing can resume that loop while our code holds the thread.
    """
    parked = asyncio.events._get_running_loop()
    asyncio.events._set_running_loop(None)
    try:
        yield
    finally:
        asyncio.events._set_running_loop(parked)


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

    # Nor may a test go looking for a rover. Saving an address probes it, and
    # discovery can sweep a whole /24 - neither belongs in a unit test, and
    # leaving them real put twelve seconds back on the suite.
    import rover_discovery
    monkeypatch.setattr(rover_discovery, '_health', lambda url, timeout=None: None)
    monkeypatch.setattr(rover_discovery, '_port_open', lambda *a, **k: False)
    # Same five-second .local lookup as ROVER_URL above, once per rover found.
    monkeypatch.setattr(rover_discovery, '_resolve', lambda host: host)

    yield
    camera_state.invalidate()


@pytest.fixture(scope='session')
def live_server():
    """One Flask server for every browser-driven test, on an ephemeral port.

    This lived in test_status_page.py, and test_blockly_codegen.py imported
    it - which registers a SECOND fixture under the same name, so "session
    scope" ran twice and the second server died binding the same fixed port
    in a daemon thread nobody looked at. The tests passed anyway (the first
    server answered for both), leaving a spurious unhandled-thread warning in
    every full run. One definition here is visible to both files without the
    import, and make_server binds before the thread starts, so there is no
    fixed port to collide on and no sleep to guess the startup time.
    """
    from werkzeug.serving import make_server
    from web_server import app as flask_app

    server = make_server('127.0.0.1', 0, flask_app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_port}'
    server.shutdown()
    thread.join(timeout=5)


@pytest.fixture(autouse=True)
def _no_phantom_event_loop(request):
    """No test may inherit the browser tests' parked event loop.

    See hidden_running_loop for the failure this prevents. Playwright tests
    are the one place the marker is load-bearing, so they are left alone.
    """
    if _PLAYWRIGHT_FIXTURES & set(request.fixturenames):
        yield
        return
    with hidden_running_loop():
        yield


try:  # pragma: no cover - trivial import probe
    import playwright.sync_api  # noqa: F401
except ImportError:
    collect_ignore.append('test_blockly_codegen.py')
    collect_ignore.append('test_status_page.py')
    collect_ignore.append('test_mission_control_return.py')

# requirements-test.txt deliberately excludes opencv-python/numpy to keep CI
# light (recording_control.py imports them lazily for exactly this reason);
# test_recording_control.py exercises the real encode/decode path, so it needs
# them installed. Same collection-time skip as the playwright guard above.
try:  # pragma: no cover - trivial import probe
    import cv2  # noqa: F401
except ImportError:
    collect_ignore.append('test_recording_control.py')
    # Same reason: it pushes known colours through the real JPEG encode.
    collect_ignore.append('test_camera_colour.py')


def pytest_report_header(config):
    if collect_ignore:
        return (
            'optional dependencies not installed: skipping '
            f'({", ".join(collect_ignore)})'
        )
    return None
