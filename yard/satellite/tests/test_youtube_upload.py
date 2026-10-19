"""Delivering recordings to Mission Control, from a satellite that is usually offline.

Delivery used to try three times in the seconds after a run and then give up
for good. A satellite serving the yard's wifi has no internet, so those tries
always failed there. These cover the outbox that replaced them: a note beside
each recording that stays until Mission Control has the video or has said it
never will.
"""

import json
import os
import sys

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import recording_control
import youtube_upload

NOW = 1_800_000_000.0
# The fixture swaps kick for a no-op; the one test about it needs the real one.
REAL_KICK = youtube_upload.kick


class Reply:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._body = body if body is not None else {'status': 'uploaded'}

    def json(self):
        return self._body


@pytest.fixture
def yard(monkeypatch, tmp_path):
    """A recordings folder with one finished run in it, a configured satellite,
    and no background thread: each test runs the delivery pass itself."""
    monkeypatch.setattr(recording_control, 'RECORDINGS_DIR', str(tmp_path))
    monkeypatch.setenv('YOUTUBE_UPLOAD_INGEST_SECRET', 'local-test-secret')
    monkeypatch.setenv('MISSION_CONTROL_URL', 'https://mission.example/')
    monkeypatch.setattr(youtube_upload, 'kick', lambda: None)
    recording = tmp_path / 'm1__curiosity__20261011T102030Z.mp4'
    recording.write_bytes(b'mp4 test data')
    return recording


def answer(monkeypatch, *replies):
    """Mission Control's replies, in order. An exception is raised instead."""
    calls = []
    queue = list(replies)

    def post(*args, **kwargs):
        calls.append((args, kwargs))
        reply = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(youtube_upload.requests, 'post', post)
    return calls


def note_of(recording):
    path = str(recording) + youtube_upload.NOTE_SUFFIX
    if not os.path.exists(path):
        return None
    with open(path) as handle:
        return json.load(handle)


def test_a_finished_run_is_sent_with_its_dispatch_its_yard_and_what_the_rover_said(monkeypatch, yard):
    calls = answer(monkeypatch, Reply())

    assert youtube_upload.queue_upload('m1', 'dispatch-1', 'curiosity', str(yard), 'completed') == 'queued'
    assert youtube_upload.deliver_due(now=NOW) == [(yard.name, 'done', 'uploaded')]

    args, kwargs = calls[0]
    assert args[0] == 'https://mission.example/api/youtube-upload/recording'
    assert kwargs['headers'] == {'x-youtube-upload-secret': 'local-test-secret'}
    assert kwargs['data'] == {
        'missionId': 'm1',
        'runId': 'dispatch-1',
        'yardId': 'curiosity',
        'recordingName': yard.name,
        'outcome': 'completed',
    }
    assert kwargs['files']['file'][0] == yard.name
    assert note_of(yard) is None, 'delivered, so nothing is left to send'


def test_without_the_credential_nothing_is_noted_and_nothing_is_sent(monkeypatch, yard):
    monkeypatch.delenv('YOUTUBE_UPLOAD_INGEST_SECRET')
    calls = answer(monkeypatch, Reply())

    assert youtube_upload.queue_upload('m1', 'dispatch-1', 'curiosity', str(yard), 'completed') == 'not-configured'
    assert youtube_upload.deliver_due(now=NOW) == []
    assert calls == [] and note_of(yard) is None


def test_offline_the_note_stays_and_the_video_goes_once_there_is_a_way_out(monkeypatch, yard):
    """The yard as it is normally set up: the satellite serves the wifi and
    has no route out. Then a hotspot, or the next boot, and it goes."""
    calls = answer(monkeypatch, requests.exceptions.ConnectionError('no route'), Reply())
    youtube_upload.queue_upload('m1', 'dispatch-1', 'curiosity', str(yard), 'completed')

    assert youtube_upload.deliver_due(now=NOW) == [(yard.name, 'retry', 'ConnectionError')]
    note = note_of(yard)
    assert note['attempts'] == 1 and note['nextTryAt'] == NOW + 60

    # Not due yet: no request at all.
    assert youtube_upload.deliver_due(now=NOW + 30) == []
    assert len(calls) == 1
    assert not youtube_upload.has_due(now=NOW + 30)

    # The note is on the card, not in memory, so a restart in between changes
    # nothing: the next pass that finds it due sends it.
    assert youtube_upload.has_due(now=NOW + 61)
    assert youtube_upload.deliver_due(now=NOW + 61) == [(yard.name, 'done', 'uploaded')]
    assert len(calls) == 2 and note_of(yard) is None


def test_it_waits_longer_each_time_and_never_more_than_half_an_hour():
    waits = [youtube_upload._backoff(n) for n in range(1, 9)]

    assert waits[:5] == [60, 120, 240, 480, 960]
    assert max(waits) == youtube_upload.MAX_RETRY_SECONDS == 1800


@pytest.mark.parametrize('status,verdict', [
    ('uploaded', 'done'),
    ('already-uploaded', 'done'),
    ('not-configured', 'give-up'),
    ('max-attempts', 'give-up'),
    ('in-progress', 'retry'),
])
def test_mission_controls_answer_decides_whether_to_ask_again(monkeypatch, yard, status, verdict):
    answer(monkeypatch, Reply(body={'status': status}))
    youtube_upload.queue_upload('m1', 'dispatch-1', 'curiosity', str(yard), 'completed')

    assert youtube_upload.deliver_due(now=NOW) == [(yard.name, verdict, status)]
    assert (note_of(yard) is not None) == (verdict == 'retry')
    assert yard.exists(), 'the recording stays on the card whatever happens'


@pytest.mark.parametrize('code,verdict', [(502, 'retry'), (503, 'retry'), (429, 'retry'), (401, 'give-up'), (400, 'give-up')])
def test_a_server_error_is_asked_again_and_a_refusal_is_not(monkeypatch, yard, code, verdict):
    """A 502 is YouTube failing, which the ledger counts and ends with
    max-attempts. A 401 is a credential the two ends do not share: sending the
    video again every half hour over a hotspot would not fix it."""
    answer(monkeypatch, Reply(status_code=code, body={}))
    youtube_upload.queue_upload('m1', 'dispatch-1', 'curiosity', str(yard), 'completed')

    assert youtube_upload.deliver_due(now=NOW) == [(yard.name, verdict, f'HTTP {code}')]
    assert (note_of(yard) is not None) == (verdict == 'retry')


def test_the_credential_never_reaches_the_log(monkeypatch, yard, capsys):
    monkeypatch.setenv('YOUTUBE_UPLOAD_INGEST_SECRET', 'do-not-log-this')
    answer(monkeypatch, requests.exceptions.ConnectionError('do-not-log-this'),
           Reply(status_code=401, body={}))
    youtube_upload.queue_upload('m1', 'dispatch-1', 'curiosity', str(yard), 'completed')

    youtube_upload.deliver_due(now=NOW)
    youtube_upload.deliver_due(now=NOW + 3600)

    assert 'do-not-log-this' not in capsys.readouterr().out
    assert 'do-not-log-this' not in json.dumps(note_of(yard) or {})


def test_a_recording_too_big_to_send_tells_mission_control_and_stays_for_manual_upload(monkeypatch, yard):
    with yard.open('wb') as video:
        video.truncate(youtube_upload.MAX_RECORDING_BYTES + 1)
    calls = answer(monkeypatch, Reply(body={'status': 'failed', 'retryable': False}))
    youtube_upload.queue_upload('m1', 'dispatch-1', 'curiosity', str(yard), 'completed')

    assert youtube_upload.deliver_due(now=NOW) == [(yard.name, 'give-up', 'too-large')]
    assert calls[0][1]['data']['failureCode'] == 'too-large'
    assert 'files' not in calls[0][1], 'the video itself is not sent'
    assert note_of(yard) is None and yard.exists()


def test_a_note_for_a_deleted_recording_is_dropped(monkeypatch, yard):
    calls = answer(monkeypatch, Reply())
    youtube_upload.queue_upload('m1', 'dispatch-1', 'curiosity', str(yard), 'completed')
    yard.unlink()

    assert youtube_upload.deliver_due(now=NOW) == [(yard.name, 'give-up', 'recording gone')]
    assert calls == [] and note_of(yard) is None


def test_a_note_a_power_cut_left_empty_is_dropped_not_sent_blind(monkeypatch, yard):
    """What a power cut after a pull did to every file it touched on
    17 October 2026: there, and empty."""
    calls = answer(monkeypatch, Reply())
    open(str(yard) + youtube_upload.NOTE_SUFFIX, 'w').close()

    assert youtube_upload.has_due(now=NOW)
    assert youtube_upload.deliver_due(now=NOW) == [(yard.name, 'give-up', 'unreadable note')]
    assert calls == []
    assert not os.path.exists(str(yard) + youtube_upload.NOTE_SUFFIX)


def test_a_note_is_never_left_half_written(monkeypatch, yard):
    """A crash part way through rewriting a note leaves the old one whole.
    Written in place, the file would already have been emptied."""
    answer(monkeypatch, requests.exceptions.ConnectionError())
    youtube_upload.queue_upload('m1', 'dispatch-1', 'curiosity', str(yard), 'completed')
    real_dump = youtube_upload.json.dump

    def power_cut(note, handle):
        handle.write('{"missionId": "m')
        raise OSError('power cut')

    monkeypatch.setattr(youtube_upload.json, 'dump', power_cut)
    with pytest.raises(OSError):
        youtube_upload.deliver_due(now=NOW)
    monkeypatch.setattr(youtube_upload.json, 'dump', real_dump)

    assert note_of(yard)['missionId'] == 'm1' and note_of(yard)['attempts'] == 0


def test_only_one_delivery_pass_runs_at_a_time(monkeypatch, yard):
    """Two passes at once would send the same note twice."""
    passes = []
    monkeypatch.setattr(youtube_upload, 'deliver_due', lambda now=None: passes.append(now))

    assert youtube_upload._delivering.acquire(blocking=False)
    try:
        assert REAL_KICK() is None, 'a pass is running, so this one does not start'
    finally:
        youtube_upload._delivering.release()

    REAL_KICK().join(timeout=2)
    assert passes == [None]
