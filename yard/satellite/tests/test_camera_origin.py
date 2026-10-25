"""The camera stream only plays on the satellite's own pages.

The stream films children, so a browser on the yard's wifi must not be able to
open a live view of it from another site. The handshake is guarded by its
Origin: the decision is a pure function, pinned here for the three cases the
brief names (foreign refused, own page accepted, no origin accepted), and the
websockets hook is driven with a stand-in connection to confirm it turns that
decision into a 403 or a pass.
"""

import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import camera_server

WEB_PORT = 3001
CAMERA_HOST = 'mro.local:8890'


def test_a_foreign_origin_is_refused():
    assert not camera_server.origin_is_allowed(CAMERA_HOST, 'https://evil.example', WEB_PORT)


def test_the_satellite_own_page_is_allowed():
    assert camera_server.origin_is_allowed(CAMERA_HOST, 'http://mro.local:3001', WEB_PORT)


def test_a_handshake_with_no_origin_is_allowed():
    # The recording consumer and the readiness probe are not browsers.
    assert camera_server.origin_is_allowed(CAMERA_HOST, None, WEB_PORT)


def test_a_page_loaded_by_ip_is_allowed():
    assert camera_server.origin_is_allowed('192.168.1.5:8890', 'http://192.168.1.5:3001', WEB_PORT)


def test_the_camera_port_is_not_the_web_port():
    # An Origin on this server's own port is still not a page: pages come from
    # the web port, so this is refused.
    assert not camera_server.origin_is_allowed(CAMERA_HOST, 'http://mro.local:8890', WEB_PORT)


class _FakeConnection:
    def __init__(self):
        self.rejected_with = None

    def respond(self, status, text):
        self.rejected_with = (status, text)
        return ('response', status)


def _request(headers):
    return SimpleNamespace(headers=headers)


def test_the_hook_refuses_a_foreign_origin(monkeypatch):
    monkeypatch.setenv('SATELLITE_PORT', '3001')
    connection = _FakeConnection()

    result = camera_server.reject_foreign_origin(
        connection, _request({'Host': CAMERA_HOST, 'Origin': 'https://evil.example'}))

    assert result is not None, 'a foreign handshake must be refused'
    assert connection.rejected_with[0] == 403


def test_the_hook_lets_the_satellites_own_page_through(monkeypatch):
    monkeypatch.setenv('SATELLITE_PORT', '3001')
    connection = _FakeConnection()

    result = camera_server.reject_foreign_origin(
        connection, _request({'Host': CAMERA_HOST, 'Origin': 'http://mro.local:3001'}))

    assert result is None
    assert connection.rejected_with is None
