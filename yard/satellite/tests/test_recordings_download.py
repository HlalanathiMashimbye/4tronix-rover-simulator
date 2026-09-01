"""
Getting a recording off the satellite, which is step five of the manual loop.

The operator runs a mission by pasting code into /code/, takes the video to
their own device, uploads it to YouTube and pastes the link into Mission
Control. Recordings were written to disk and then unreachable: there was no
route serving them, so that step could not be done at all.
"""

import os

import pytest

import recording_control
import web_server


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(recording_control, 'RECORDINGS_DIR', str(tmp_path / 'recordings'))
    os.makedirs(tmp_path / 'recordings', exist_ok=True)
    web_server.app.config['TESTING'] = True
    return web_server.app.test_client()


def _write(tmp_path, name, data=b'\x00\x00\x00\x18ftypmp42'):
    path = tmp_path / 'recordings' / name
    path.write_bytes(data)
    return path


class TestListing:
    def test_no_recordings_is_an_empty_list_not_an_error(self, client, tmp_path, monkeypatch):
        monkeypatch.setattr(recording_control, 'RECORDINGS_DIR', str(tmp_path / 'never-made'))

        resp = client.get('/api/recordings')

        assert resp.status_code == 200
        assert resp.get_json()['recordings'] == []

    def test_lists_recordings_with_their_size(self, client, tmp_path):
        _write(tmp_path, 'm1__curiosity.mp4', b'x' * 1234)

        body = client.get('/api/recordings').get_json()['recordings']

        assert [r['name'] for r in body] == ['m1__curiosity.mp4']
        assert body[0]['bytes'] == 1234

    def test_ignores_anything_that_is_not_a_recording(self, client, tmp_path):
        _write(tmp_path, 'notes.txt', b'hello')
        _write(tmp_path, 'run.mp4')

        names = [r['name'] for r in client.get('/api/recordings').get_json()['recordings']]

        assert names == ['run.mp4']


class TestDownload:
    def test_downloads_as_an_attachment(self, client, tmp_path):
        _write(tmp_path, 'run.mp4', b'video-bytes')

        resp = client.get('/api/recordings/run.mp4')

        assert resp.status_code == 200
        assert resp.data == b'video-bytes'
        # An attachment, so a tablet saves it rather than trying to play it in
        # a tab the operator then has to work out how to get a file out of.
        assert 'attachment' in resp.headers['Content-Disposition']

    def test_missing_recording_is_a_404(self, client):
        assert client.get('/api/recordings/nope.mp4').status_code == 404

    @pytest.mark.parametrize('attack', [
        '../../../etc/passwd',
        '..%2f..%2fetc%2fpasswd',
        'subdir/../../../../etc/hosts',
    ])
    def test_refuses_to_walk_out_of_the_recordings_directory(self, client, attack):
        """The name comes straight off a URL on a network the satellite does
        not control, so it is resolved and checked, not merely sanitised."""
        resp = client.get(f'/api/recordings/{attack}')

        assert resp.status_code == 404
        assert b'passwd' not in resp.data and b'hosts' not in resp.data

    def test_refuses_a_file_that_is_not_a_recording(self, client, tmp_path):
        _write(tmp_path, 'secrets.env', b'OPERATOR_SESSION_SECRET=hunter2')

        resp = client.get('/api/recordings/secrets.env')

        assert resp.status_code == 404
        assert b'hunter2' not in resp.data


class TestRecordingACopyPasteRun:
    """Pasting code into /code/ used to record nothing, so there was no video
    to take away. Dispatching from the queue always did."""

    def test_name_is_reduced_to_something_safe_for_a_path(self):
        assert web_server._recording_name("Thabo's square!") == 'Thabo-s-square'
        assert web_server._recording_name('../../etc/passwd') == 'etc-passwd'
        assert web_server._recording_name('   ') == ''

    def test_start_refuses_without_a_name(self, client):
        assert client.post('/api/recording/start', json={}).status_code == 400

    def test_stop_refuses_without_a_name(self, client):
        assert client.post('/api/recording/stop', json={}).status_code == 400

    def test_start_refuses_when_the_camera_is_not_producing_frames(
            self, client, monkeypatch):
        """The gate console/missions.py puts in front of a queued dispatch.
        Without it the manual loop is the one path that reports 'recording'
        with nothing arriving, and the operator finds out at the end of the
        night when there is no file to hand over."""
        monkeypatch.setattr(recording_control, 'is_ready',
                            lambda timeout=None: (False, 'no frame received'))
        started = []
        monkeypatch.setattr(recording_control, 'start_recording',
                            lambda *a: started.append(a) or (True, 'x'))

        resp = client.post('/api/recording/start', json={'name': 'm1'})

        assert resp.status_code == 503
        assert 'no frame received' in resp.get_json()['error']
        assert started == [], 'refused, so nothing should have been started'

    def test_start_records_once_frames_are_flowing(self, client, monkeypatch):
        monkeypatch.setattr(recording_control, 'is_ready',
                            lambda timeout=None: (True, None))

        resp = client.post('/api/recording/start', json={'name': 'm1'})

        assert resp.status_code == 200
        assert resp.get_json()['name'] == 'm1'


class TestRunStation:
    """The operator's station for one mission: import, record, download, and
    the YouTube description that makes the upload link itself back."""

    def test_run_station_serves_without_a_session(self, client):
        resp = client.get('/run/')

        assert resp.status_code == 200

    def test_it_carries_the_pieces_of_the_manual_loop(self, client):
        page = client.get('/run/').get_data(as_text=True)

        for piece in ('importBtn', 'missionId', 'recBtn', 'recordings', 'ytDesc'):
            assert piece in page, piece

    def test_it_does_not_offer_to_complete_the_mission(self, client):
        """Closing a mission is Mission Control's job. Two places to do it is
        how one ends up completed in one and still running in the other."""
        page = client.get('/run/').get_data(as_text=True).lower()

        assert 'mark complete' not in page
        assert '/complete' not in page

    def test_the_description_template_carries_the_linking_line(self, client):
        """`MissionID: <id>` is matched literally by the auto-linker, so the
        page must build that exact shape rather than something near it."""
        page = client.get('/run/').get_data(as_text=True)

        assert 'MissionID: ${id}' in page

    def test_the_description_names_the_yard_that_ran_it(self, client, monkeypatch):
        """Given only a mission id the linker falls back to guessing which
        run the video belongs to - the most recent completed one without a
        video. That is right until two yards run the same mission on one
        evening, and then it swaps their footage. Naming the yard is what
        removes the guess, so the page has to actually emit the line."""
        import satellite_identity
        monkeypatch.setattr(satellite_identity, 'yard_id', lambda: 'curiosity')

        page = client.get('/run/').get_data(as_text=True)

        assert '"curiosity"' in page
        assert 'Yard: ${YARD_ID}' in page
