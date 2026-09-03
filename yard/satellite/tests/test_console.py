"""
What is left of the console: the station's own surfaces.

This file was 1900 lines and 112 tests covering a mission queue, an operator
login, a review flow and a Firestore sync, none of which the satellite has any
more. Mission bookkeeping moved to Mission Control; the yard runs code, films
it and hands the file over.

The tests kept here are the ones about this box: the station hub, the camera,
the satellite's identity and its tunables.
"""

import sys
import os
import re
import threading
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from web_server import app as flask_app  # noqa: E402
import requests

import operator_console  # noqa: F401,E402
from console import camera  # noqa: E402
import recording_control  # noqa: F401,E402
import camera_control  # noqa: E402
import tunables  # noqa: E402


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv('SATELLITE_CONFIG', str(tmp_path / 'satellite_config.json'))
    flask_app.config['TESTING'] = True
    with flask_app.test_client() as c:
        yield c


# `missions` was a fixture that seeded the Firestore mirror. It is gone, but a
# handful of kept tests still name it, so it stays as a no-op rather than
# rewriting their signatures and losing the git blame on them.
@pytest.fixture
def missions():
    return None
def test_root_opens_the_station_hub_without_a_session(client):
    """The yard used to open on the Firestore queue, behind a sign-in.

    That put reaching Firebase between an operator and the one thing a yard
    has to do, on a box whose point is working when the venue wifi does not.
    The hub needs neither.
    """
    resp = client.get('/')
    page = resp.get_data(as_text=True)

    assert resp.status_code == 200
    # Scoped to the cards, not the whole page: the nav bar links all of these
    # too, so an unscoped search passes even with the hub emptied out. /run/
    # is in this list because it was missing - the hub was written before the
    # run station existed and never learned about it, leaving the operator's
    # own station reachable only from the nav.
    cards = page.split('class="stations"', 1)[1].split('</div>', 1)[0]
    for station in ('/run/', '/code/', '/monitor/', '/settings'):
        assert station in cards, station



def test_root_does_not_send_anyone_to_a_login(client):
    assert '/operator/login' not in client.get('/').headers.get('Location', '')



def test_code_and_monitor_stay_public(client):
    # Learner tablets and the TV never sign in; their pages must not gate.
    assert client.get('/code/').status_code == 200
    assert client.get('/monitor/').status_code == 200



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


# ---------------------------------------------------------------------------
# Needs-review surface (plan PR 4)
# ---------------------------------------------------------------------------


def test_camera_status_reports_unreachable_with_a_hint(client, missions, monkeypatch):
    monkeypatch.setenv('CAMERA_PORT', '59999')  # nothing listening

    data = client.get('/operator/api/camera').get_json()

    assert data['reachable'] is False
    assert data['hint'] and 'Start' in data['hint']
    assert data['managedBy'] in ('systemd', 'process', 'unknown')



def test_camera_control_does_not_require_a_login(client, missions, monkeypatch):
    """This used to be 401, on the grounds that spawning a process is the most
    powerful thing the console does on an open venue network.

    It is open now, deliberately. require_operator means a Firebase sign-in,
    which means internet; /run/ refuses to record until the camera is primed;
    so on a night with no wifi the camera could not be started and nothing
    could be recorded. The offline path is the whole point of this box, and an
    auth gate that only bites when the wifi is down protects nothing.

    What actually guards this is unchanged: the command is hardcoded in
    camera_control, so nothing from the request reaches a shell.
    """
    monkeypatch.setattr(camera_control, 'start', lambda camera_index=None: (True, 'started'))
    monkeypatch.setattr(camera_control, 'stop', lambda: (True, 'stopped'))

    assert client.post('/operator/api/camera/start').status_code == 200
    assert client.post('/operator/api/camera/stop').status_code == 200
    assert client.get('/operator/api/camera').status_code == 200



def test_camera_start_rejects_a_non_numeric_index(client, missions, monkeypatch):
    """The index is the one caller-supplied value near a subprocess. It never
    reaches a command line, but it is still validated rather than trusted."""
    called = []
    monkeypatch.setattr(camera, 'api_camera_start', camera.api_camera_start)
    import camera_control
    monkeypatch.setattr(camera_control, 'start', lambda camera_index=None: called.append(1) or (True, 'ok'))

    resp = client.post('/operator/api/camera/start', json={'cameraIndex': '; rm -rf /'})

    assert resp.status_code == 400
    assert called == [], 'nothing should have been started'



def test_camera_start_rejects_an_out_of_range_index(client, missions):
    assert client.post('/operator/api/camera/start', json={'cameraIndex': 99}).status_code == 400
    assert client.post('/operator/api/camera/start', json={'cameraIndex': -1}).status_code == 400



def test_camera_start_reports_a_failure_rather_than_claiming_success(client, missions, monkeypatch):
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

    data = client.get('/operator/api/config/tunables').get_json()

    assert data['values']['cameraReadyTimeout'] == 2.0
    assert data['limits']['cameraReadyTimeout'] == [0.5, 30.0]



def test_tunables_endpoint_saves_and_takes_effect_without_a_restart(client, missions):
    """This read the value back through console.auth.session_max_age(), which
    went with the login. tunables.get is the reader now, and it is the one that
    matters: the point of moving these off environment variables was that a
    change applies without restarting a box nobody restarts on purpose."""
    resp = client.post('/operator/api/config/tunables', json={'cameraReadyTimeout': 4.5})

    assert resp.status_code == 200
    assert resp.get_json()['values']['cameraReadyTimeout'] == 4.5
    assert tunables.get('cameraReadyTimeout') == 4.5



def test_tunables_endpoint_clamps_rather_than_accepting_nonsense(client, missions):

    body = client.post('/operator/api/config/tunables', json={'cameraReadyTimeout': 0.01}).get_json()

    assert body['values']['cameraReadyTimeout'] == 0.5



def test_tunables_endpoint_refuses_unknown_keys(client, missions):
    """Fed straight into a config file, so a caller must not invent keys."""

    resp = client.post('/operator/api/config/tunables', json={'sneaky': 1})

    assert resp.status_code == 400
    assert 'Unknown setting' in resp.get_json()['error']



def test_tunables_are_readable_and_writable_without_a_login(client, missions):
    """This used to assert 401.

    The gate was doing visible harm rather than the invisible good it was for:
    Settings reads this on load, so a signed-out console rendered every tunable
    as an empty box with nothing saying why. Half the page looked broken.

    Same call as the rover URL and camera control. These are field-tuning knobs
    on a LAN-only box that has to work with no internet, and require_operator
    means a Firebase sign-in.
    """
    read = client.get('/operator/api/config/tunables')

    assert read.status_code == 200
    assert read.get_json()['values'], 'the page needs values to render'

    written = client.post('/operator/api/config/tunables', json={'cameraReadyTimeout': 3.0})

    assert written.status_code == 200



def test_tunables_still_refuse_a_setting_they_do_not_know(client, missions):
    """Dropping the login did not drop the validation, which is what actually
    stops this endpoint being written with nonsense."""
    resp = client.post('/operator/api/config/tunables', json={'notASetting': 1})

    assert resp.status_code == 400


