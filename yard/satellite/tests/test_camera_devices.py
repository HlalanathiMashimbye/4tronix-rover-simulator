"""
Naming the cameras so Settings can offer a list instead of a number.

AVFoundation only exists on a Mac, so it is faked here with a module that
answers the one discovery call camera_devices makes. What matters is the
contract Settings relies on: names in index order on a Mac, None (keep the
number field) anywhere names cannot be had, and no device ever opened.
"""

import sys
import os
import types

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import camera_devices  # noqa: E402
from web_server import app as flask_app  # noqa: E402
import operator_console  # noqa: F401,E402


class _Device:
    def __init__(self, name):
        self._name = name

    def localizedName(self):
        return self._name


def _fake_avfoundation(names):
    mod = types.ModuleType('AVFoundation')
    mod.AVMediaTypeVideo = 'vide'
    mod.AVCaptureDeviceTypeBuiltInWideAngleCamera = 'builtin'
    mod.AVCaptureDeviceTypeExternalUnknown = 'external'

    class Session:
        @staticmethod
        def discoverySessionWithDeviceTypes_mediaType_position_(types_, media, pos):
            s = Session()
            s._devices = [_Device(n) for n in names]
            return s

        def devices(self):
            return self._devices

    mod.AVCaptureDeviceDiscoverySession = Session
    return mod


@pytest.fixture
def on_a_mac(monkeypatch):
    monkeypatch.setattr(camera_devices.sys, 'platform', 'darwin')

    def install(names):
        monkeypatch.setitem(sys.modules, 'AVFoundation', _fake_avfoundation(names))
    return install


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv('SATELLITE_CONFIG', str(tmp_path / 'satellite_config.json'))
    flask_app.config['TESTING'] = True
    with flask_app.test_client() as c:
        yield c


def test_a_mac_lists_its_cameras_by_name_in_index_order(on_a_mac):
    on_a_mac(['FaceTime HD Camera', 'iPhone Camera', 'Desk View Camera'])
    assert camera_devices.list_cameras() == [
        {'index': 0, 'name': 'FaceTime HD Camera'},
        {'index': 1, 'name': 'iPhone Camera'},
        {'index': 2, 'name': 'Desk View Camera'},
    ]


def test_a_mac_with_no_camera_is_an_empty_list_not_unknown(on_a_mac):
    on_a_mac([])
    assert camera_devices.list_cameras() == []


def test_a_mac_without_pyobjc_cannot_name_its_cameras(monkeypatch):
    monkeypatch.setattr(camera_devices.sys, 'platform', 'darwin')
    # None in sys.modules makes the import raise ImportError.
    monkeypatch.setitem(sys.modules, 'AVFoundation', None)
    assert camera_devices.list_cameras() is None


def test_the_pi_never_asks_avfoundation(monkeypatch):
    """Even if something named AVFoundation were importable on Linux, the Pi
    keeps its number field: index 0 is its only camera."""
    monkeypatch.setattr(camera_devices.sys, 'platform', 'linux')
    monkeypatch.setitem(sys.modules, 'AVFoundation', _fake_avfoundation(['x']))
    assert camera_devices.list_cameras() is None


def test_listing_never_opens_a_device(on_a_mac, monkeypatch):
    """Opening a camera to look at it fights the live stream for the device.
    David's fallback did exactly that; this must not."""
    on_a_mac(['FaceTime HD Camera'])
    opened = []
    fake_cv2 = types.ModuleType('cv2')
    fake_cv2.VideoCapture = lambda *a, **k: opened.append(a)
    monkeypatch.setitem(sys.modules, 'cv2', fake_cv2)
    camera_devices.list_cameras()
    assert opened == []


def test_the_route_offers_the_names(client, on_a_mac):
    on_a_mac(['FaceTime HD Camera', 'iPhone Camera'])
    data = client.get('/operator/api/camera/devices').get_json()
    assert data == {'available': True, 'devices': [
        {'index': 0, 'name': 'FaceTime HD Camera'},
        {'index': 1, 'name': 'iPhone Camera'},
    ]}


def test_the_route_says_unavailable_where_names_cannot_be_had(client, monkeypatch):
    monkeypatch.setattr(camera_devices.sys, 'platform', 'linux')
    resp = client.get('/operator/api/camera/devices')
    assert resp.status_code == 200
    assert resp.get_json() == {'available': False, 'devices': []}


def test_the_route_tells_a_mac_with_no_camera_from_a_machine_that_cannot_say(client, on_a_mac):
    on_a_mac([])
    assert client.get('/operator/api/camera/devices').get_json() == {
        'available': True, 'devices': []}


def _restore_with(monkeypatch, tmp_path, cfg, env=None):
    import web_server
    path = tmp_path / 'satellite_config.json'
    path.write_text(__import__('json').dumps(cfg))
    monkeypatch.setattr(web_server, 'CONFIG_FILE', str(path))
    if env is None:
        monkeypatch.delenv('CAMERA_INDEX', raising=False)
    else:
        monkeypatch.setenv('CAMERA_INDEX', env)
    web_server._restore_camera_index()
    return os.environ.get('CAMERA_INDEX')


def test_the_chosen_camera_survives_a_restart(monkeypatch, tmp_path):
    """Settings saved camera_index and nothing read it back, so a picked
    camera lasted only until the satellite restarted."""
    assert _restore_with(monkeypatch, tmp_path, {'camera_index': 2}) == '2'


def test_a_saved_choice_beats_the_environment_like_the_rover_url(monkeypatch, tmp_path):
    assert _restore_with(monkeypatch, tmp_path, {'camera_index': 1}, env='0') == '1'


@pytest.mark.parametrize('bad', ['1; rm -rf /', 99, -1, True, None])
def test_a_damaged_saved_index_is_ignored(monkeypatch, tmp_path, bad):
    assert _restore_with(monkeypatch, tmp_path, {'camera_index': bad}, env='0') == '0'


def test_starting_the_web_server_restores_it(tmp_path):
    """The function is only half of it: it has to run when the server starts.
    A fresh interpreter, because this suite imported web_server long ago."""
    import json
    import subprocess
    cfg = tmp_path / 'satellite_config.json'
    cfg.write_text(json.dumps({'camera_index': 3}))
    env = {k: v for k, v in os.environ.items() if k != 'CAMERA_INDEX'}
    env['SATELLITE_CONFIG'] = str(cfg)
    out = subprocess.run(
        [sys.executable, '-c', 'import os, web_server; print(os.environ.get("CAMERA_INDEX"))'],
        cwd=os.path.join(os.path.dirname(__file__), '..'),
        env=env, capture_output=True, text=True, timeout=60,
    )
    assert out.stdout.strip().splitlines()[-1] == '3', out.stderr
