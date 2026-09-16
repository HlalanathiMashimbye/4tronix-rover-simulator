"""No test may see the browser tests' parked event loop.

16 September 2026: a full local run (`pytest yard/satellite/tests yard/rover`
in one process) failed nine tests that all passed per-file. Playwright's sync
API parks `run_until_complete` on a greenlet for the whole session, which
leaves the thread's running-loop marker set, and every later `asyncio.run()`
in the process then raised "cannot be called from a running event loop".
CI never saw it because the browser tests run in a separate job.

conftest.hidden_running_loop is the fix. The first test here exercises it
against a hand-parked marker - the exact thread state playwright leaves -
so it fails in any test order if the context manager stops working. The
second is the canary: it runs inside the autouse guard like every other
test, so if a future dependency parks a loop some other way, this file
names the problem instead of recording_control's tests failing obliquely.
"""

import asyncio

from tests.conftest import hidden_running_loop


def test_hidden_running_loop_lets_asyncio_run_work_and_restores_the_marker():
    parked = asyncio.new_event_loop()
    asyncio.events._set_running_loop(parked)
    try:
        with hidden_running_loop():
            # This is the call that failed suite-wide: asyncio.run refuses to
            # start while the thread claims a loop is already running.
            assert asyncio.run(asyncio.sleep(0, result='ran')) == 'ran'
        # Playwright's next call greenlet-switches back into its parked loop
        # and its internals ask get_running_loop(); the marker must be back.
        assert asyncio.events._get_running_loop() is parked
    finally:
        asyncio.events._set_running_loop(None)
        parked.close()


def test_no_running_loop_is_visible_inside_an_ordinary_test():
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    assert loop is None, f'a parked event loop leaked into this test: {loop!r}'
