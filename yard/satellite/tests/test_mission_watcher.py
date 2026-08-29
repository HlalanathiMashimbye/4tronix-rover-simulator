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
import mission_store  # noqa: E402
import mission_watcher  # noqa: E402

ROVER = 'http://rover.local:8523'


@pytest.fixture(autouse=True)
def _mirror(tmp_path, monkeypatch):
    monkeypatch.setattr(mission_store, 'DB_PATH', str(tmp_path / 'm.db'))
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
