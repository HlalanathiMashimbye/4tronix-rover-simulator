"""
Mission watcher tests.

The watcher completes missions the rover confirms. The dangerous failure mode
is marking something complete that never ran, so most of these check that it
stays quiet when it cannot be sure.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import mission_store
import store.db as store_db  # noqa: E402
import mission_watcher  # noqa: E402

ROVER = 'http://rover.local:8523'


@pytest.fixture(autouse=True)
def _mirror(tmp_path, monkeypatch):
    monkeypatch.setattr(store_db, 'DB_PATH', str(tmp_path / 'm.db'))
    mission_store.init_db()


def _seed(mission_id, status, needs_review=0, owner='sat-1'):
    """Seed a mission and create a run for it in the given status.

    Missions are programs only and must still have a status field (for now),
    set to 'queued' as the default. The execution status is in the run.
    """
    mission_store.upsert_missions(
        [{'id': mission_id, 'yardId': 'curiosity', 'status': 'queued',
          'submittedAt': '2026-07-14T08:00:00Z'}],
        '2026-07-14T09:00:00Z',
    )
    # Create run in the specified status (use camelCase like Firestore)
    yard_id = 'curiosity'
    mission_store.upsert_runs(
        [{
            'missionId': mission_id,
            'yardId': yard_id,
            'status': status,
            'needsReview': needs_review,
            'statusUpdatedAt': '2026-07-14T09:00:00Z',
        }],
        '2026-07-14T09:00:00Z',
    )


def _recording(mission_id, yard_id='curiosity'):
    """Mark a run as actively filming, which _seed deliberately does not do."""
    mission_store.set_run_recording_state(
        mission_id, yard_id, 'recording',
        path=f'/tmp/{mission_id}__{yard_id}.mp4',
        started_at='2026-07-14T09:00:00Z',
    )


def _rover(history):
    class Resp:
        status_code = 200
        def json(self):
            return {'history': history}
    return lambda *a, **k: Resp()


def _done(mission_id):
    return {'cmd': 'run_python', 'status': 'completed', 'params': {'mission_id': mission_id}}


def test_a_confirmed_mission_is_completed(monkeypatch):
    """The whole point: an operator should not have to remember to tap
    'Mark complete' for a run the rover already finished."""
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))

    assert mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity') == ['m1']

    run = mission_store.get_run('m1', 'curiosity')
    assert run['status'] == 'completed'
    assert run['completed_at']
    # No lease to release any more (AB#364): reaching a terminal status is
    # the whole of finishing a run.


def test_completion_is_queued_for_firestore(monkeypatch):
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')

    entry = mission_store.peek_run_outbox()
    assert entry and entry['mission_id'] == 'm1'


def test_the_learner_notification_fires(monkeypatch):
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))
    calls = []

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity', notify=lambda i, s: calls.append((i, s)))

    assert calls == [('m1', 'completed')]


def test_a_confirmed_mission_stops_and_keeps_its_recording(monkeypatch):
    """BACKLOG 335/336: the ordinary successful-run path keeps the video."""
    _seed('m1', 'processing')
    _recording('m1')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))
    calls = []
    monkeypatch.setattr(mission_watcher, 'stop_recording', lambda mission_id, yard_id, keep: calls.append((mission_id, yard_id, keep)))

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')

    assert calls == [('m1', 'curiosity', True)]


def test_a_failing_notify_does_not_lose_the_completion(monkeypatch):
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))

    def boom(*a):
        raise RuntimeError('mission-control down')

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity', notify=boom)

    assert mission_store.get_run('m1', 'curiosity')['status'] == 'completed'


def test_a_rover_error_does_not_mark_the_mission_failed(monkeypatch):
    """'The code raised' is not 'the run was a failure', and a learner must
    never be shown a failed mission. Leave it for a human."""
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([
        {'cmd': 'run_python', 'status': 'error', 'params': {'mission_id': 'm1'}},
    ]))

    assert mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity') == []
    assert mission_store.get_run('m1', 'curiosity')['status'] == 'processing'


def test_an_unreachable_rover_changes_nothing(monkeypatch):
    _seed('m1', 'processing')

    def boom(*a, **k):
        raise mission_watcher.requests.exceptions.ConnectionError('offline')
    monkeypatch.setattr(mission_watcher.requests, 'get', boom)

    assert mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity') == []
    assert mission_store.get_run('m1', 'curiosity')['status'] == 'processing'


def test_missions_awaiting_human_review_are_left_alone(monkeypatch):
    """A flagged mission is the operator's decision to make."""
    _seed('m1', 'processing', needs_review=1)
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))

    assert mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity') == []
    assert mission_store.get_run('m1', 'curiosity')['needs_review'] == 1


def test_a_mission_with_pending_writes_is_skipped(monkeypatch):
    """Do not race a flush that is already carrying a change for this run."""
    _seed('m1', 'processing')
    mission_store.set_run_field('m1', 'curiosity', {'youtube_url': 'u'}, {'youtubeUrl': 'u'})
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))

    assert mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity') == []


def test_already_terminal_missions_are_not_touched(monkeypatch):
    _seed('c1', 'completed')
    _seed('q1', 'queued')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('c1'), _done('q1')]))

    assert mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity') == []
    assert mission_store.get_run('q1', 'curiosity')['status'] == 'queued', 'a queued run never ran'


def test_manual_drive_history_is_ignored(monkeypatch):
    """Tapping a drive block produces history with no mission_id."""
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([
        {'cmd': 'forward', 'status': 'completed'},
        {'cmd': 'stop', 'status': 'completed', 'params': {}},
    ]))

    assert mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity') == []


def test_the_watcher_never_sends_anything_to_the_rover(monkeypatch):
    """Plan 2.3: it may record an outcome, never cause a physical action."""
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))

    def no_post(*a, **k):
        raise AssertionError('the watcher POSTed to the rover')
    monkeypatch.setattr(mission_watcher.requests, 'post', no_post)

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')


def test_the_rover_url_is_read_each_cycle(monkeypatch):
    """It is editable at runtime from /status, so capturing it once would leave
    the watcher polling a stale address after an operator fixes it."""
    urls = []
    monkeypatch.setattr(mission_watcher.requests, 'get',
                        lambda url, **k: urls.append(url) or _rover([])(url))
    fired = []
    monkeypatch.setattr(mission_watcher.threading, 'Timer',
                        lambda i, f: type('T', (), {'daemon': False,
                                                    'start': lambda s: fired.append(f)})())

    changing = iter(['http://first', 'http://second'])
    mission_watcher.start_mission_watcher(lambda: next(changing), interval=1)
    fired.pop()()

    assert urls[0].startswith('http://first')
    assert urls[1].startswith('http://second')


# --- Runs the rover could not execute ---------------------------------------
#
# Regression: the rover records status='error' with the reason on the
# instruction, but the watcher only ever read 'completed' entries. A mission
# whose code could not run therefore sat in 'processing' forever, and the
# operator was given no reason at all - it simply never happened.

def _errored(mission_id, message):
    return {'cmd': 'run_python', 'status': 'error', 'error': message,
            'params': {'mission_id': mission_id}}


def test_a_run_the_rover_rejected_is_flagged_with_the_reason(monkeypatch):
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([
        _errored('m1', 'SyntaxError: invalid syntax (line 1)'),
    ]))

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')

    run = mission_store.get_run('m1', 'curiosity')
    assert run['needs_review'] == 1
    assert 'SyntaxError' in run['review_reason'], run['review_reason']
    assert run['status'] == 'processing', 'the watcher must not invent an outcome'


def test_a_run_the_rover_rejected_stops_and_keeps_its_recording_pending_review(monkeypatch):
    """BACKLOG 338 - the corrected behavior: nothing is deleted at flag time.
    Capturing stops (there is nothing left to film), but the file is kept so
    an operator can review it; only their own resolve decision discards it."""
    _seed('m1', 'processing')
    _recording('m1')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([
        _errored('m1', 'SyntaxError: invalid syntax (line 1)'),
    ]))
    calls = []
    monkeypatch.setattr(mission_watcher, 'stop_recording', lambda mission_id, yard_id, keep: calls.append((mission_id, yard_id, keep)))

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')

    assert calls == [('m1', 'curiosity', True)]
    run = mission_store.get_run('m1', 'curiosity')
    assert run['status'] == 'processing'
    assert run['needs_review'] == 1


def test_an_errored_run_is_never_marked_failed(monkeypatch):
    """'failed' reaches the learner as a run that went wrong. The truth here is
    that the code never ran, which is an operator's problem, not a child's."""
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([
        _errored('m1', 'boom'),
    ]))

    assert mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity') == []
    assert mission_store.get_run('m1', 'curiosity')['status'] != 'failed'


def test_an_errored_run_does_not_re_flag_an_already_flagged_mission(monkeypatch):
    _seed('m1', 'processing', needs_review=1)
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([
        _errored('m1', 'second complaint'),
    ]))

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')

    reason = mission_store.get_run('m1', 'curiosity')['review_reason']
    assert reason != 'rover could not run it: second complaint', \
        'a run awaiting a human decision is theirs, not the watcher to restamp'


def test_a_long_rover_error_is_truncated(monkeypatch):
    _seed('m1', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([
        _errored('m1', 'x' * 5000),
    ]))

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')

    assert len(mission_store.get_run('m1', 'curiosity')['review_reason']) <= \
        mission_watcher.REVIEW_REASON_MAX


def test_completions_still_work_alongside_errors(monkeypatch):
    _seed('ok', 'processing')
    _seed('bad', 'processing')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([
        _done('ok'), _errored('bad', 'SyntaxError'),
    ]))

    assert mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity') == ['ok']
    assert mission_store.get_run('ok', 'curiosity')['status'] == 'completed'
    assert mission_store.get_run('bad', 'curiosity')['needs_review'] == 1


# --- The camera must not depend on the network ------------------------------
#
# These pin the fix for a bug found by running the real thing rather than a
# mock: on a yard with no network, recordings never stopped.
#
# The outbox cannot flush while Firestore is unreachable, so run_has_pending
# stays true, so the completion loops below skip the run on every pass. The
# stop_recording calls used to live INSIDE those loops, so the writer was never
# released. Measured on a live camera: ~87KB/s, about 7.5GB a day per stuck
# run, on a 64GB card, and every file unplayable because no moov atom is
# written until the writer closes.
#
# That is the platform's primary scenario, not an edge case. The yard is
# expected to work with no network at all.

def test_a_recording_stops_offline_even_though_the_run_cannot_settle(monkeypatch):
    """The rover finished. Firestore is unreachable. Stop filming anyway.

    The run itself correctly stays 'processing': its status write is still
    sitting in the outbox and the guard against racing a flush is right. But
    whether there is anything left to film is a question the ROVER answers,
    and it needs no network to answer it.
    """
    _seed('m1', 'processing')
    _recording('m1')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))
    monkeypatch.setattr(mission_watcher, 'run_has_pending', lambda *a: True)
    calls = []
    monkeypatch.setattr(mission_watcher, 'stop_recording',
                        lambda mission_id, yard_id, keep: calls.append((mission_id, yard_id, keep)))

    completed = mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')

    assert calls == [('m1', 'curiosity', True)], 'the camera kept running while offline'
    # Unchanged, and correct: settling the run is a separate question.
    assert completed == []
    assert mission_store.get_run('m1', 'curiosity')['status'] == 'processing'


def test_an_errored_run_stops_its_recording_offline_too(monkeypatch):
    """Same rule for a run the rover could not execute.

    keep=True, because BACKLOG 338 leaves the judgement to a human: it may
    still have filmed something worth seeing, and only api_resolve_review
    throws it away.
    """
    _seed('m1', 'processing')
    _recording('m1')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([
        {'cmd': 'run_python', 'status': 'error', 'params': {'mission_id': 'm1'}},
    ]))
    monkeypatch.setattr(mission_watcher, 'run_has_pending', lambda *a: True)
    calls = []
    monkeypatch.setattr(mission_watcher, 'stop_recording',
                        lambda mission_id, yard_id, keep: calls.append((mission_id, yard_id, keep)))

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')

    assert calls == [('m1', 'curiosity', True)]


def test_a_recording_already_stopped_is_not_stopped_again(monkeypatch):
    """The watcher polls on a timer and the rover keeps its history.

    Without a guard, every pass forever would re-stop the same finished
    recording, rewriting recording_stopped_at each time and churning the
    mirror for nothing.
    """
    _seed('m1', 'completed')
    mission_store.set_run_recording_state('m1', 'curiosity', 'kept',
                                          stopped_at='2026-07-14T09:05:00Z')
    monkeypatch.setattr(mission_watcher.requests, 'get', _rover([_done('m1')]))
    calls = []
    monkeypatch.setattr(mission_watcher, 'stop_recording',
                        lambda mission_id, yard_id, keep: calls.append((mission_id, yard_id, keep)))

    mission_watcher.autocomplete_finished_missions(ROVER, yard_id='curiosity')

    assert calls == []
    assert mission_store.get_run('m1', 'curiosity')['recording_stopped_at'] == '2026-07-14T09:05:00Z'


def test_the_watcher_stops_a_manual_recording_when_the_rover_finishes(monkeypatch):
    """A run pasted into /run/ has no runs_mirror row: it never went near
    Firestore, which is that page's whole point. recording_status therefore
    cannot answer for it, and the watcher used to skip it entirely.

    So the manual loop was the one path where the camera kept filming after
    the rover had finished and said so, until somebody remembered to press
    stop. The same unbounded file the comment in this module warns about.
    """
    import mission_watcher
    import recording_control

    monkeypatch.setattr(mission_watcher, 'rover_outcomes',
                        lambda url: ({'m-manual'}, {}))
    monkeypatch.setattr(mission_watcher, 'get_run', lambda mid, yid: None)
    monkeypatch.setattr(mission_watcher, 'get_mission', lambda mid: None)
    monkeypatch.setattr(mission_watcher, 'is_recording',
                        lambda mid, yid: (mid, yid) == ('m-manual', 'curiosity'))
    stopped = []
    monkeypatch.setattr(mission_watcher, 'stop_recording',
                        lambda mid, yid, keep: stopped.append((mid, yid, keep)))

    mission_watcher.autocomplete_finished_missions('http://rover', yard_id='curiosity')

    assert stopped == [('m-manual', 'curiosity', True)], 'the camera must be released'


def test_it_does_not_stop_a_recording_that_was_never_running(monkeypatch):
    import mission_watcher

    monkeypatch.setattr(mission_watcher, 'rover_outcomes',
                        lambda url: ({'m-manual'}, {}))
    monkeypatch.setattr(mission_watcher, 'get_run', lambda mid, yid: None)
    monkeypatch.setattr(mission_watcher, 'get_mission', lambda mid: None)
    monkeypatch.setattr(mission_watcher, 'is_recording', lambda mid, yid: False)
    stopped = []
    monkeypatch.setattr(mission_watcher, 'stop_recording',
                        lambda mid, yid, keep: stopped.append(mid))

    mission_watcher.autocomplete_finished_missions('http://rover', yard_id='curiosity')

    assert stopped == []


def test_is_recording_tracks_an_open_recording(monkeypatch, tmp_path):
    """The accessor the watcher leans on, against the module's own table."""
    import recording_control

    monkeypatch.setattr(recording_control, 'RECORDINGS_DIR', str(tmp_path))
    monkeypatch.setattr(recording_control, '_ensure_consumer_started', lambda: None)

    assert recording_control.is_recording('m1', 'curiosity') is False

    recording_control.start_recording('m1', 'curiosity')
    try:
        assert recording_control.is_recording('m1', 'curiosity') is True
        assert recording_control.is_recording('m1', 'other-yard') is False
    finally:
        recording_control.stop_recording('m1', 'curiosity', keep=False)

    assert recording_control.is_recording('m1', 'curiosity') is False


def test_the_whole_stop_path_wired_up(monkeypatch, tmp_path):
    """The watcher and the recording module, actually joined.

    The tests above stub is_recording and stop_recording to check the branch.
    This one stubs only the rover's HTTP reply and lets the real functions run,
    so a rename or a changed key between the two modules fails here rather than
    silently leaving the camera on.
    """
    import mission_watcher
    import recording_control

    monkeypatch.setattr(recording_control, 'RECORDINGS_DIR', str(tmp_path))
    monkeypatch.setattr(recording_control, '_ensure_consumer_started', lambda: None)
    monkeypatch.setattr(mission_watcher, 'get_run', lambda mid, yid: None)
    monkeypatch.setattr(mission_watcher, 'get_mission', lambda mid: None)

    # The rover's own words, in the shape it actually returns them.
    class Reply:
        status_code = 200
        @staticmethod
        def json():
            return {'history': [{'status': 'completed',
                                 'params': {'mission_id': 'm-manual'}}]}
    monkeypatch.setattr(mission_watcher.requests, 'get', lambda *a, **k: Reply())

    recording_control.start_recording('m-manual', 'curiosity')
    assert recording_control.is_recording('m-manual', 'curiosity')

    mission_watcher.autocomplete_finished_missions('http://rover', yard_id='curiosity')

    assert not recording_control.is_recording('m-manual', 'curiosity'), \
        'the rover said it finished, so the camera must have been released'
