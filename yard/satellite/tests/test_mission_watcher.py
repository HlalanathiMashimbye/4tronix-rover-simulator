"""
The watcher, which now does exactly one thing: release the camera.

It used to also complete missions in the Firestore mirror, flag rover errors
for review and notify mission-control. All of that went with the mirror. The
tests for it went too; these cover what is left, which is the half that could
never have moved to Mission Control anyway - the camera and the file are on
this box, and only the rover knows the run is over.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import mission_watcher
import recording_control

YARD = 'curiosity'


class _Reply:
    def __init__(self, history, status_code=200):
        self._history = history
        self.status_code = status_code

    def json(self):
        return {'history': self._history}


def _rover_says(monkeypatch, history, status_code=200):
    monkeypatch.setattr(mission_watcher.requests, 'get',
                        lambda *a, **k: _Reply(history, status_code))


@pytest.fixture
def recorder(monkeypatch, tmp_path):
    """The real recording table, with the frame consumer stubbed out.

    _writers and _paths are module globals, so without clearing them a test
    that starts a recording and does not stop it leaves the next test looking
    at its state. That is exactly how the first run of this file produced two
    failures that had nothing to do with the code under test.
    """
    monkeypatch.setattr(recording_control, 'RECORDINGS_DIR', str(tmp_path))
    monkeypatch.setattr(recording_control, '_ensure_consumer_started', lambda: None)
    monkeypatch.setattr(recording_control, '_writers', {})
    monkeypatch.setattr(recording_control, '_paths', {})
    monkeypatch.setattr(recording_control, '_started', {})
    monkeypatch.setattr(recording_control, '_dispatches', {})
    return recording_control


def test_a_finished_run_has_its_recording_released(monkeypatch, recorder):
    _rover_says(monkeypatch, [{'status': 'completed', 'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', YARD)

    stopped = mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD)

    assert stopped == ['m1']
    assert not recorder.is_recording('m1', YARD)


def test_a_run_the_rover_could_not_execute_still_keeps_its_film(monkeypatch, recorder):
    """A run the rover refused may still have filmed something worth seeing,
    and that judgement belongs to whoever watches it."""
    _rover_says(monkeypatch, [{'status': 'error', 'error': 'SyntaxError',
                               'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', YARD)
    path = recorder._paths[('m1', YARD)]
    open(path, 'wb').write(b'x')

    mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD)

    assert not recorder.is_recording('m1', YARD)
    assert os.path.exists(path), 'the file must survive an errored run'


def test_a_run_still_going_is_left_filming(monkeypatch, recorder):
    _rover_says(monkeypatch, [{'status': 'running', 'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', YARD)

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []
    assert recorder.is_recording('m1', YARD)


def test_an_unreachable_rover_changes_nothing(monkeypatch, recorder):
    """"I could not tell" must never be read as "it finished"."""
    def boom(*a, **k):
        raise mission_watcher.requests.exceptions.ConnectionError('no route')
    monkeypatch.setattr(mission_watcher.requests, 'get', boom)
    recorder.start_recording('m1', YARD)

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []
    assert recorder.is_recording('m1', YARD)


def test_manual_drive_history_is_ignored(monkeypatch, recorder):
    """Driving the rover by hand produces history entries with no mission id.
    They must not be read as some other run finishing."""
    _rover_says(monkeypatch, [{'status': 'completed', 'params': {'code': 'forward'}}])
    recorder.start_recording('m1', YARD)

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []
    assert recorder.is_recording('m1', YARD)


def test_another_yards_run_is_not_stopped_here(monkeypatch, recorder):
    _rover_says(monkeypatch, [{'status': 'completed', 'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', 'another-yard')

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []
    assert recorder.is_recording('m1', 'another-yard')


def test_a_recording_already_stopped_is_not_stopped_again(monkeypatch, recorder):
    _rover_says(monkeypatch, [{'status': 'completed', 'params': {'mission_id': 'm1'}}])

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []


def test_the_watcher_never_sends_anything_to_the_rover(monkeypatch, recorder):
    """Plan 2.3: never move the robot without a human. Reading an outcome the
    rover already reported moves nothing; a POST would."""
    _rover_says(monkeypatch, [{'status': 'completed', 'params': {'mission_id': 'm1'}}])
    posted = []
    monkeypatch.setattr(mission_watcher.requests, 'post',
                        lambda *a, **k: posted.append(a))
    recorder.start_recording('m1', YARD)

    mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD)

    assert posted == []


def test_a_non_200_from_the_rover_is_not_an_outcome(monkeypatch, recorder):
    _rover_says(monkeypatch, [{'status': 'completed', 'params': {'mission_id': 'm1'}}],
                status_code=503)
    recorder.start_recording('m1', YARD)

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []
    assert recorder.is_recording('m1', YARD)


def test_a_mission_id_starting_with_a_dash_still_finds_its_recording(monkeypatch, recorder):
    """15 September 2026: mission -BQwFDUWvyhpbQ4ZI8het recorded for 126 minutes.

    The station files a recording under the id reduced for a path, which drops
    a leading dash. The rover reports the id exactly as it was sent, dash and
    all, so the watcher looked for a recording that was never filed under that
    name and nothing ever stopped it.
    """
    _rover_says(monkeypatch, [{'id': 'run-1', 'status': 'completed',
                               'params': {'mission_id': '-BQwFDUWvyhpbQ4ZI8het'}}])
    recorder.start_recording('BQwFDUWvyhpbQ4ZI8het', YARD)

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == [
        'BQwFDUWvyhpbQ4ZI8het']
    assert not recorder.is_recording('BQwFDUWvyhpbQ4ZI8het', YARD)


def test_a_rerun_is_not_stopped_by_the_previous_run_of_the_same_mission(monkeypatch, recorder):
    """Re-running is the normal case. The rover's history still holds the last
    attempt, so matching on the mission id stopped the new recording on the
    first poll, before its own run had finished."""
    recorder.start_recording('m1', YARD)
    recorder.note_dispatch('m1', YARD, 'run-2')
    earlier = {'id': 'run-1', 'status': 'completed', 'params': {'mission_id': 'm1'}}

    _rover_says(monkeypatch, [earlier])
    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []
    assert recorder.is_recording('m1', YARD)

    _rover_says(monkeypatch, [earlier, {'id': 'run-2', 'status': 'completed',
                                        'params': {'mission_id': 'm1'}}])
    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == ['m1']


def test_a_recording_nothing_will_stop_is_stopped_after_the_cap(recorder):
    """A rover switched off mid-run never reports finishing, and a recording
    started by hand has no run at all. Either way the file used to grow until
    somebody noticed."""
    recorder.start_recording('m1', YARD)
    path = recorder._paths[('m1', YARD)]
    open(path, 'wb').write(b'x')
    began = recorder._started[('m1', YARD)]

    assert mission_watcher.stop_overdue_recordings(YARD, max_seconds=600, now=began + 599) == []
    assert recorder.is_recording('m1', YARD)

    assert mission_watcher.stop_overdue_recordings(YARD, max_seconds=600, now=began + 601) == ['m1']
    assert not recorder.is_recording('m1', YARD)
    assert os.path.exists(path), 'an overdue recording is stopped, not thrown away'


def test_the_cap_is_longer_than_any_mission_can_run():
    # Missions are refused past 120 seconds on both sides of the LAN.
    assert mission_watcher.MAX_RECORDING_SECONDS > 120 * 2


def test_is_recording_tracks_an_open_recording(recorder):
    assert recorder.is_recording('m1', YARD) is False

    recorder.start_recording('m1', YARD)
    try:
        assert recorder.is_recording('m1', YARD) is True
        assert recorder.is_recording('m1', 'other-yard') is False
    finally:
        recorder.stop_recording('m1', YARD, keep=False)

    assert recorder.is_recording('m1', YARD) is False
