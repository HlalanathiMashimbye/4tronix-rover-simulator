"""
Operator console tests - auth gate, login flow, and mission actions.

Firestore and the rover queue are faked; firebase-admin is never imported.
What's under test: session gating, role enforcement, the send-to-rover
dispatch, and the status transitions written back to Firestore.
"""

import sys
import os
import re
import threading
import time

import pytest
from flask import current_app

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from web_server import app as flask_app  # noqa: E402
import requests

import operator_console
from console import camera, deps, mirror, notify  # noqa: E402
import mission_store
import store.db as store_db  # noqa: E402
import recording_control  # noqa: E402

# The yard the seeded missions belong to, and the one the satellite defaults
# to. Runs are keyed by it, so tests that assert on a run need it by name.
YARD = 'curiosity'


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

# The Firestore doubles live in tests/firestore_fakes.py, shared with
# test_sync_worker.py. This file used to carry its own copy of the same
# classes; see that module and ports.py for why there is now one set.
from tests.firestore_fakes import FakeCollection, FakeFirestore  # noqa: E402

# This suite's query doubles were a narrower version of the shared ones
# (equality filters only, order_by and limit ignored). The shared FakeQuery
# does all of it for real, so these are aliases now.
FakeQueryCollection = FakeCollection
FakeQueryFirestore = FakeFirestore



class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class RecordingTimer:
    """threading.Timer stand-in for handler tests.

    Records instead of scheduling, so lease-renewal timers neither fire during
    a test nor leak into the next one. Needed because the `client` fixture
    swaps threading.Thread for SyncThread, and the real threading.Timer calls
    Thread.__init__ internally - so a real Timer blows up once Thread is faked.
    """

    instances = []

    def __init__(self, interval, function, args=None, kwargs=None):
        self.interval = interval
        self.function = function
        self.args = args or ()
        self.started = False
        self.cancelled = False
        RecordingTimer.instances.append(self)

    def start(self):
        self.started = True

    def cancel(self):
        self.cancelled = True

    @classmethod
    def reset(cls):
        cls.instances = []


class SyncThread:
    """threading.Thread stand-in that runs its target immediately and
    synchronously in start(), so tests asserting on side effects of
    _notify_mission_control_async don't race a real background thread.
    """

    def __init__(self, target=None, args=(), kwargs=None, daemon=None):
        self._target = target
        self._args = args
        self._kwargs = kwargs or {}

    def start(self):
        self._target(*self._args, **self._kwargs)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# --- Mirror-backed mission fixture ----------------------------------------
#
# PR 3 moved the request path off Firestore and onto the SQLite mirror, so the
# tests seed and assert against a real (temporary) mirror instead of a fake
# Firestore dict. This view keeps the original `missions['q1']['status']` and
# `missions['q1'].update({...})` API so the existing assertions still read
# naturally - it just writes through to SQLite underneath.

_MIRROR_FIELDS = {
    'name': 'name', 'yardId': 'yard_id', 'code': 'code',
    'blocklyState': 'blockly_state', 'status': 'status',
    'submittedAt': 'submitted_at', 'startedAt': 'started_at',
    'completedAt': 'completed_at', 'youtubeUrl': 'youtube_url',
    'needsReview': 'needs_review',
    'reviewReason': 'review_reason', 'statusUpdatedAt': 'status_updated_at',
}
_TO_CAMEL = {v: k for k, v in _MIRROR_FIELDS.items()}


class _MissionRow(dict):
    """A mission as camelCase, whose .update() writes back to the mirror."""

    def __init__(self, mission_id, row):
        super().__init__({_TO_CAMEL.get(k, k): v for k, v in row.items()})
        self._id = mission_id

    def update(self, fields):  # noqa: A003 - deliberately shadows dict.update
        import mission_store
        cols = {_MIRROR_FIELDS.get(k, k): v for k, v in fields.items()}
        with mission_store._db_lock:
            conn = mission_store._connect()
            sets = ', '.join(f'{c} = ?' for c in cols)
            conn.execute(
                f'UPDATE mission_mirror SET {sets} WHERE id = ?',
                list(cols.values()) + [self._id],
            )
            conn.commit()
            conn.close()
        super().update(fields)


class MirrorView:
    def __init__(self, seed):
        self._seed = seed

    def __getitem__(self, mission_id):
        import mission_store
        row = mission_store.get_mission(mission_id)
        if row is None:
            raise KeyError(mission_id)
        return _MissionRow(mission_id, row)

    def __contains__(self, mission_id):
        import mission_store
        return mission_store.get_mission(mission_id) is not None

    def keys(self):
        return self._seed.keys()


@pytest.fixture
def missions(tmp_path, monkeypatch):
    import mission_store
    import satellite_identity

    monkeypatch.setattr(store_db, 'DB_PATH', str(tmp_path / 'mirror.db'))
    monkeypatch.setattr(satellite_identity, 'CONFIG_FILE', str(tmp_path / 'sat.json'))
    satellite_identity.reset_cache()
    mission_store.init_db()

    seed = _seed_missions()
    mission_store.upsert_missions(
        [dict(m, id=mid) for mid, m in seed.items()],
        '2026-07-14T09:00:00Z',
    )
    # Give every seeded mission the run its status implies. Routes read the
    # run now, and a 'processing' mission with no processing run is a state
    # that cannot occur in production - the backfill is what creates them.
    mission_store.backfill_missions_to_runs()
    yield MirrorView(seed)
    satellite_identity.reset_cache()


def _seed_missions():
    return {
        'q1': {
            'name': 'Sand Observer',
            'yardId': 'curiosity',
            'code': 'rover.forward(60)\nrover.stop()',
            'blocklyState': '{"blocks":{}}',
            'status': 'queued',
            'submittedAt': '2026-07-14T08:00:00Z',
        },
        'q2': {
            'name': 'Dune Walker',
            'yardId': 'curiosity',
            'code': 'rover.forward(10)\nrover.stop()',
            'status': 'queued',
            'submittedAt': '2026-07-14T08:30:00Z',
        },
        'p1': {
            'name': 'Storm Collector',
            'yardId': 'curiosity',
            'code': 'rover.forward(30)',
            'status': 'processing',
            'submittedAt': '2026-07-14T07:00:00Z',
        },
        'c1': {
            'name': 'Crater Pioneer',
            'yardId': 'curiosity',
            'code': 'rover.stop()',
            'status': 'completed',
            'submittedAt': '2026-07-14T06:00:00Z',
        },
    }


@pytest.fixture
def client(missions, monkeypatch, tmp_path):
    # web_server.py now calls load_dotenv() on import, so a developer's real
    # local .env (OPERATOR_AUTH=off while testing at an event, a real
    # YOUTUBE_API_KEY, etc.) would otherwise leak into every test run. Start
    # every test from a clean slate; tests that care about a specific value
    # set it themselves via monkeypatch.
    for var in ('OPERATOR_AUTH', 'YOUTUBE_API_KEY', 'YOUTUBE_CHANNEL_ID'):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(deps, 'firestore_client', lambda: FakeFirestore(missions))
    monkeypatch.setattr(deps, 'admin_configured', lambda: True)
    # The mirror is owned by the `missions` fixture, which seeds it. Do not
    # re-point DB_PATH here: it runs after that fixture and would leave every
    # handler reading an empty database.
    # Default to a no-op so tests that don't care about the mission-control
    # notification never make a real network call. Tests that do care
    # re-monkeypatch this within the test body.
    monkeypatch.setattr(notify, 'notify_mission_control', lambda *a, **k: None)
    # _notify_mission_control_async normally runs on a real background
    # thread; run it inline instead so assertions right after client.post()
    # aren't racing it.
    monkeypatch.setattr(threading, 'Thread', SyncThread)
    # Nothing schedules a Timer any more (the lease renewal went with AB#364),
    # but the fake stays: it turns any timer a future change introduces into a
    # recorded call rather than a real one firing mid-suite.
    RecordingTimer.reset()
    monkeypatch.setattr(threading, 'Timer', RecordingTimer)
    # Default every test to "camera ready, recording starts/stops cleanly" -
    # recording_control would otherwise try a real websocket connection to
    # localhost:8890 on every /send or /rerun call, which is slow and always
    # fails in CI. Tests that care about the readiness check or the recording
    # lifecycle itself re-monkeypatch these within the test body.
    monkeypatch.setattr(recording_control, 'is_ready', lambda timeout=None: (True, None))
    monkeypatch.setattr(recording_control, 'start_recording',
                         lambda mission_id, yard: (True, f'/tmp/{mission_id}__{yard}.mp4'))
    monkeypatch.setattr(recording_control, 'stop_recording', lambda mission_id, yard, keep: (True, 'ok'))
    flask_app.config['TESTING'] = True
    with flask_app.test_client() as c:
        yield c


def sign_in(client):
    """Mint the session the login route mints, timestamps included.

    signed_in_at bounds the session and checked_at paces the Firebase
    re-check; a session without them is treated as expired, which is the
    correct fate for one minted before those existed.
    """
    now = time.time()
    with client.session_transaction() as sess:
        sess['operator'] = {
            'uid': 'op-1',
            'email': 'op@test.com',
            'role': 'operator',
            'signed_in_at': now,
            # Recent, so tests do not reach for Firebase on every request.
            'checked_at': now,
        }


# ---------------------------------------------------------------------------
# Auth gating
# ---------------------------------------------------------------------------

def test_root_opens_the_station_hub_without_a_session(client):
    """The yard used to open on the Firestore queue, behind a sign-in.

    That put reaching Firebase between an operator and the one thing a yard
    has to do, on a box whose point is working when the venue wifi does not.
    The hub needs neither.
    """
    resp = client.get('/')
    page = resp.get_data(as_text=True)

    assert resp.status_code == 200
    for station in ('/code/', '/monitor/', '/settings'):
        assert station in page


def test_root_does_not_send_anyone_to_a_login(client):
    assert '/operator/login' not in client.get('/').headers.get('Location', '')


def test_code_and_monitor_stay_public(client):
    # Learner tablets and the TV never sign in; their pages must not gate.
    assert client.get('/code/').status_code == 200
    assert client.get('/monitor/').status_code == 200


def test_operator_root_redirects_to_the_queue(client):
    """/operator/ was the queue; the home page is. The URL stays alive because
    it is bookmarked on the yard's tablets."""
    resp = client.get('/operator/')
    assert resp.status_code == 302
    assert resp.headers['Location'].endswith('/')




def test_mission_page_redirects_to_login_without_session(client):
    resp = client.get('/operator/mission/p1')
    assert resp.status_code == 302
    assert '/operator/login' in resp.headers['Location']


# --- OPERATOR_AUTH=off (event-day offline mode, no internet for sign-in) ---

def test_auth_off_opens_console_and_hub_without_session(client, monkeypatch):
    monkeypatch.setenv('OPERATOR_AUTH', 'off')
    assert client.get('/code/').status_code == 200
    assert client.get('/operator/mission/p1').status_code == 200
    login = client.get('/operator/login')
    assert login.status_code == 302  # login page steps aside


# --- Stop: the control an operator uses with a rover already moving --------

def test_stop_cancels_the_mission_and_discards_its_recording(client, missions, monkeypatch):
    """BACKLOG 338. STOP now writes 'cancelled', not 'queued' (see
    api_stop_mission's docstring for why 'cancelled' rather than 'failed'),
    and discards the recording in the same request - an operator stopping the
    rover in real time has already made the call, no review step needed."""
    sign_in(client)
    calls = []
    discard_calls = []

    def fake_post(url, **kwargs):
        calls.append(url)
        return FakeResponse(200, {'status': 'success'})

    monkeypatch.setattr(requests, 'post', fake_post)
    monkeypatch.setattr(
        recording_control, 'stop_recording',
        lambda mission_id, yard, keep: (discard_calls.append((mission_id, yard, keep)), (True, 'ok'))[1],
    )
    resp = client.post('/operator/api/missions/p1/stop')

    assert resp.status_code == 200
    data = resp.get_json()
    assert data['newStatus'] == 'cancelled'
    assert data['recordingDiscarded'] is True
    assert any(url.endswith('/queue/clear') for url in calls), calls
    assert missions['p1']['status'] == 'cancelled'
    assert discard_calls == [('p1', YARD, False)]


def test_stop_still_clears_the_rover_when_this_mission_is_not_running(client, missions, monkeypatch):
    """The button is on screen at all times. Refusing to stop a rover because
    the mission being viewed is not the one running would be indefensible."""
    sign_in(client)
    calls = []
    monkeypatch.setattr(
        requests, 'post',
        lambda url, **k: (calls.append(url), FakeResponse(200, {'status': 'success'}))[1],
    )

    resp = client.post('/operator/api/missions/c1/stop')

    assert resp.status_code == 200
    assert any(url.endswith('/queue/clear') for url in calls), calls
    assert missions['c1']['status'] == 'completed'  # untouched


def test_stop_reports_an_unreachable_rover_rather_than_claiming_success(client, missions, monkeypatch):
    sign_in(client)
    def boom(*a, **k):
        raise requests.exceptions.ConnectionError()

    monkeypatch.setattr(requests, 'post', boom)
    resp = client.post('/operator/api/missions/p1/stop')

    assert resp.status_code == 503
    # Still 'processing': claiming it stopped would be a lie about a machine
    # that may well still be driving.
    assert missions['p1']['status'] == 'processing'
    assert 'power switch' in resp.get_json()['error']


def test_stop_survives_a_deliberate_demotion_through_the_sync_merge():
    """A stop moves 'processing' back to 'queued'. The merge ladder ranks
    queued below processing, so without the operator-decision marker the write
    is silently dropped and the mission reverts on the next reconcile."""
    from sync_worker import should_local_win, FORCE_KEY

    assert not should_local_win({'status': 'queued'}, {'status': 'processing'})
    assert should_local_win({'status': 'queued', FORCE_KEY: True}, {'status': 'processing'})
    # The ladder still governs everything that happens on its own.
    assert should_local_win({'status': 'completed'}, {'status': 'queued'})
    assert not should_local_win({'status': 'queued'}, {'status': 'completed'})


def test_the_force_marker_never_reaches_firestore(client, missions, monkeypatch):
    """It is instruction to the merge, not part of the mission document."""
    sign_in(client)
    import json as _json
    from mission_store import peek_outbox
    from sync_worker import FORCE_KEY

    monkeypatch.setattr(
        requests, 'post',
        lambda *a, **k: FakeResponse(200, {'status': 'success'}),
    )
    client.post('/operator/api/missions/p1/stop')

    entry = peek_outbox()
    payload = _json.loads(entry['payload'])
    assert payload.get(FORCE_KEY) is True

    written = {k: v for k, v in payload.items() if k != FORCE_KEY}
    assert FORCE_KEY not in written
    assert written['status'] == 'cancelled'


# --- Sync rate, exposed on the Settings page -------------------------------

def test_sync_config_rejects_a_rate_that_would_burn_the_quota(client, monkeypatch):
    monkeypatch.setenv('OPERATOR_AUTH', 'off')
    resp = client.post('/operator/api/config/sync', json={'interval': 1})
    assert resp.status_code == 400
    assert 'between' in resp.get_json()['error']


def test_sync_config_round_trips(client, monkeypatch):
    monkeypatch.setenv('OPERATOR_AUTH', 'off')
    saved = client.post('/operator/api/config/sync', json={'interval': 90, 'reconcileEvery': 15})
    assert saved.status_code == 200

    current = client.get('/operator/api/config/sync').get_json()
    assert current['interval'] == 90
    assert current['reconcileEvery'] == 15
    # A slower sync must estimate fewer reads, or the number on the page is
    # not telling an operator anything useful.
    faster = client.post('/operator/api/config/sync', json={'interval': 30, 'reconcileEvery': 10}).get_json()
    assert faster['estimatedDailyReads'] > saved.get_json()['estimatedDailyReads']


def test_auth_off_opens_apis_without_session(client, missions, monkeypatch):
    monkeypatch.setenv('OPERATOR_AUTH', 'off')
    resp = client.post('/operator/api/missions/p1/complete')
    assert resp.status_code == 200
    assert missions['p1']['status'] == 'completed'


def test_auth_on_by_default_when_variable_unset(client, monkeypatch):
    monkeypatch.delenv('OPERATOR_AUTH', raising=False)
    assert client.get('/operator/api/missions').status_code == 401


def test_apis_reject_unauthenticated_requests(client):
    assert client.get('/operator/api/missions').status_code == 401
    assert client.post('/operator/api/missions/q1/send').status_code == 401
    assert client.post('/operator/api/missions/q1/complete').status_code == 401
    assert client.get('/operator/api/health').status_code == 401


def test_login_rejects_wrong_password(client, monkeypatch):
    monkeypatch.setattr(deps, 'web_api_key', lambda: 'test-key')
    monkeypatch.setattr(
        requests, 'post',
        lambda *a, **k: FakeResponse(400, {'error': {'message': 'INVALID_PASSWORD'}}),
    )
    resp = client.post('/operator/api/login', json={'email': 'x@y.z', 'password': 'nope'})
    assert resp.status_code == 401


def test_login_rejects_accounts_without_operator_role(client, monkeypatch):
    monkeypatch.setattr(deps, 'web_api_key', lambda: 'test-key')
    monkeypatch.setattr(
        requests, 'post',
        lambda *a, **k: FakeResponse(200, {'idToken': 'tok'}),
    )
    monkeypatch.setattr(
        deps, 'verify_id_token',
        lambda tok: {'user_id': 'u1', 'email': 'learner@test.com', 'role': 'learner'},
    )
    resp = client.post('/operator/api/login', json={'email': 'learner@test.com', 'password': 'pw'})
    assert resp.status_code == 403


def test_login_reports_verify_failures_with_actionable_message(client, monkeypatch):
    monkeypatch.setattr(deps, 'web_api_key', lambda: 'test-key')
    monkeypatch.setattr(
        requests, 'post',
        lambda *a, **k: FakeResponse(200, {'idToken': 'tok'}),
    )
    monkeypatch.setattr(
        deps, 'verify_id_token',
        lambda tok: (_ for _ in ()).throw(RuntimeError('token verification failed')),
    )

    resp = client.post('/operator/api/login', json={'email': 'op@test.com', 'password': 'pw'})
    assert resp.status_code == 401
    assert 'same Firebase project' in resp.get_json()['error']


def test_login_accepts_operator_and_sets_session(client, monkeypatch):
    monkeypatch.setattr(deps, 'web_api_key', lambda: 'test-key')
    monkeypatch.setattr(
        requests, 'post',
        lambda *a, **k: FakeResponse(200, {'idToken': 'tok'}),
    )
    monkeypatch.setattr(
        deps, 'verify_id_token',
        lambda tok: {'user_id': 'u1', 'email': 'op@test.com', 'role': 'operator'},
    )
    resp = client.post('/operator/api/login', json={'email': 'op@test.com', 'password': 'pw'})
    assert resp.status_code == 200
    assert client.get('/code/').status_code == 200


def test_login_reports_missing_configuration(client, monkeypatch):
    monkeypatch.setattr(deps, 'web_api_key', lambda: None)
    resp = client.post('/operator/api/login', json={'email': 'x@y.z', 'password': 'pw'})
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# Send to rover
# ---------------------------------------------------------------------------

def test_send_pushes_run_python_and_marks_processing(client, missions, monkeypatch):
    sign_in(client)
    calls = []

    def fake_post(url, json=None, timeout=None):
        calls.append((url, json))
        return FakeResponse(200, {'status': 'ok', 'added': 1})

    monkeypatch.setattr(requests, 'post', fake_post)

    resp = client.post('/operator/api/missions/q1/send')
    assert resp.status_code == 200

    url, payload = calls[0]
    assert url.endswith('/queue/add')
    # mission_id rides along so the rover can report which mission it is running.
    assert payload == [{
        'cmd': 'run_python',
        'params': {
            'code': 'rover.forward(60)\nrover.stop()',
            'blockly_state': '{"blocks":{}}',
            'mission_id': 'q1',
        },
    }]

    assert missions['q1']['status'] == 'processing'
    assert re.match(r'\d{4}-\d{2}-\d{2}T', missions['q1']['startedAt'])


def test_send_rejects_missions_that_are_not_queued(client, missions, monkeypatch):
    """Send starts queued work. Nothing else, and the two refusals differ.

    A mission already running here is a conflict (409) - someone beat you to
    it. A finished one is simply not sendable (400); restarting it is what
    rerun is for.
    """
    sign_in(client)
    monkeypatch.setattr(
        requests, 'post',
        lambda *a, **k: pytest.fail('rover must not be called'),
    )
    assert client.post('/operator/api/missions/p1/send').status_code == 409
    assert client.post('/operator/api/missions/c1/send').status_code == 400


# --- Camera readiness + recording start (BACKLOG 334/335) -------------------

def test_send_refuses_dispatch_when_camera_is_not_ready(client, missions, monkeypatch):
    sign_in(client)
    monkeypatch.setattr(recording_control, 'is_ready', lambda timeout=None: (False, 'no frame received'))
    monkeypatch.setattr(
        requests, 'post',
        lambda *a, **k: pytest.fail('rover must not be called when the camera is not ready'),
    )

    resp = client.post('/operator/api/missions/q1/send')

    assert resp.status_code == 503
    assert 'not ready' in resp.get_json()['error']
    assert missions['q1']['status'] == 'queued'


def test_send_starts_recording_after_a_successful_dispatch(client, missions, monkeypatch):
    sign_in(client)
    monkeypatch.setattr(requests, 'post', lambda *a, **k: FakeResponse(200, {}))
    started = []
    monkeypatch.setattr(
        recording_control, 'start_recording',
        lambda mission_id, yard: (started.append((mission_id, yard)), (True, f'/tmp/{mission_id}__{yard}.mp4'))[1],
    )

    resp = client.post('/operator/api/missions/q1/send')

    assert resp.status_code == 200
    assert resp.get_json()['recordingStarted'] is True
    assert started == [('q1', YARD)]
    run = mission_store.get_run('q1', YARD)
    assert run['recording_status'] == 'recording'
    assert run['recording_path'] == f'/tmp/q1__{YARD}.mp4'


def test_send_does_not_fail_the_request_when_recording_fails_to_start(client, missions, monkeypatch):
    """The rover is already moving by the time recording starts - a camera
    hiccup here is a warning to log, not a reason to fail the response."""
    sign_in(client)
    monkeypatch.setattr(requests, 'post', lambda *a, **k: FakeResponse(200, {}))
    monkeypatch.setattr(recording_control, 'start_recording', lambda mission_id, yard: (False, 'camera dropped'))

    resp = client.post('/operator/api/missions/q1/send')

    assert resp.status_code == 200
    assert resp.get_json()['recordingStarted'] is False
    assert missions['q1']['status'] == 'processing'


def test_send_reports_rover_offline_and_keeps_mission_queued(client, missions, monkeypatch):
    sign_in(client)

    def fake_post(*a, **k):
        raise requests.exceptions.ConnectionError()

    monkeypatch.setattr(requests, 'post', fake_post)

    resp = client.post('/operator/api/missions/q1/send')
    assert resp.status_code == 503
    assert missions['q1']['status'] == 'queued'


def test_send_404s_for_unknown_mission(client):
    sign_in(client)
    assert client.post('/operator/api/missions/nope/send').status_code == 404


def test_send_notifies_mission_control_after_marking_processing(client, missions, monkeypatch):
    sign_in(client)
    monkeypatch.setattr(requests, 'post', lambda *a, **k: FakeResponse(200, {}))

    calls = []
    monkeypatch.setattr(
        notify, 'notify_mission_control',
        lambda mission_id, status: calls.append((mission_id, status)),
    )

    resp = client.post('/operator/api/missions/q1/send')
    assert resp.status_code == 200
    assert calls == [('q1', 'processing')]


def test_send_does_not_notify_when_rover_dispatch_fails(client, monkeypatch):
    sign_in(client)

    def fake_post(*a, **k):
        raise requests.exceptions.ConnectionError()

    monkeypatch.setattr(requests, 'post', fake_post)

    calls = []
    monkeypatch.setattr(
        notify, 'notify_mission_control',
        lambda mission_id, status: calls.append((mission_id, status)),
    )

    resp = client.post('/operator/api/missions/q1/send')
    assert resp.status_code == 503
    assert calls == []


def test_rerun_notifies_mission_control(client, missions, monkeypatch):
    sign_in(client)
    monkeypatch.setattr(requests, 'post', lambda *a, **k: FakeResponse(200, {}))

    calls = []
    monkeypatch.setattr(
        notify, 'notify_mission_control',
        lambda mission_id, status: calls.append((mission_id, status)),
    )

    resp = client.post('/operator/api/missions/c1/rerun')
    assert resp.status_code == 200
    assert calls == [('c1', 'processing')]


# ---------------------------------------------------------------------------
# Complete + YouTube
# ---------------------------------------------------------------------------

def test_complete_marks_mission_completed(client, missions):
    sign_in(client)
    resp = client.post('/operator/api/missions/p1/complete')
    assert resp.status_code == 200
    assert missions['p1']['status'] == 'completed'
    assert 'completedAt' in missions['p1']


def test_complete_keeps_the_recording_and_marks_it_kept(client, missions, monkeypatch):
    """BACKLOG 335/336: the ordinary successful-run path. Unlike STOP or a
    rover-reported error, a mission marked complete keeps its video."""
    sign_in(client)
    stop_calls = []
    monkeypatch.setattr(
        recording_control, 'stop_recording',
        lambda mission_id, yard, keep: (stop_calls.append((mission_id, yard, keep)), (True, 'ok'))[1],
    )

    resp = client.post('/operator/api/missions/p1/complete')

    assert resp.status_code == 200
    assert stop_calls == [('p1', YARD, True)]


def test_complete_notifies_mission_control(client, missions, monkeypatch):
    sign_in(client)
    calls = []
    monkeypatch.setattr(
        notify, 'notify_mission_control',
        lambda mission_id, status: calls.append((mission_id, status)),
    )

    resp = client.post('/operator/api/missions/p1/complete')
    assert resp.status_code == 200
    assert calls == [('p1', 'completed')]


def test_complete_rejects_terminal_missions(client, missions):
    sign_in(client)
    assert client.post('/operator/api/missions/c1/complete').status_code == 400


def test_youtube_url_validation(client, missions):
    sign_in(client)
    bad = client.post('/operator/api/missions/c1/youtube', json={'url': 'https://vimeo.com/1'})
    assert bad.status_code == 400

    ok = client.post(
        '/operator/api/missions/c1/youtube',
        json={'url': 'https://youtube.com/watch?v=abc123'},
    )
    assert ok.status_code == 200
    assert missions['c1']['youtubeUrl'] == 'https://youtube.com/watch?v=abc123'


def test_youtube_only_attaches_to_completed_missions(client, missions):
    sign_in(client)
    resp = client.post(
        '/operator/api/missions/q1/youtube',
        json={'url': 'https://youtu.be/abc123'},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Mission list
# ---------------------------------------------------------------------------

def _seed_mirror(synced_at='2026-07-14T09:00:00Z'):
    """api_missions reads the SQLite mirror now, not Firestore - seed it the
    way the sync worker would after a successful pull.
    """
    mission_store.upsert_missions([
        {
            'id': 'q1', 'name': 'Sand Observer', 'yardId': 'curiosity',
            'code': 'rover.forward(60)\nrover.stop()', 'blocklyState': '{"blocks":{}}',
            'status': 'queued', 'submittedAt': '2026-07-14T08:00:00Z',
        },
        {
            'id': 'p1', 'name': 'Storm Collector', 'yardId': 'curiosity',
            'code': 'rover.forward(30)', 'status': 'processing',
            'submittedAt': '2026-07-14T07:00:00Z',
        },
        {
            'id': 'c1', 'name': 'Crater Pioneer', 'yardId': 'curiosity',
            'code': 'rover.stop()', 'status': 'completed',
            'submittedAt': '2026-07-14T06:00:00Z',
        },
    ], synced_at)


def test_missions_endpoint_serialises_documents(client):
    sign_in(client)
    _seed_mirror(synced_at=mirror.now_iso())

    resp = client.get('/operator/api/missions')
    assert resp.status_code == 200
    payload = resp.get_json()
    ids = {m['id'] for m in payload['missions']}
    assert ids == {'q1', 'q2', 'p1', 'c1'}
    q1 = next(m for m in payload['missions'] if m['id'] == 'q1')
    assert q1['status'] == 'queued'
    assert q1['code'].startswith('rover.forward')
    # camelCase API contract must survive the snake_case SQLite round-trip
    assert q1['yardId'] == 'curiosity'
    assert q1['blocklyState'] == '{"blocks":{}}'
    assert q1['submittedAt'] == '2026-07-14T08:00:00Z'


def test_missions_endpoint_is_stale_when_never_synced(client):
    """A satellite that has never reached Firestore has nothing to show and
    must say so, rather than looking like an empty queue."""
    import mission_store
    with mission_store._db_lock:
        conn = mission_store._connect()
        conn.execute('DELETE FROM mission_mirror')
        conn.execute('DELETE FROM sync_meta')
        conn.commit()
        conn.close()

    sign_in(client)
    resp = client.get('/operator/api/missions')
    payload = resp.get_json()
    assert payload['missions'] == []
    assert payload['stale'] is True
    assert payload['lastSyncedAt'] is None
    assert payload['pendingWrites'] == 0


def test_missions_endpoint_is_fresh_right_after_a_sync(client):
    sign_in(client)
    _seed_mirror(synced_at=mirror.now_iso())
    payload = client.get('/operator/api/missions').get_json()
    assert payload['stale'] is False


def test_missions_endpoint_is_stale_when_last_sync_is_old(client):
    sign_in(client)
    _seed_mirror(synced_at='2020-01-01T00:00:00Z')
    payload = client.get('/operator/api/missions').get_json()
    assert payload['stale'] is True
    assert payload['lastSyncedAt'] == '2020-01-01T00:00:00Z'


def test_missions_endpoint_reports_pending_writes_from_outbox(client):
    sign_in(client)
    _seed_mirror(synced_at=mirror.now_iso())

    conn = mission_store._connect()
    for i in range(3):
        conn.execute(
            "INSERT INTO outbox (uuid, mission_id, op, payload, event_at, created_at) "
            "VALUES (?, 'q1', 'complete', '{}', '2026-07-14T09:00:00Z', '2026-07-14T09:00:00Z')",
            (f'uuid-{i}',),
        )
    conn.commit()
    conn.close()

    payload = client.get('/operator/api/missions').get_json()
    assert payload['pendingWrites'] == 3


# ---------------------------------------------------------------------------
# YouTube auto-linking poll
# ---------------------------------------------------------------------------

def fake_playlist_response(mission_id, video_id='vid123'):
    return FakeResponse(200, {
        'items': [{
            'snippet': {
                'description': f'MissionID: {mission_id}',
                'resourceId': {'videoId': video_id},
            },
        }],
    })


@pytest.fixture
def firestore_missions():
    """A plain dict for FakeQueryFirestore. The YouTube poll is the one thing
    that still reads Firestore directly (plan 7.5), so it is not backed by the
    mirror like the request-path handlers are."""
    return _seed_missions()


@pytest.fixture
def youtube_env(monkeypatch):
    monkeypatch.setenv('YOUTUBE_API_KEY', 'test-key')
    monkeypatch.setenv('YOUTUBE_CHANNEL_ID', 'UCabc123')


def test_poll_links_mission_with_no_youtube_field_at_all(missions, firestore_missions, monkeypatch, youtube_env):
    # c1 is completed and has never had a youtubeUrl key written at all -
    # this is what a real first-run completion looks like (mission-control
    # never writes the field, and api_mark_complete doesn't touch it).
    assert 'youtubeUrl' not in firestore_missions['c1']
    monkeypatch.setattr(deps, 'firestore_client', lambda: FakeQueryFirestore(firestore_missions))
    monkeypatch.setattr(
        requests, 'get',
        lambda *a, **k: fake_playlist_response('c1'),
    )

    operator_console.check_for_new_videos()

    assert firestore_missions['c1']['youtubeUrl'] == 'https://www.youtube.com/watch?v=vid123'


def test_poll_skips_missions_that_already_have_a_link(missions, monkeypatch, youtube_env):
    """Candidates come from the mirror now, so that is where 'already linked'
    has to be true - and with nothing outstanding the poll must not spend a
    Firestore read or a YouTube call."""
    missions['c1'].update({'youtubeUrl': 'https://www.youtube.com/watch?v=already-linked'})
    monkeypatch.setattr(
        deps, 'firestore_client',
        lambda: pytest.fail('Firestore must not be read to build the candidate list'),
    )
    monkeypatch.setattr(
        requests, 'get',
        lambda *a, **k: pytest.fail('YouTube API must not be called when nothing is unlinked'),
    )

    operator_console.check_for_new_videos()

    assert missions['c1']['youtubeUrl'] == 'https://www.youtube.com/watch?v=already-linked'


def test_poll_never_reads_firestore_to_find_candidates(missions, firestore_missions, monkeypatch, youtube_env):
    """The whole point of the change: the candidate list is free. Firestore is
    touched only to write a link that was actually found."""
    reads = []

    class CountingFirestore(FakeQueryFirestore):
        def collection(self, name):
            reads.append(name)
            return super().collection(name)

    monkeypatch.setattr(deps, 'firestore_client', lambda: CountingFirestore(firestore_missions))
    monkeypatch.setattr(
        requests, 'get',
        lambda *a, **k: FakeResponse(200, {'items': [{
            'snippet': {'description': 'nothing matching here', 'resourceId': {'videoId': 'vid999'}},
        }]}),
    )

    operator_console.check_for_new_videos()

    # c1 is unlinked, so the YouTube call happens - but no video matched, so
    # Firestore was never reached at all.
    assert reads == []


def test_poll_skips_entirely_when_credentials_missing(missions, monkeypatch):
    monkeypatch.delenv('YOUTUBE_API_KEY', raising=False)
    monkeypatch.delenv('YOUTUBE_CHANNEL_ID', raising=False)
    monkeypatch.setattr(
        deps, 'firestore_client',
        lambda: pytest.fail('must not touch Firestore without credentials'),
    )

    operator_console.check_for_new_videos()


def test_poll_survives_youtube_api_error_response(missions, firestore_missions, monkeypatch, youtube_env):
    monkeypatch.setattr(deps, 'firestore_client', lambda: FakeQueryFirestore(firestore_missions))
    monkeypatch.setattr(requests, 'get', lambda *a, **k: FakeResponse(500))

    operator_console.check_for_new_videos()

    assert 'youtubeUrl' not in firestore_missions['c1']


def test_poll_survives_youtube_network_error(missions, firestore_missions, monkeypatch, youtube_env):
    monkeypatch.setattr(deps, 'firestore_client', lambda: FakeQueryFirestore(firestore_missions))

    def fake_get(*a, **k):
        raise requests.exceptions.ConnectionError()

    monkeypatch.setattr(requests, 'get', fake_get)

    operator_console.check_for_new_videos()

    assert 'youtubeUrl' not in firestore_missions['c1']


def test_poll_survives_firestore_error(missions, monkeypatch, youtube_env):
    """A Firestore failure must not propagate out of the poll.

    Rewritten for where Firestore is now actually touched. This used to fail
    the very first call, because the poll opened by streaming every completed
    mission out of Firestore to find its candidates. It reads those from the
    local mirror now, so the only Firestore call left is the write that
    records a link - and that is the call this has to prove is survivable.
    """
    monkeypatch.setattr(
        deps, 'firestore_client',
        lambda: (_ for _ in ()).throw(RuntimeError('firestore unavailable')),
    )
    # c1 is completed with no video, so it IS a candidate: the poll gets as far
    # as matching a video and attempting the write, rather than returning early
    # with nothing to do and passing for the wrong reason.
    monkeypatch.setattr(
        requests, 'get',
        lambda *a, **k: FakeResponse(200, {'items': [{
            'snippet': {
                'description': f'MissionID: c1',
                'resourceId': {'videoId': 'vid123'},
            },
        }]}),
    )

    operator_console.check_for_new_videos()  # must not raise

    # The link was not recorded, so c1 stays a candidate and the next poll
    # retries it - losing the video silently would be worse than not linking it.
    from mission_store import completed_without_video
    assert 'c1' in completed_without_video()


def test_start_polling_reschedules_even_when_check_raises(monkeypatch):
    monkeypatch.setattr(
        operator_console, 'check_for_new_videos',
        lambda: (_ for _ in ()).throw(RuntimeError('boom')),
    )

    scheduled = []

    class FakeTimer:
        def __init__(self, interval, fn):
            scheduled.append(interval)
            self.daemon = None

        def start(self):
            pass

    monkeypatch.setattr(threading, 'Timer', FakeTimer)

    operator_console.start_polling()

    assert scheduled == [300]


# ---------------------------------------------------------------------------
# mission-control notification
# ---------------------------------------------------------------------------

def test_notify_mission_control_posts_status_to_the_notify_endpoint(monkeypatch):
    calls = []
    monkeypatch.setattr(
        requests, 'post',
        lambda url, json=None, timeout=None: calls.append((url, json, timeout)) or FakeResponse(200, {}),
    )
    monkeypatch.setenv('MISSION_CONTROL_URL', 'https://mission-control.example')

    with flask_app.app_context():
        notify.notify_mission_control('mission-1', 'completed')

    assert calls == [
        ('https://mission-control.example/api/missions/mission-1/notify', {'status': 'completed'}, notify.NOTIFY_TIMEOUT),
    ]


def test_notify_mission_control_async_runs_on_a_real_background_thread(monkeypatch):
    """Uses the real threading module (no SyncThread fake) to prove the
    async wrapper genuinely offloads work rather than running inline, and
    that it correctly re-establishes the Flask app context on that thread
    (current_app is thread-local and won't propagate on its own).
    """
    done = threading.Event()
    result = {}

    def fake_notify(mission_id, status):
        result['thread'] = threading.current_thread()
        result['args'] = (mission_id, status)
        result['app'] = current_app._get_current_object()
        done.set()

    monkeypatch.setattr(notify, 'notify_mission_control', fake_notify)

    with flask_app.app_context():
        notify.notify_mission_control_async('mission-1', 'completed')
        assert done.wait(timeout=2), 'background thread never called _notify_mission_control'

    assert result['thread'] is not threading.current_thread()
    assert result['args'] == ('mission-1', 'completed')
    assert result['app'] is flask_app


def test_notify_mission_control_swallows_network_errors(monkeypatch):
    def fake_post(*a, **k):
        raise requests.exceptions.ConnectionError()

    monkeypatch.setattr(requests, 'post', fake_post)

    with flask_app.app_context():
        notify.notify_mission_control('mission-1', 'completed')  # must not raise


def test_mission_control_url_defaults_to_localhost(monkeypatch):
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)

    with flask_app.app_context():
        assert deps.mission_control_url() == 'http://localhost:3000'


# ---------------------------------------------------------------------------
# Mission locking / leases
#
# The point of the lock is that exactly one operator drives a mission at a
# time, and that a mission is never stranded when the operator holding it
# disappears. These cover both halves.
# ---------------------------------------------------------------------------

def _ok_rover(monkeypatch, calls=None):
    def fake_post(url, json=None, timeout=None):
        if calls is not None:
            calls.append((url, json))
        return FakeResponse(200, {'status': 'ok', 'added': 1})
    monkeypatch.setattr(requests, 'post', fake_post)


def _no_rover(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        raise requests.exceptions.ConnectionError('rover offline')
    monkeypatch.setattr(requests, 'post', fake_post)


def test_send_marks_the_run_processing_and_stamps_when_it_started(client, missions, monkeypatch):
    sign_in(client)
    _ok_rover(monkeypatch)

    assert client.post('/operator/api/missions/q1/send').status_code == 200

    run = mission_store.get_run('q1', YARD)
    assert run['status'] == 'processing'
    assert re.match(r'\d{4}-\d{2}-\d{2}T', run['started_at'])

    # And rolled up onto the mission, which is what Mission Control reads.
    m = missions['q1']
    assert m['status'] == 'processing'
    assert m['statusUpdatedAt']


def test_a_second_send_at_the_same_yard_is_refused(client, missions, monkeypatch):
    """Two tablets, one rover. The second Send must not dispatch again.

    This is the whole reason the lease existed, and it survives its removal:
    the guard is now "is this run already processing", which needs no owner
    and no expiry because one satellite serves one yard.
    """
    sign_in(client)
    _ok_rover(monkeypatch)

    assert client.post('/operator/api/missions/q1/send').status_code == 200

    second = client.post('/operator/api/missions/q1/send')
    assert second.status_code == 409
    assert 'already running' in second.get_json()['error'].lower()


def test_a_run_already_processing_is_never_silently_restarted(client, missions, monkeypatch):
    """p1 is seeded processing. Sending it again must refuse, not re-dispatch.

    Under the lease this depended on the lease still being live; a processing
    run with an expired lease was reclaimable. Now 'processing' is refused
    outright, and a genuinely stuck run is recovery.py's job at startup, which
    asks the rover rather than guessing from a clock.
    """
    sign_in(client)
    monkeypatch.setattr(
        requests, 'post',
        lambda *a, **k: pytest.fail('rover must not be called'),
    )

    assert client.post('/operator/api/missions/p1/send').status_code == 409


def test_failed_dispatch_releases_the_lock_and_requeues(client, missions, monkeypatch):
    """A lock held by a dispatch that never landed would strand the mission for
    a full lease period."""
    sign_in(client)
    _no_rover(monkeypatch)

    resp = client.post('/operator/api/missions/q1/send')
    assert resp.status_code != 200

    m = missions['q1']
    assert m['status'] == 'queued', 'must go back in the queue, not stay processing'


def test_completing_a_run_frees_the_yard_for_the_next_mission(client, missions, monkeypatch):
    sign_in(client)
    _ok_rover(monkeypatch)
    client.post('/operator/api/missions/q1/send')

    assert client.post('/operator/api/missions/q1/complete').status_code == 200

    run = mission_store.get_run('q1', YARD)
    assert run['status'] == 'completed'
    assert missions['q1']['status'] == 'completed'

    # Nothing is holding the yard, so the next mission can start.
    assert client.post('/operator/api/missions/q2/send').status_code == 200


def test_rerun_restarts_a_finished_run(client, missions, monkeypatch):
    sign_in(client)
    _ok_rover(monkeypatch)

    assert client.post('/operator/api/missions/c1/rerun').status_code == 200

    run = mission_store.get_run('c1', YARD)
    assert run['status'] == 'processing'
    assert missions['c1']['status'] == 'processing'


def test_rerun_restores_the_previous_status_when_dispatch_fails(client, missions, monkeypatch):
    """An unreachable rover is not a failed mission. Marking it 'failed' would
    also surface to the learner as a run that went wrong."""
    sign_in(client)
    _no_rover(monkeypatch)

    assert missions['c1']['status'] == 'completed'

    resp = client.post('/operator/api/missions/c1/rerun')
    assert resp.status_code != 200

    m = missions['c1']
    assert m['status'] == 'completed', 'must not be left marked failed'


def test_rerun_is_refused_while_the_run_is_already_going(client, missions, monkeypatch):
    sign_in(client)
    _ok_rover(monkeypatch)
    client.post('/operator/api/missions/q1/send')

    refused = client.post('/operator/api/missions/q1/rerun')
    assert refused.status_code == 409


def test_send_still_notifies_mission_control_after_locking(client, missions, monkeypatch):
    """Regression guard: feat/MissionLock rewrote these handlers off a base that
    predated the notify calls, and dropped all three. Nothing fails when they
    go missing - learners just stop getting email."""
    sign_in(client)
    _ok_rover(monkeypatch)
    calls = []
    monkeypatch.setattr(
        notify, 'notify_mission_control',
        lambda mission_id, status: calls.append((mission_id, status)),
    )

    client.post('/operator/api/missions/q1/send')

    assert calls == [('q1', 'processing')]


def test_complete_still_notifies_mission_control_after_locking(client, missions, monkeypatch):
    sign_in(client)
    _ok_rover(monkeypatch)
    calls = []
    monkeypatch.setattr(
        notify, 'notify_mission_control',
        lambda mission_id, status: calls.append((mission_id, status)),
    )

    client.post('/operator/api/missions/q1/send')
    calls.clear()
    client.post('/operator/api/missions/q1/complete')

    assert calls == [('q1', 'completed')]


def test_rerun_still_notifies_mission_control_after_locking(client, missions, monkeypatch):
    sign_in(client)
    _ok_rover(monkeypatch)
    calls = []
    monkeypatch.setattr(
        notify, 'notify_mission_control',
        lambda mission_id, status: calls.append((mission_id, status)),
    )

    client.post('/operator/api/missions/c1/rerun')

    assert calls == [('c1', 'processing')]


def test_failed_dispatch_does_not_notify(client, missions, monkeypatch):
    """Nothing ran, so the learner must not be told their mission launched."""
    sign_in(client)
    _no_rover(monkeypatch)
    calls = []
    monkeypatch.setattr(
        notify, 'notify_mission_control',
        lambda mission_id, status: calls.append((mission_id, status)),
    )

    client.post('/operator/api/missions/q1/send')
    assert calls == []


# ---------------------------------------------------------------------------
# Satellite identity as the lock owner (plan 3.3 / 7.4)
# ---------------------------------------------------------------------------

def test_satellite_id_is_stable_across_calls_and_restarts(monkeypatch, tmp_path):
    import satellite_identity
    cfg = tmp_path / 'sat.json'
    monkeypatch.setattr(satellite_identity, 'CONFIG_FILE', str(cfg))
    satellite_identity.reset_cache()

    first = satellite_identity.satellite_id()
    assert satellite_identity.satellite_id() == first, 'must be stable within a process'

    # Simulate a restart: drop the memo, reload from disk.
    satellite_identity.reset_cache()
    assert satellite_identity.satellite_id() == first, 'must survive a restart'
    assert cfg.exists(), 'the id must be persisted, not regenerated each boot'
    satellite_identity.reset_cache()


def test_satellite_id_survives_an_unwritable_config(monkeypatch, tmp_path):
    """A read-only filesystem degrades lock ownership; it must not stop boot."""
    import satellite_identity
    monkeypatch.setattr(satellite_identity, 'CONFIG_FILE', str(tmp_path / 'nope' / 'sat.json'))
    satellite_identity.reset_cache()

    assert satellite_identity.satellite_id()  # does not raise
    satellite_identity.reset_cache()


def test_yard_id_prefers_env_then_config_then_default(monkeypatch, tmp_path):
    import satellite_identity
    cfg = tmp_path / 'sat.json'
    cfg.write_text('{"yard_id": "from-config"}')
    monkeypatch.setattr(satellite_identity, 'CONFIG_FILE', str(cfg))

    monkeypatch.setenv('YARD_ID', 'from-env')
    satellite_identity.reset_cache()
    assert satellite_identity.yard_id() == 'from-env'

    monkeypatch.delenv('YARD_ID')
    satellite_identity.reset_cache()
    assert satellite_identity.yard_id() == 'from-config'

    cfg.write_text('{}')
    satellite_identity.reset_cache()
    assert satellite_identity.yard_id() == satellite_identity.DEFAULT_YARD_ID
    satellite_identity.reset_cache()


def test_youtube_poll_skips_a_mission_with_pending_local_writes(
    missions, firestore_missions, monkeypatch, youtube_env
):
    """Plan 7.5: the poll writes to Firestore directly, so it must not land
    between a flush's read and write and clobber an operator's completion."""
    import mission_store
    mission_store.release_mission('c1', 'completed', '2026-07-14T10:00:00Z')
    assert mission_store.mission_has_pending('c1')

    monkeypatch.setattr(deps, 'firestore_client', lambda: FakeQueryFirestore(firestore_missions))
    monkeypatch.setattr(
        requests, 'get',
        lambda *a, **k: fake_playlist_response('c1'),
    )

    operator_console.check_for_new_videos()

    assert 'youtubeUrl' not in firestore_missions['c1'], 'must not write over a pending change'


def test_youtube_poll_writes_when_nothing_is_pending(
    missions, firestore_missions, monkeypatch, youtube_env
):
    import mission_store
    assert not mission_store.mission_has_pending('c1')

    monkeypatch.setattr(deps, 'firestore_client', lambda: FakeQueryFirestore(firestore_missions))
    monkeypatch.setattr(
        requests, 'get',
        lambda *a, **k: fake_playlist_response('c1'),
    )

    operator_console.check_for_new_videos()

    assert firestore_missions['c1']['youtubeUrl'] == 'https://www.youtube.com/watch?v=vid123'
    # The mirror is updated too, so the console shows it without a pull.
    assert mission_store.get_mission('c1')['youtube_url'] == 'https://www.youtube.com/watch?v=vid123'


# ---------------------------------------------------------------------------
# Needs-review surface (plan PR 4)
# ---------------------------------------------------------------------------

def test_needs_review_lists_only_flagged_missions(client, missions):
    import mission_store
    sign_in(client)

    assert client.get('/operator/api/missions/needs-review').get_json()['missions'] == []

    mission_store.flag_for_review('p1', 'interrupted')
    listed = client.get('/operator/api/missions/needs-review').get_json()['missions']

    assert [m['id'] for m in listed] == ['p1']


def test_resolving_as_completed_closes_it_out(client, missions, monkeypatch):
    import mission_store
    sign_in(client)
    mission_store.flag_for_review('p1', 'interrupted')

    resp = client.post('/operator/api/missions/p1/resolve', json={'outcome': 'completed'})
    assert resp.status_code == 200

    row = mission_store.get_mission('p1')
    assert row['status'] == 'completed'
    assert row['needs_review'] == 0


def test_requeuing_returns_it_to_the_queue_without_touching_the_rover(client, missions, monkeypatch):
    """Re-queue makes it available for a human to send again. It must not
    dispatch by itself - physical actions are not replayable (plan 2.3)."""
    import mission_store
    sign_in(client)
    mission_store.flag_for_review('p1', 'interrupted')

    rover_calls = []
    monkeypatch.setattr(
        requests, 'post',
        lambda url, json=None, timeout=None: (rover_calls.append(url), FakeResponse(200))[1],
    )

    resp = client.post('/operator/api/missions/p1/resolve', json={'outcome': 'requeue'})
    assert resp.status_code == 200

    row = mission_store.get_mission('p1')
    assert row['status'] == 'queued'
    assert row['needs_review'] == 0
    assert not any('queue/add' in u for u in rover_calls), 'must not re-dispatch'


def test_resolve_cancelled_sets_status_and_discards_the_kept_recording(client, missions, monkeypatch):
    """BACKLOG 338. This is the review flow's discard point: mission_watcher
    already stopped the recording and kept it (flag_for_review); only the
    operator's own 'cancelled' decision throws it away."""
    import mission_store
    sign_in(client)
    mission_store.flag_for_review('p1', 'interrupted')
    discard_calls = []
    monkeypatch.setattr(
        recording_control, 'stop_recording',
        lambda mission_id, yard, keep: (discard_calls.append((mission_id, yard, keep)), (True, 'ok'))[1],
    )

    resp = client.post('/operator/api/missions/p1/resolve', json={'outcome': 'cancelled'})

    assert resp.status_code == 200
    assert resp.get_json()['newStatus'] == 'cancelled'
    row = mission_store.get_mission('p1')
    assert row['status'] == 'cancelled'
    assert row['needs_review'] == 0
    run = mission_store.get_run('p1', YARD)
    assert run['status'] == 'cancelled'
    assert run['needs_review'] == 0
    assert discard_calls == [('p1', YARD, False)]


def test_resolve_completed_leaves_the_kept_recording_untouched(client, missions, monkeypatch):
    import mission_store
    sign_in(client)
    mission_store.flag_for_review('p1', 'interrupted')
    discard_calls = []
    monkeypatch.setattr(
        recording_control, 'stop_recording',
        lambda mission_id, yard, keep: (discard_calls.append((mission_id, yard, keep)), (True, 'ok'))[1],
    )

    resp = client.post('/operator/api/missions/p1/resolve', json={'outcome': 'completed'})

    assert resp.status_code == 200
    assert discard_calls == [], 'completed keeps whatever mission_watcher already kept'


def test_resolve_requeue_discards_the_stale_recording(client, missions, monkeypatch):
    """A requeued mission is about to be re-run and will get a fresh
    recording; the old one from the interrupted run should not follow it
    back into the ordinary queue."""
    import mission_store
    sign_in(client)
    mission_store.flag_for_review('p1', 'interrupted')
    discard_calls = []
    monkeypatch.setattr(
        recording_control, 'stop_recording',
        lambda mission_id, yard, keep: (discard_calls.append((mission_id, yard, keep)), (True, 'ok'))[1],
    )

    resp = client.post('/operator/api/missions/p1/resolve', json={'outcome': 'requeue'})

    assert resp.status_code == 200
    assert discard_calls == [('p1', YARD, False)]


def test_resolve_rejects_an_unknown_outcome(client, missions):
    import mission_store
    sign_in(client)
    mission_store.flag_for_review('p1', 'interrupted')

    assert client.post('/operator/api/missions/p1/resolve',
                       json={'outcome': 'delete'}).status_code == 400


def test_resolve_rejects_a_mission_not_under_review(client, missions):
    sign_in(client)
    assert client.post('/operator/api/missions/q1/resolve',
                       json={'outcome': 'completed'}).status_code == 400


def test_conflicts_endpoint_exposes_the_log(client, missions):
    import mission_store
    sign_in(client)

    assert client.get('/operator/api/conflicts').get_json()['conflicts'] == []

    mission_store.log_conflict('q1', 'completed', 'cancelled', 'local')
    conflicts = client.get('/operator/api/conflicts').get_json()['conflicts']

    assert len(conflicts) == 1
    assert conflicts[0]['resolution'] == 'local'


def test_recording_status_appears_in_the_mission_api_contract(client, missions):
    """BACKLOG 335/336: the mission page renders a recording badge off this
    field, so it has to reach the camelCase JSON contract, not just the
    snake_case mirror row."""
    sign_in(client)

    resp = client.get('/operator/api/missions/q1')

    assert resp.status_code == 200
    mission = resp.get_json()['mission']
    assert mission['recordingStatus'] == 'none'
    assert 'recordingPath' not in mission, 'server-internal, not operator-facing'


def test_review_endpoints_require_an_operator(client, missions):
    assert client.get('/operator/api/missions/needs-review').status_code == 401
    assert client.post('/operator/api/missions/p1/resolve',
                       json={'outcome': 'completed'}).status_code == 401
    assert client.get('/operator/api/conflicts').status_code == 401


# ---------------------------------------------------------------------------
# Cancel, camera and setup surfaces
# ---------------------------------------------------------------------------

def test_cancel_takes_a_queued_mission_out_without_running_it(client, missions, monkeypatch):
    import mission_store
    sign_in(client)
    rover_calls = []
    monkeypatch.setattr(
        requests, 'post',
        lambda url, json=None, timeout=None: (rover_calls.append(url), FakeResponse(200))[1],
    )

    assert client.post('/operator/api/missions/q1/cancel').status_code == 200

    assert mission_store.get_mission('q1')['status'] == 'cancelled'
    assert not any('queue/add' in u for u in rover_calls)


def test_cancel_frees_the_yard(client, missions, monkeypatch):
    sign_in(client)
    _ok_rover(monkeypatch)
    client.post('/operator/api/missions/q1/send')

    assert client.post('/operator/api/missions/q1/cancel').status_code == 200

    assert mission_store.get_run('q1', YARD)['status'] == 'cancelled'
    # The yard is free again, which is the part an operator depends on.
    assert client.post('/operator/api/missions/q2/send').status_code == 200


def test_cancel_is_refused_on_a_finished_mission(client, missions):
    sign_in(client)
    assert client.post('/operator/api/missions/c1/cancel').status_code == 400


def test_cancel_discards_the_recording_when_the_mission_was_running(client, missions, monkeypatch):
    """A 'processing' run cancelled this way ends up 'cancelled' exactly like
    one stopped via STOP, and must not carry a video a future upload step
    could mistake for a successful run (BACKLOG 338)."""
    sign_in(client)
    discard_calls = []
    monkeypatch.setattr(
        recording_control, 'stop_recording',
        lambda mission_id, yard, keep: (discard_calls.append((mission_id, yard, keep)), (True, 'ok'))[1],
    )

    assert client.post('/operator/api/missions/p1/cancel').status_code == 200

    assert discard_calls == [('p1', YARD, False)]


def test_cancel_does_not_touch_recording_for_a_queued_mission(client, missions, monkeypatch):
    """A queued mission never started recording - nothing to discard."""
    sign_in(client)
    discard_calls = []
    monkeypatch.setattr(
        recording_control, 'stop_recording',
        lambda mission_id, yard, keep: (discard_calls.append((mission_id, yard, keep)), (True, 'ok'))[1],
    )

    assert client.post('/operator/api/missions/q1/cancel').status_code == 200

    assert discard_calls == []


def test_cancel_queues_the_change_for_firestore(client, missions):
    import mission_store
    sign_in(client)
    client.post('/operator/api/missions/q1/cancel')
    assert mission_store.peek_outbox()['mission_id'] == 'q1'


def test_integrations_never_expose_secret_values(client, missions, monkeypatch):
    """This console is reachable by anyone on the venue network, and
    OPERATOR_AUTH=off removes the login entirely on event days."""
    sign_in(client)
    monkeypatch.setenv('YOUTUBE_API_KEY', 'AIzaSyTOTALLY-SECRET')
    monkeypatch.setenv('YOUTUBE_CHANNEL_ID', 'UCsecretchannel')
    monkeypatch.setenv('FIREBASE_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----abc')

    body = client.get('/operator/api/integrations').get_data(as_text=True)

    assert 'AIzaSyTOTALLY-SECRET' not in body
    assert 'UCsecretchannel' not in body
    assert 'BEGIN PRIVATE KEY' not in body


def test_integrations_report_youtube_as_unconfigured_when_keys_are_missing(client, missions, monkeypatch):
    sign_in(client)
    monkeypatch.delenv('YOUTUBE_API_KEY', raising=False)
    monkeypatch.delenv('YOUTUBE_CHANNEL_ID', raising=False)

    data = client.get('/operator/api/integrations').get_json()
    yt = next(i for i in data['integrations'] if i['id'] == 'youtube')

    assert yt['configured'] is False
    assert 'manual linking still works' in yt['detail']


def test_camera_status_reports_unreachable_with_a_hint(client, missions, monkeypatch):
    sign_in(client)
    monkeypatch.setenv('CAMERA_PORT', '59999')  # nothing listening

    data = client.get('/operator/api/camera').get_json()

    assert data['reachable'] is False
    assert data['hint'] and 'Start' in data['hint']
    assert data['managedBy'] in ('systemd', 'process', 'unknown')


def test_new_surfaces_require_an_operator(client, missions):
    assert client.post('/operator/api/missions/q1/cancel').status_code == 401
    assert client.get('/operator/api/integrations').status_code == 401
    assert client.get('/operator/api/camera').status_code == 401


# ---------------------------------------------------------------------------
# Delete (soft)
# ---------------------------------------------------------------------------

def test_delete_hides_the_mission_everywhere(client, missions):
    import mission_store
    sign_in(client)

    assert client.post('/operator/api/missions/q1/delete').status_code == 200

    listed = client.get('/operator/api/missions').get_json()['missions']
    assert 'q1' not in [m['id'] for m in listed]


def test_delete_is_soft_so_a_mistake_is_recoverable(client, missions):
    """The operator is told it is permanent - there is no undo in the console -
    but the record survives for someone with database access. A hard delete
    would make one wrong tap on a child's completed mission unrecoverable."""
    import mission_store
    sign_in(client)

    client.post('/operator/api/missions/q1/delete')

    row = mission_store.get_mission('q1', include_deleted=True)
    assert row is not None, 'the document must survive'
    assert row['deleted'] == 1
    assert row['deleted_at']


def test_delete_frees_the_yard(client, missions, monkeypatch):
    sign_in(client)
    _ok_rover(monkeypatch)
    client.post('/operator/api/missions/q1/send')

    assert client.post('/operator/api/missions/q1/delete').status_code == 200

    assert client.post('/operator/api/missions/q2/send').status_code == 200


def test_delete_queues_the_change_for_firestore(client, missions):
    import mission_store
    sign_in(client)

    client.post('/operator/api/missions/q1/delete')

    entry = mission_store.peek_outbox()
    assert entry['mission_id'] == 'q1'
    assert entry['op'] == 'delete'


def test_deleting_twice_is_refused(client, missions):
    sign_in(client)
    assert client.post('/operator/api/missions/q1/delete').status_code == 200
    assert client.post('/operator/api/missions/q1/delete').status_code == 400


def test_delete_404s_for_an_unknown_mission(client, missions):
    sign_in(client)
    assert client.post('/operator/api/missions/nope/delete').status_code == 404


def test_delete_requires_an_operator(client, missions):
    assert client.post('/operator/api/missions/q1/delete').status_code == 401


def test_a_deleted_mission_is_not_reconciled_or_dispatchable(client, missions, monkeypatch):
    """It must drop out of the active set, or the sync worker keeps paying to
    re-read a mission nobody can see."""
    import mission_store
    sign_in(client)

    client.post('/operator/api/missions/q1/delete')

    assert 'q1' not in mission_store.active_mission_ids('curiosity')
    _ok_rover(monkeypatch)
    assert client.post('/operator/api/missions/q1/send').status_code == 404


# ---------------------------------------------------------------------------
# Camera control
# ---------------------------------------------------------------------------

def test_camera_start_requires_an_operator(client, missions):
    """Spawning a process is the most powerful thing this console does, on a
    network anyone at the venue can join."""
    assert client.post('/operator/api/camera/start').status_code == 401
    assert client.post('/operator/api/camera/stop').status_code == 401


def test_camera_start_rejects_a_non_numeric_index(client, missions, monkeypatch):
    """The index is the one caller-supplied value near a subprocess. It never
    reaches a command line, but it is still validated rather than trusted."""
    sign_in(client)
    called = []
    monkeypatch.setattr(camera, 'api_camera_start', camera.api_camera_start)
    import camera_control
    monkeypatch.setattr(camera_control, 'start', lambda camera_index=None: called.append(1) or (True, 'ok'))

    resp = client.post('/operator/api/camera/start', json={'cameraIndex': '; rm -rf /'})

    assert resp.status_code == 400
    assert called == [], 'nothing should have been started'


def test_camera_start_rejects_an_out_of_range_index(client, missions):
    sign_in(client)
    assert client.post('/operator/api/camera/start', json={'cameraIndex': 99}).status_code == 400
    assert client.post('/operator/api/camera/start', json={'cameraIndex': -1}).status_code == 400


def test_camera_start_reports_a_failure_rather_than_claiming_success(client, missions, monkeypatch):
    sign_in(client)
    import camera_control
    monkeypatch.setattr(camera_control, 'start',
                        lambda camera_index=None: (False, 'Access denied'))

    resp = client.post('/operator/api/camera/start')

    assert resp.status_code == 502
    assert 'Access denied' in resp.get_json()['error']


def test_camera_start_persists_the_chosen_index(client, missions, monkeypatch, tmp_path):
    """So a restart comes back on the same device, like the rover URL."""
    import camera_control, satellite_identity, json
    cfg = tmp_path / 'sat.json'
    monkeypatch.setattr(satellite_identity, 'CONFIG_FILE', str(cfg))
    monkeypatch.setattr(camera_control, 'start', lambda camera_index=None: (True, 'ok'))
    sign_in(client)

    assert client.post('/operator/api/camera/start', json={'cameraIndex': 2}).status_code == 200

    assert json.loads(cfg.read_text())['camera_index'] == 2


def test_a_failed_camera_start_reports_the_cause_not_the_consequence(tmp_path, monkeypatch):
    """camera_server's last line is "Failed to initialize camera, exiting",
    which is true, useless, and mentions systemd even on a Mac. The line above
    it carries the diagnosis and the fix."""
    import camera_control
    log = tmp_path / 'camera.log'
    log.write_text(
        "2026-07-29 16:37:58 - INFO - Initializing Pi AI Camera...\n"
        "2026-07-29 16:37:59 - WARNING - No camera at index 0. On macOS, grant Camera access.\n"
        "2026-07-29 16:37:59 - ERROR - Failed to initialize camera, exiting (systemd restarts in 10s)\n"
    )
    monkeypatch.setattr(camera_control, 'DEV_LOG', str(log))

    line = camera_control._last_log_line()

    assert 'grant Camera access' in line
    assert 'exiting' not in line
    assert 'systemd' not in line


def test_a_macos_permission_denial_does_not_read_as_a_missing_camera(tmp_path, monkeypatch):
    """The log carries both "not authorized" and "No camera at index 0". The
    second reads like absent hardware and sent an operator looking for a
    device that was plugged in the whole time."""
    import camera_control
    log = tmp_path / 'camera.log'
    log.write_text(
        "OpenCV: not authorized to capture video (status 0), requesting...\n"
        "2026-07-29 16:49:30 - WARNING - No camera at index 1. On macOS this is usually permission.\n"
        "2026-07-29 16:49:30 - ERROR - Failed to initialize camera, exiting\n"
    )
    monkeypatch.setattr(camera_control, 'DEV_LOG', str(log))

    line = camera_control._last_log_line()

    assert 'denied camera access' in line
    assert 'No camera at index' not in line
    # The advice that wasted the operator's time: there is nothing to approve,
    # because macOS never prompted.
    assert 'Start the satellite from Terminal' in line


def test_the_permission_message_names_the_app_not_the_interpreter(monkeypatch):
    """Python lives in a .app inside its own framework, so walking the process
    tree for a bundle stops on the interpreter and reports "launched by
    Python" - which tells the operator nothing about what to change."""
    import camera_control
    monkeypatch.setattr(camera_control.sys, 'platform', 'darwin')

    tree = {
        '100': '200 /opt/homebrew/.../Python.framework/Versions/3.13/Resources/Python.app/Contents/MacOS/Python',
        '200': '300 /Applications/SomeEditor.app/Contents/MacOS/editor',
    }
    monkeypatch.setattr(camera_control.os, 'getpid', lambda: 100)
    monkeypatch.setattr(
        camera_control.subprocess, 'run',
        lambda cmd, **kw: type('R', (), {'stdout': tree.get(cmd[-1], '')})(),
    )

    assert camera_control._launching_app() == 'SomeEditor'


def test_walking_the_process_tree_cannot_loop_forever(monkeypatch):
    """A pid whose parent is itself would otherwise hang the request thread."""
    import camera_control
    monkeypatch.setattr(camera_control.sys, 'platform', 'darwin')
    monkeypatch.setattr(camera_control.os, 'getpid', lambda: 7)
    monkeypatch.setattr(
        camera_control.subprocess, 'run',
        lambda cmd, **kw: type('R', (), {'stdout': '7 /usr/bin/python3'})(),
    )

    assert camera_control._launching_app() is None


def test_camera_start_falls_back_when_the_log_says_nothing_useful(tmp_path, monkeypatch):
    import camera_control
    log = tmp_path / 'camera.log'
    log.write_text("some unstructured output\n")
    monkeypatch.setattr(camera_control, 'DEV_LOG', str(log))

    assert camera_control._last_log_line() == 'some unstructured output'


def test_camera_control_never_builds_a_shell_command(monkeypatch):
    """The one caller-supplied value must never reach a command line."""
    import camera_control
    seen = {}
    monkeypatch.setattr(camera_control, 'is_systemd_managed', lambda: False)
    monkeypatch.setattr(camera_control.subprocess, 'Popen',
                        lambda cmd, **kw: seen.update(cmd=cmd, shell=kw.get('shell'), env=kw.get('env'))
                        or type('P', (), {'poll': lambda s: None, 'pid': 1})())
    monkeypatch.setattr(camera_control.time, 'sleep', lambda s: None)

    camera_control.start(camera_index=3)

    assert isinstance(seen['cmd'], list), 'must pass a list, never a string'
    assert seen['shell'] in (None, False), 'shell=True would be injectable'
    assert all('3' not in part for part in seen['cmd'][1:]), 'index must not reach argv'
    assert seen['env']['CAMERA_INDEX'] == '3', 'it travels in the environment'


def _camera_server_module():
    """camera_server imported by path: it is a script, not a package member."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'camera_server_under_test',
        os.path.join(os.path.dirname(__file__), '..', 'camera_server.py'),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_port_probe_does_not_fill_the_camera_log_with_tracebacks():
    """Readiness is checked by opening a socket and closing it, which makes
    websockets log a full traceback per probe. A console polling every few
    seconds then buries every real message - including the failed-start
    explanation camera_control reads back out of this same log."""
    import logging
    noise_filter = _camera_server_module()._ProbeNoiseFilter()

    class Boom(Exception):
        pass

    def record(message, exc=None):
        return logging.LogRecord(
            'websockets.server', logging.ERROR, '', 0, message, (), exc)

    probe = (Boom, Boom('did not receive a valid HTTP request'), None)
    assert not noise_filter.filter(record('opening handshake failed', probe))


def test_a_genuine_handshake_failure_is_still_logged():
    """The filter has to stay narrow: only a connection that sent nothing at
    all is a probe. A real client failing the handshake is a bug someone needs
    to see."""
    import logging
    noise_filter = _camera_server_module()._ProbeNoiseFilter()

    class Boom(Exception):
        pass

    real = (Boom, Boom('invalid Sec-WebSocket-Key header'), None)
    kept = logging.LogRecord(
        'websockets.server', logging.ERROR, '', 0, 'opening handshake failed', (), real)

    assert noise_filter.filter(kept)
    assert noise_filter.filter(
        logging.LogRecord('websockets.server', logging.INFO, '', 0, 'connection open', (), None))


# --- Settings that used to be environment variables (tunables) --------------

def test_tunables_endpoint_reports_values_and_limits(client, missions):
    sign_in(client)

    data = client.get('/operator/api/config/tunables').get_json()

    assert data['values']['sessionMaxAge'] == 12 * 3600
    assert data['limits']['sessionRecheck'] == [30, 3600]


def test_tunables_endpoint_saves_and_takes_effect_without_a_restart(client, missions):
    from console.auth import session_max_age
    sign_in(client)

    resp = client.post('/operator/api/config/tunables', json={'sessionMaxAge': 1800})

    assert resp.status_code == 200
    assert resp.get_json()['values']['sessionMaxAge'] == 1800
    # The point of the move: no restart, the next read sees it.
    assert session_max_age() == 1800


def test_tunables_endpoint_clamps_rather_than_accepting_nonsense(client, missions):
    sign_in(client)

    body = client.post('/operator/api/config/tunables', json={'sessionRecheck': 1}).get_json()

    assert body['values']['sessionRecheck'] == 30


def test_tunables_endpoint_refuses_unknown_keys(client, missions):
    """Fed straight into a config file, so a caller must not invent keys."""
    sign_in(client)

    resp = client.post('/operator/api/config/tunables', json={'sneaky': 1})

    assert resp.status_code == 400
    assert 'Unknown setting' in resp.get_json()['error']


def test_tunables_endpoint_requires_an_operator(client, missions):
    """Shortening the session lifetime is a control action, like repointing
    the rover: anyone on the venue network could otherwise do it."""
    resp = client.post('/operator/api/config/tunables', json={'sessionMaxAge': 300})

    assert resp.status_code in (302, 401, 403)


def test_integrations_report_mission_control_unconfigured_when_url_is_unset(
    client, missions, monkeypatch,
):
    """This panel used to hardcode configured=True.

    It therefore told an operator the learner emails were fine on a satellite
    that had never been told where Mission Control is, which is the state
    every yard Pi was actually in: nothing sets MISSION_CONTROL_URL, so the
    status POST goes to localhost:3000 and notify swallows the failure.
    """
    monkeypatch.delenv('MISSION_CONTROL_URL', raising=False)
    client.application.config.pop('MISSION_CONTROL_URL_GETTER', None)
    sign_in(client)

    data = client.get('/operator/api/integrations').get_json()
    mc = next(i for i in data['integrations'] if i['id'] == 'mission_control')

    assert mc['configured'] is False
    assert 'not being sent' in mc['detail']


def test_integrations_report_mission_control_configured_when_url_is_set(
    client, missions, monkeypatch,
):
    monkeypatch.setenv('MISSION_CONTROL_URL', 'https://marsyard.example.com')
    client.application.config.pop('MISSION_CONTROL_URL_GETTER', None)
    sign_in(client)

    data = client.get('/operator/api/integrations').get_json()
    mc = next(i for i in data['integrations'] if i['id'] == 'mission_control')

    assert mc['configured'] is True
    assert mc['detail'] == 'https://marsyard.example.com'
