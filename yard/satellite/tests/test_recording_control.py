"""
recording_control tests (BACKLOG 334/335/336/338).

Guarded at collection time in conftest.py when opencv-python is not
installed, same as the playwright-dependent browser tests - this file
exercises the real JPEG encode/decode path rather than mocking cv2.

websockets.connect is faked throughout: these are unit tests for the module's
own logic (readiness, writer lifecycle, keep/discard), not integration tests
against a real camera_server.py process.
"""

import asyncio
import base64
import json
import os
import sys
import time

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import mission_store
import store.db as store_db  # noqa: E402
import recording_control  # noqa: E402

YARD = 'curiosity'


def _frame_message():
    frame = np.zeros((4, 4, 3), dtype=np.uint8)
    ok, buf = cv2.imencode('.jpg', frame)
    assert ok
    data = base64.b64encode(buf.tobytes()).decode('ascii')
    return json.dumps({'type': 'frame', 'data': data})


class FakeConnection:
    """Stands in for a websockets client connection: an async context
    manager that is both async-iterable (for the consumer loop) and offers
    recv() (for the readiness probe)."""

    def __init__(self, messages=(), hang=False):
        self._messages = list(messages)
        self._hang = hang

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._hang:
            await asyncio.sleep(10)
        if not self._messages:
            raise StopAsyncIteration
        return self._messages.pop(0)

    async def recv(self):
        if self._hang:
            await asyncio.sleep(10)
        if not self._messages:
            raise RuntimeError('no more fake messages')
        return self._messages.pop(0)


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch):
    monkeypatch.setattr(store_db, 'DB_PATH', str(tmp_path / 'm.db'))
    mission_store.init_db()
    monkeypatch.setenv('RECORDING_DIR', str(tmp_path / 'recordings'))
    monkeypatch.setattr(recording_control, '_writers', {})
    monkeypatch.setattr(recording_control, '_paths', {})
    monkeypatch.setattr(recording_control, '_consumer_thread', None)
    monkeypatch.setattr(recording_control, '_last_frame_at', None)
    # start_recording() would otherwise spawn a real background thread that
    # starts consuming immediately, racing every test that drives
    # _consumer_loop() manually and synchronously for determinism. Tests that
    # care about frame-writing call _consumer_loop() themselves.
    monkeypatch.setattr(recording_control, '_ensure_consumer_started', lambda: None)


def _seed(mission_id, yard_id=YARD, recording_status='none', recording_path=None):
    mission_store.upsert_missions(
        [{'id': mission_id, 'yardId': yard_id, 'status': 'processing',
          'submittedAt': '2026-07-14T08:00:00Z'}],
        '2026-07-14T09:00:00Z',
    )
    mission_store.upsert_runs([{
        'missionId': mission_id, 'yardId': yard_id, 'status': 'processing',
        'statusUpdatedAt': '2026-07-14T09:00:00Z',
    }], '2026-07-14T09:00:00Z')
    if recording_status != 'none':
        mission_store.set_run_recording_state(mission_id, yard_id, recording_status, path=recording_path)


# ---------------------------------------------------------------------------
# is_ready (BACKLOG 334)
# ---------------------------------------------------------------------------

def test_is_ready_returns_true_when_a_frame_arrives_within_the_timeout(monkeypatch):
    monkeypatch.setattr(recording_control.websockets, 'connect',
                         lambda *a, **k: FakeConnection([_frame_message()]))

    ready, detail = recording_control.is_ready(timeout=1.0)

    assert ready is True
    assert detail is None


def test_is_ready_returns_false_when_no_frame_arrives_before_the_timeout(monkeypatch):
    monkeypatch.setattr(recording_control.websockets, 'connect',
                         lambda *a, **k: FakeConnection(hang=True))

    ready, detail = recording_control.is_ready(timeout=0.05)

    assert ready is False
    assert detail


def test_is_ready_returns_false_when_the_camera_is_unreachable(monkeypatch):
    def refuse(*a, **k):
        raise OSError('connection refused')
    monkeypatch.setattr(recording_control.websockets, 'connect', refuse)

    ready, detail = recording_control.is_ready(timeout=0.5)

    assert ready is False
    assert 'could not reach' in detail


def test_is_ready_reuses_a_live_recording_instead_of_opening_a_second_probe(monkeypatch):
    recording_control._last_frame_at = time.monotonic()

    def fail_if_called(*a, **k):
        pytest.fail('is_ready must not open a second connection when frames are already flowing')
    monkeypatch.setattr(recording_control.websockets, 'connect', fail_if_called)

    ready, detail = recording_control.is_ready()

    assert ready is True


# ---------------------------------------------------------------------------
# start_recording / the consumer loop
# ---------------------------------------------------------------------------

def test_start_recording_registers_a_path_for_the_run():
    ok, path = recording_control.start_recording('m1', YARD)

    assert ok is True
    assert path.endswith(f'm1__{YARD}.mp4')
    assert recording_control._paths[('m1', YARD)] == path


def test_consumer_loop_writes_incoming_frames_to_the_file(monkeypatch):
    """Runs _consumer_loop synchronously (not on a background thread) against
    a fake connection with a fixed number of frames, so the file's existence
    can be checked deterministically once it returns."""
    monkeypatch.setattr(recording_control.websockets, 'connect',
                         lambda *a, **k: FakeConnection([_frame_message()] * 3))
    ok, path = recording_control.start_recording('m1', YARD)
    assert ok

    recording_control._consumer_loop()  # blocks until the fake connection is exhausted

    assert os.path.exists(path)
    assert os.path.getsize(path) > 0
    assert recording_control._last_frame_at is not None


def test_two_concurrent_runs_get_independent_writers_off_one_shared_connection(monkeypatch):
    """Mission 'm1' can run on two different yards simultaneously (the run
    model keys everything by (mission_id, yard_id)), and each gets its own
    file off the one shared camera connection."""
    connect_calls = []

    def fake_connect(*a, **k):
        connect_calls.append(1)
        return FakeConnection([_frame_message()] * 3)
    monkeypatch.setattr(recording_control.websockets, 'connect', fake_connect)

    ok1, path1 = recording_control.start_recording('m1', 'yard-a')
    ok2, path2 = recording_control.start_recording('m1', 'yard-b')
    recording_control._consumer_loop()

    assert ok1 and ok2
    assert path1 != path2
    assert os.path.exists(path1) and os.path.getsize(path1) > 0
    assert os.path.exists(path2) and os.path.getsize(path2) > 0
    assert len(connect_calls) == 1, 'one shared connection, not one per run'


# ---------------------------------------------------------------------------
# stop_recording (BACKLOG 338)
# ---------------------------------------------------------------------------

def test_stop_recording_with_keep_leaves_the_file_and_marks_it_kept(monkeypatch):
    _seed('m1')
    monkeypatch.setattr(recording_control.websockets, 'connect',
                         lambda *a, **k: FakeConnection([_frame_message()]))
    ok, path = recording_control.start_recording('m1', YARD)
    recording_control._consumer_loop()
    assert os.path.exists(path)

    ok, detail = recording_control.stop_recording('m1', YARD, keep=True)

    assert ok is True
    assert os.path.exists(path)
    assert mission_store.get_run('m1', YARD)['recording_status'] == 'kept'
    assert ('m1', YARD) not in recording_control._writers


def test_stop_recording_without_keep_deletes_the_file_and_marks_it_discarded(monkeypatch):
    _seed('m1')
    monkeypatch.setattr(recording_control.websockets, 'connect',
                         lambda *a, **k: FakeConnection([_frame_message()]))
    ok, path = recording_control.start_recording('m1', YARD)
    recording_control._consumer_loop()
    assert os.path.exists(path)

    ok, detail = recording_control.stop_recording('m1', YARD, keep=False)

    assert ok is True
    assert not os.path.exists(path)
    assert mission_store.get_run('m1', YARD)['recording_status'] == 'discarded'


def test_stop_recording_discards_an_already_kept_file_with_no_active_writer(tmp_path):
    """The post-hoc discard path: an operator resolving a review as
    'cancelled', or requeuing, calls this after mission_watcher already
    stopped-and-kept the recording - no writer is open any more."""
    path = str(tmp_path / 'kept.mp4')
    with open(path, 'wb') as f:
        f.write(b'not really a video, just needs to exist')
    _seed('m1', recording_status='kept', recording_path=path)

    ok, detail = recording_control.stop_recording('m1', YARD, keep=False)

    assert ok is True
    assert not os.path.exists(path)
    assert mission_store.get_run('m1', YARD)['recording_status'] == 'discarded'


def test_stop_recording_is_a_no_op_for_a_run_with_no_active_recording():
    _seed('m1')  # recording_status defaults to 'none'

    ok, detail = recording_control.stop_recording('m1', YARD, keep=False)

    assert ok is True
    assert detail == 'not recording'
    assert mission_store.get_run('m1', YARD)['recording_status'] == 'none'
