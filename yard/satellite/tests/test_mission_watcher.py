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


def _watcher_sees_it_before_the_run_ends(monkeypatch, yard_id=YARD):
    """The watcher's first look at a recording, while its run is still going.

    That is how it goes on the Pi: the watcher looks every half second and the
    station waits a second before sending anything. A run already over at the
    first look is a run from before this recording, and cannot end it.
    """
    _rover_says(monkeypatch, [])
    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=yard_id) == []


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
    monkeypatch.setattr(mission_watcher, '_watched', {})
    return recording_control


def test_a_finished_run_has_its_recording_released(monkeypatch, recorder):
    recorder.start_recording('m1', YARD)
    _watcher_sees_it_before_the_run_ends(monkeypatch)
    _rover_says(monkeypatch, [{'status': 'completed', 'params': {'mission_id': 'm1'}}])

    stopped = mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD)

    assert stopped == ['m1']
    assert not recorder.is_recording('m1', YARD)


def test_a_run_the_rover_could_not_execute_still_keeps_its_film(monkeypatch, recorder):
    """A run the rover refused may still have filmed something worth seeing,
    and that judgement belongs to whoever watches it."""
    recorder.start_recording('m1', YARD)
    path = recorder._paths[('m1', YARD)]
    open(path, 'wb').write(b'x')
    _watcher_sees_it_before_the_run_ends(monkeypatch)
    _rover_says(monkeypatch, [{'status': 'error', 'error': 'SyntaxError',
                               'params': {'mission_id': 'm1'}}])

    mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD)

    assert not recorder.is_recording('m1', YARD)
    assert os.path.exists(path), 'the file must survive an errored run'


def test_a_saved_recording_triggers_upload_with_the_exact_dispatch_id(monkeypatch, recorder):
    _rover_says(monkeypatch, [{'id': 'dispatch-9', 'status': 'completed',
                               'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', YARD)
    recorder.note_dispatch('m1', YARD, 'dispatch-9')
    calls = []

    stopped = mission_watcher.stop_finished_recordings(
        'http://rover',
        yard_id=YARD,
        on_recording_ready=lambda *args: calls.append(args),
    )

    assert stopped == ['m1']
    assert len(calls) == 1
    assert calls[0][:3] == ('m1', 'dispatch-9', YARD)
    assert calls[0][3].endswith('.mp4')
    assert calls[0][4] == 'completed'


def test_the_upload_is_told_when_the_rover_could_not_execute_the_run(monkeypatch, recorder):
    """An uploaded video closes its run in Mission Control. A run the rover
    reported as an error must reach it saying so, or it is closed as done."""
    _rover_says(monkeypatch, [{'id': 'dispatch-9', 'status': 'error', 'error': 'SyntaxError',
                               'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', YARD)
    recorder.note_dispatch('m1', YARD, 'dispatch-9')
    calls = []

    mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD,
                                             on_recording_ready=lambda *args: calls.append(args))

    assert [call[4] for call in calls] == ['error']


def test_repeated_watcher_events_do_not_trigger_a_second_upload(monkeypatch, recorder):
    _rover_says(monkeypatch, [{'id': 'dispatch-9', 'status': 'completed',
                               'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', YARD)
    recorder.note_dispatch('m1', YARD, 'dispatch-9')
    calls = []
    ready = lambda *args: calls.append(args)

    mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD, on_recording_ready=ready)
    mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD, on_recording_ready=ready)

    assert len(calls) == 1


def test_the_first_pass_sends_recordings_still_waiting_to_be_delivered(monkeypatch, recorder):
    """Not only when a run finishes: a satellite that was offline sends what
    it has once it finds a way out, with no new run needed to set it off, from
    its first pass (and every ten seconds after: see the test below)."""
    import youtube_upload

    class Stop(Exception):
        pass

    _rover_says(monkeypatch, [])
    passes = []
    monkeypatch.setattr(youtube_upload, 'tick', lambda: passes.append(True))
    monkeypatch.setattr(mission_watcher.time, 'sleep', lambda _s: (_ for _ in ()).throw(Stop()))

    with pytest.raises(Stop):
        mission_watcher.start_mission_watcher(lambda: 'http://rover')

    assert passes == [True]


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

    The station filed a recording under the id reduced for a path, which
    dropped a leading dash. The rover reports the id exactly as it was sent,
    dash and all, so the watcher looked for a recording that was never filed
    under that name and nothing ever stopped it.

    The dash is kept now: it is part of the id, and the YouTube linker has to
    read it back out of the file name. So the recording here is filed with it.
    """
    recorder.start_recording('-BQwFDUWvyhpbQ4ZI8het', YARD)
    _watcher_sees_it_before_the_run_ends(monkeypatch)
    _rover_says(monkeypatch, [{'id': 'run-1', 'status': 'completed',
                               'params': {'mission_id': '-BQwFDUWvyhpbQ4ZI8het'}}])

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == [
        '-BQwFDUWvyhpbQ4ZI8het']
    assert not recorder.is_recording('-BQwFDUWvyhpbQ4ZI8het', YARD)


def test_a_hand_typed_name_is_found_under_what_it_was_filed_as(monkeypatch, recorder):
    """The case that still needs the watcher to reduce what the rover reports.

    An id is filed as it is, so a watcher comparing raw ids would pass every
    test with an id in it. A name somebody typed is not filed as it is: the
    rover echoes "Thabo's square!" and the recording is Thabo-s-square.
    """
    recorder.start_recording('Thabo-s-square', YARD)
    _watcher_sees_it_before_the_run_ends(monkeypatch)
    _rover_says(monkeypatch, [{'id': 'run-1', 'status': 'completed',
                               'params': {'mission_id': "Thabo's square!"}}])

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == [
        'Thabo-s-square']
    assert not recorder.is_recording('Thabo-s-square', YARD)


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


class _Clock:
    """Simulated time for the watcher loop: sleeping advances it, and the loop
    stops after `seconds` of it so a test can count what happened."""

    class Done(Exception):
        pass

    def __init__(self, seconds):
        self.now = 1000.0
        self.end = self.now + seconds
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds
        if self.now >= self.end:
            raise self.Done()


def _run_watcher_for(monkeypatch, seconds, rover_url_getter=lambda: 'http://rover'):
    clock = _Clock(seconds)
    monkeypatch.setattr(mission_watcher.time, 'monotonic', clock.monotonic)
    monkeypatch.setattr(mission_watcher.time, 'sleep', clock.sleep)
    with pytest.raises(_Clock.Done):
        mission_watcher.start_mission_watcher(rover_url_getter)
    return clock


def test_a_finished_run_is_filmed_for_three_seconds_more_then_stops(monkeypatch, recorder):
    """The recording is the run's video. Asked every ten seconds, it ran on for
    up to ten seconds of a rover sitting still; stopped the moment the rover
    reported the run over, it cut off before the rover had visibly stopped.
    Three seconds after the report, never before, is what looked right on the
    real rover."""
    import youtube_upload
    monkeypatch.setattr(youtube_upload, 'tick', lambda: None)
    clock = _Clock(30)
    monkeypatch.setattr(mission_watcher.time, 'monotonic', clock.monotonic)
    monkeypatch.setattr(mission_watcher.time, 'sleep', clock.sleep)
    # Started on the simulated clock too. Started on the real one, the
    # recording's age is the machine's uptime against 1000 simulated seconds:
    # on a CI runner booted minutes ago it read as over the ten-minute cap and
    # was stopped on the first pass, while on a laptop up for days it passed.
    recorder.start_recording('m1', YARD)

    def rover_reply(*a, **k):
        # Running for the first 3.5 simulated seconds, then over.
        status = 'running' if clock.now < 1003.5 else 'completed'
        return _Reply([{'status': status, 'params': {'mission_id': 'm1'}}])

    monkeypatch.setattr(mission_watcher.requests, 'get', rover_reply)
    stopped_at = {}
    real_stop = recorder.stop_recording

    def stop_and_note(*a, **k):
        stopped_at.setdefault('t', clock.now)
        return real_stop(*a, **k)

    monkeypatch.setattr(mission_watcher, 'stop_recording', stop_and_note)

    with pytest.raises(_Clock.Done):
        mission_watcher.start_mission_watcher(lambda: 'http://rover')

    assert not recorder.is_recording('m1', YARD)
    assert 3.0 <= stopped_at['t'] - 1003.5 <= 3.5


def test_a_run_in_its_tail_stops_on_time_even_if_the_rover_drops_out(monkeypatch, recorder):
    """Once the rover has said a run is over it is not asked again, so losing
    the rover during the tail cannot leave the camera filming."""
    recorder.start_recording('m1', YARD)
    _watcher_sees_it_before_the_run_ends(monkeypatch)
    _rover_says(monkeypatch, [{'status': 'completed', 'params': {'mission_id': 'm1'}}])

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD, tail_seconds=2, now=100) == []
    assert recorder.is_recording('m1', YARD)

    def boom(*a, **k):
        raise mission_watcher.requests.exceptions.ConnectionError('no route')
    monkeypatch.setattr(mission_watcher.requests, 'get', boom)

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD, tail_seconds=2, now=101) == []
    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD, tail_seconds=2, now=102) == ['m1']
    assert not recorder.is_recording('m1', YARD)


def test_the_upload_starts_once_after_the_tail_not_when_the_run_ends(monkeypatch, recorder):
    _rover_says(monkeypatch, [{'id': 'run-1', 'status': 'completed', 'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', YARD)
    recorder.note_dispatch('m1', YARD, 'run-1')
    ready = []

    def on_ready(*args):
        ready.append(args[1])

    for now in (100, 101, 102, 103):
        mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD, on_recording_ready=on_ready,
                                                 tail_seconds=2, now=now)
        if now < 102:
            assert ready == []

    assert ready == ['run-1']


def test_a_rerun_is_not_stopped_by_the_tail_of_the_run_before(monkeypatch, recorder):
    """Stopped by hand during its tail and started again under the same name,
    the new recording is a new run: the old run's finish must not end it."""
    _rover_says(monkeypatch, [{'id': 'run-1', 'status': 'completed', 'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', YARD)
    recorder.note_dispatch('m1', YARD, 'run-1')
    mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD, tail_seconds=2, now=100)

    recorder.stop_recording('m1', YARD, keep=True)
    recorder.start_recording('m1', YARD)
    recorder.note_dispatch('m1', YARD, 'run-2')

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD, tail_seconds=2, now=103) == []
    assert recorder.is_recording('m1', YARD)


def test_nothing_recording_means_the_rover_is_not_asked(monkeypatch, recorder):
    """Asking every second is only worth it while a recording is open; an idle
    satellite should not keep a rover answering it."""
    import youtube_upload
    monkeypatch.setattr(youtube_upload, 'tick', lambda: None)
    asked = []
    monkeypatch.setattr(mission_watcher.requests, 'get', lambda *a, **k: asked.append(a) or _Reply([]))

    _run_watcher_for(monkeypatch, 30)

    assert asked == []


def test_uploads_are_still_checked_every_ten_seconds_not_every_pass(monkeypatch, recorder):
    """The faster rover check must not drag the upload check along with it."""
    import youtube_upload
    checks = []
    monkeypatch.setattr(youtube_upload, 'tick', lambda: checks.append(True))
    _rover_says(monkeypatch, [])

    _run_watcher_for(monkeypatch, 60)

    assert 5 <= len(checks) <= 7


def test_a_rerun_is_not_ended_by_the_last_run_before_it_is_sent(monkeypatch, recorder):
    """25 October 2026, on the real rover: re-running a mission from the run
    station stopped its recording in the lead-in second, before the rover was
    sent anything, because the previous run of the same mission was already
    completed in the rover's history and the new recording had no dispatch
    yet to match on instead."""
    _rover_says(monkeypatch, [{'id': 'run-1', 'status': 'completed', 'params': {'mission_id': 'm1'}}])
    recorder.start_recording('m1', YARD)

    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []
    assert recorder.is_recording('m1', YARD)

    # Then the station sends it, and the rover runs and finishes it.
    recorder.note_dispatch('m1', YARD, 'run-2')
    _rover_says(monkeypatch, [{'id': 'run-1', 'status': 'completed', 'params': {'mission_id': 'm1'}},
                              {'id': 'run-2', 'status': 'completed', 'params': {'mission_id': 'm1'}}])
    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == ['m1']


def test_a_send_that_never_reached_the_rover_does_not_complete_the_run(monkeypatch, recorder):
    """The same day: the rover was unreachable when Send was pressed, so the
    run never reached it. When it came back, its history showed the previous
    run of the mission completed, the watcher ended the recording, and the
    page said Mission complete for a rover that had not moved."""
    def unreachable(*a, **k):
        raise mission_watcher.requests.exceptions.ConnectionError('no route')
    monkeypatch.setattr(mission_watcher.requests, 'get', unreachable)
    recorder.start_recording('m1', YARD)
    assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []

    _rover_says(monkeypatch, [{'id': 'run-1', 'status': 'completed', 'params': {'mission_id': 'm1'}}])
    for _ in range(3):
        assert mission_watcher.stop_finished_recordings('http://rover', yard_id=YARD) == []
    assert recorder.is_recording('m1', YARD)


def test_a_hand_started_recording_is_not_uploaded(monkeypatch, recorder):
    """Only a dispatched run uploads, because the upload names the run; a
    recording started by hand still stops when its mission's run ends."""
    recorder.start_recording('m1', YARD)
    _watcher_sees_it_before_the_run_ends(monkeypatch)
    _rover_says(monkeypatch, [{'id': 'run-9', 'status': 'completed', 'params': {'mission_id': 'm1'}}])
    uploads = []

    assert mission_watcher.stop_finished_recordings(
        'http://rover', yard_id=YARD, on_recording_ready=lambda *a: uploads.append(a)) == ['m1']
    assert uploads == []
