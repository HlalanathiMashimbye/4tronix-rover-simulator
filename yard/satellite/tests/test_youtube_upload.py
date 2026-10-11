import os
import sys

import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import youtube_upload


def test_upload_delivery_uses_configured_origin_and_shared_secret(monkeypatch, tmp_path):
    recording = tmp_path / 'm1__curiosity__20261011T102030Z.mp4'
    recording.write_bytes(b'mp4 test data')
    monkeypatch.setenv('YOUTUBE_UPLOAD_INGEST_SECRET', 'local-test-secret')
    monkeypatch.setenv('MISSION_CONTROL_URL', 'https://mission.example/')
    calls = []

    class Reply:
        ok = True

        @staticmethod
        def json():
            return {'status': 'uploaded'}

    monkeypatch.setattr(youtube_upload.requests, 'post',
                        lambda *args, **kwargs: (calls.append((args, kwargs)) or Reply()))

    assert youtube_upload.upload_recording('m1', 'dispatch-1', 'curiosity', str(recording)) == 'uploaded'
    args, kwargs = calls[0]
    assert args[0] == 'https://mission.example/api/youtube-upload/recording'
    assert kwargs['headers'] == {'x-youtube-upload-secret': 'local-test-secret'}
    assert kwargs['data'] == {
        'missionId': 'm1',
        'runId': 'dispatch-1',
        'yardId': 'curiosity',
        'recordingName': recording.name,
    }


def test_missing_secret_disables_delivery_without_network(monkeypatch, tmp_path):
    recording = tmp_path / 'm1.mp4'
    recording.write_bytes(b'video')
    monkeypatch.delenv('YOUTUBE_UPLOAD_INGEST_SECRET', raising=False)
    calls = []
    monkeypatch.setattr(youtube_upload.requests, 'post', lambda *a, **k: calls.append((a, k)))

    assert youtube_upload.upload_recording('m1', 'dispatch-1', 'curiosity', str(recording)) == 'not-configured'
    assert calls == []


def test_delivery_retries_are_bounded_and_logs_do_not_include_secret(monkeypatch, tmp_path, capsys):
    recording = tmp_path / 'm1.mp4'
    recording.write_bytes(b'video')
    monkeypatch.setenv('YOUTUBE_UPLOAD_INGEST_SECRET', 'do-not-log-this')
    monkeypatch.setattr(youtube_upload.time, 'sleep', lambda _seconds: None)
    calls = []

    def unavailable(*_args, **_kwargs):
        calls.append(True)
        raise requests.exceptions.ConnectionError('do-not-log-this')

    monkeypatch.setattr(youtube_upload.requests, 'post', unavailable)
    assert youtube_upload.upload_recording('m1', 'dispatch-1', 'curiosity', str(recording)) == 'failed'
    assert len(calls) == youtube_upload.MAX_DELIVERY_ATTEMPTS
    assert 'do-not-log-this' not in capsys.readouterr().out


def test_oversize_recording_reports_a_manual_fallback_status(monkeypatch, tmp_path):
    recording = tmp_path / 'm1__curiosity__20261011T102030Z.mp4'
    with recording.open('wb') as video:
        video.truncate(youtube_upload.MAX_RECORDING_BYTES + 1)
    monkeypatch.setenv('YOUTUBE_UPLOAD_INGEST_SECRET', 'local-test-secret')
    calls = []

    class Reply:
        ok = True

    monkeypatch.setattr(youtube_upload.requests, 'post',
                        lambda *args, **kwargs: (calls.append((args, kwargs)) or Reply()))

    assert youtube_upload.upload_recording('m1', 'dispatch-1', 'curiosity', str(recording)) == 'too-large'
    assert calls[0][1]['data']['failureCode'] == 'too-large'
