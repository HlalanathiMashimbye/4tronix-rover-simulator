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

    def test_start_returns_the_file_the_run_is_writing(self, client, monkeypatch):
        """The name is the key; the file is what it actually wrote.

        Since every run gets its own timestamped file, the operator cannot work
        the filename out from the mission id any more, so the server says what
        it is rather than leaving them to match it by eye in step 2.
        """
        monkeypatch.setattr(recording_control, 'is_ready',
                            lambda timeout=None: (True, None))
        monkeypatch.setattr(
            recording_control, 'start_recording',
            lambda *a: (True, '/srv/recordings/m1__curiosity__20260903T091205Z.mp4'))

        body = client.post('/api/recording/start', json={'name': 'm1'}).get_json()

        assert body['name'] == 'm1', 'the stop key stays the mission id'
        assert body['file'] == 'm1__curiosity__20260903T091205Z.mp4'
        assert '/' not in body['file'], 'a basename, not a server path'

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

    def test_it_offers_a_picker_and_a_download_not_a_wall_of_links(self, client):
        """The operator has just recorded one thing and wants that one thing on
        their device, so this is a choice plus an action, not a file listing."""
        page = client.get('/run/').get_data(as_text=True)

        assert 'id="videoPick"' in page
        assert 'id="videoGet"' in page
        assert '/api/recordings/' in page

    def test_every_identifier_can_be_copied(self, client):
        """These buttons shipped with no handler at all: three controls that
        looked live and did nothing."""
        page = client.get('/run/').get_data(as_text=True)

        for field in ('missionName', 'missionId', 'runId'):
            assert f'data-copy="{field}"' in page, field
        assert 'querySelectorAll(\'[data-copy]\')' in page, 'the buttons need a handler'

    def test_the_station_can_start_the_camera_itself(self, client):
        """The station refuses to record until the camera is primed, so it has
        to offer a way to prime it. Priming used to need a Firebase login,
        which needs internet, on the page that exists for when there is none."""
        page = client.get('/run/').get_data(as_text=True)

        assert 'id="camStart"' in page
        assert '/operator/api/camera/start' in page

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


class TestCameraReadiness:
    """"Primed" on an operator's screen has to mean frames are arriving.

    /api/status answers only that the port is open, because it is polled every
    five seconds by every open page. This is the expensive question, asked on
    demand, and it is the one that decides whether a recording will contain
    anything.
    """

    def test_it_reports_frames_arriving(self, client, monkeypatch):
        """Patches two seams now, and that is the point: readiness goes through
        camera_state, which does not probe a port nothing is listening on."""
        import camera_state
        monkeypatch.setattr(camera_state, '_listening', lambda host, port: True)
        monkeypatch.setattr(recording_control, 'is_ready', lambda timeout=None: (True, None))

        body = client.get('/api/camera/ready').get_json()

        assert body['ready'] is True

    def test_it_reports_why_when_they_are_not(self, client, monkeypatch):
        import camera_state
        monkeypatch.setattr(camera_state, '_listening', lambda host, port: True)
        monkeypatch.setattr(recording_control, 'is_ready',
                            lambda timeout=None: (False, 'no frame received'))

        body = client.get('/api/camera/ready').get_json()

        assert body['ready'] is False
        assert body['detail'] == 'no frame received'

    def test_a_dead_port_is_not_probed_for_frames(self, client, monkeypatch):
        """The probe's timeout is the slowest thing on the page. Asking a port
        nothing is listening on to produce a frame can only ever wait."""
        import camera_state
        monkeypatch.setattr(camera_state, '_listening', lambda host, port: False)
        probed = []
        monkeypatch.setattr(recording_control, 'is_ready',
                            lambda timeout=None: probed.append(1) or (True, None))

        body = client.get('/api/camera/ready').get_json()

        assert body['ready'] is False
        assert probed == [], 'must not probe a port that is not listening'

    def test_it_needs_no_login(self, client, monkeypatch):
        """Same reason as everything else on this page: a check that only works
        when the wifi is up is useless on the box built for when it is not."""
        monkeypatch.setattr(recording_control, 'is_ready', lambda timeout=None: (True, None))

        assert client.get('/api/camera/ready').status_code == 200


class TestSendRecordsFirst:
    """Recording is something the station does, not a button to remember.

    The page used to say "Start recording first, so the rover's first move is
    in the video". That works right up until the run someone is excited about,
    which is the one they forget, and a rover run with no video cannot be
    reviewed, handed over or uploaded. It is simply lost.
    """

    def test_send_starts_the_recording_before_it_dispatches(self, client):
        """Pins the guard, not just the ordering.

        The first version of this checked only that startRecording() appeared
        earlier in the source than the dispatch, which stays true if the branch
        around it is disabled - it passed against a deliberately broken build.
        """
        page = client.get('/run/').get_data(as_text=True)
        handler = page[page.index("$('runBtn').addEventListener"):]
        dispatch = handler.index('/api/queue/add')
        before_dispatch = handler[:dispatch]

        assert 'if (!recordingName) {' in before_dispatch, 'the guard has to be live'
        assert 'await startRecording();' in before_dispatch
        assert before_dispatch.index('if (!recordingName) {') \
            < before_dispatch.index('await startRecording();')

    def test_it_waits_before_moving_the_rover(self, client):
        """The writer opens on the first real frame, so a dispatch in the same
        tick puts the first move on the frame before the video starts."""
        page = client.get('/run/').get_data(as_text=True)

        assert 'LEAD_IN_MS = 1000' in page
        assert 'setTimeout(r, LEAD_IN_MS)' in page

    def test_a_failed_recording_stops_the_send(self, client):
        """Dispatching anyway would produce the unrecorded run this exists to
        prevent, and moving the rover is not undoable."""
        page = client.get('/run/').get_data(as_text=True)
        handler = page[page.index("$('runBtn').addEventListener"):]
        body = handler[:handler.index('/api/queue/add')]

        # startRecording throws on a non-ok response, and the dispatch sits
        # after it inside the same try, so the throw skips it. Both halves of
        # that have to hold: the call is awaited (a floating promise would let
        # the dispatch through) and it is guarded by the live condition.
        assert 'await startRecording();' in body
        assert 'if (!recordingName) {' in body

    def test_stopping_the_rover_stops_the_recording(self, client):
        """Send starts it, so Stop ends it. Otherwise the operator who would
        have forgotten to press record is left recording for ever."""
        page = client.get('/run/').get_data(as_text=True)
        handler = page[page.index("$('stopBtn').addEventListener"):]

        assert 'stopRecording()' in handler[:600]

    def test_the_dispatch_carries_the_mission_id(self, client):
        """This is what makes the camera stop on its own.

        The rover echoes params.mission_id back on the instruction in its
        history, and mission_watcher reads that history to learn a run is over.
        Send without it and the rover finishes, the watcher sees an entry it
        cannot identify, and the recording runs until somebody presses stop.
        """
        page = client.get('/run/').get_data(as_text=True)
        handler = page[page.index("$('runBtn').addEventListener"):]
        before_dispatch = handler[:handler.index('/api/queue/add')]

        assert 'params.mission_id = missionRef' in before_dispatch
        assert 'JSON.stringify([{ cmd: \'run_python\', params }])' in handler

    def test_the_page_no_longer_asks_anyone_to_press_record(self, client):
        page = client.get('/run/').get_data(as_text=True)

        assert 'Start recording first' not in page


class TestReadinessIndicators:
    """One instrument module, not two warning banners.

    They were wide boxes flooded with a red or green tint. At the size they
    needed, the fill was the loudest thing on a page whose subject is a
    mission, and two tinted slabs side by side read as a pair of alerts even
    when both said everything was fine.
    """

    def test_the_surface_is_not_tinted_by_state(self, client):
        page = client.get('/run/').get_data(as_text=True)

        assert '.ready[data-state="ok"]   { border-left-color' not in page
        assert 'background: var(--ok-weak); }' not in page

    def test_colour_lives_in_the_lamp_and_the_state_word(self, client):
        page = client.get('/run/').get_data(as_text=True)

        assert '.ready[data-state="ok"]   .status-sub { color: var(--ok); }' in page
        assert '.status-dot.ok' in page

    def test_the_two_rows_are_one_module(self, client):
        """A shared border with a hairline between, rather than two cards."""
        page = client.get('/run/').get_data(as_text=True)

        assert '.ready + .ready { border-top:' in page
