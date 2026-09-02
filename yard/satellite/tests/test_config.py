"""
Tests for the runtime rover-URL config endpoint POST /api/config/rover_url.
"""

import time
import sys
import os
import json
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import web_server


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Test client with config writes redirected to a temp file and the
    ROVER_URL global restored afterwards."""
    monkeypatch.setattr(web_server, 'CONFIG_FILE', str(tmp_path / 'satellite_config.json'))
    original_url = web_server.ROVER_URL
    web_server.app.config['TESTING'] = True
    with web_server.app.test_client() as client:
        # Repointing the rover is now an operator action; these tests exercise
        # the endpoint's behaviour, not its gate (see the auth test below).
        with client.session_transaction() as sess:
            now = time.time()
            sess['operator'] = {
                'uid': 'op-1', 'email': 'op@test.com', 'role': 'operator',
                # A session without these is treated as expired; see
                # current_operator in operator_console.
                'signed_in_at': now, 'checked_at': now,
            }
        yield client
    web_server.ROVER_URL = original_url


def test_set_rover_url(client):
    resp = client.post('/api/config/rover_url', json={'url': 'http://curiosity.local:8523'})
    data = resp.get_json()

    assert resp.status_code == 200
    assert data['rover_url'] == 'http://curiosity.local:8523'
    assert data['persisted'] is True
    assert web_server.ROVER_URL == 'http://curiosity.local:8523'


def test_set_rover_url_strips_trailing_slash(client):
    resp = client.post('/api/config/rover_url', json={'url': 'http://curiosity.local:8523/'})

    assert resp.get_json()['rover_url'] == 'http://curiosity.local:8523'


def test_set_rover_url_persists_to_config_file(client):
    client.post('/api/config/rover_url', json={'url': 'http://10.0.0.7:8523'})

    with open(web_server.CONFIG_FILE) as f:
        assert json.load(f)['rover_url'] == 'http://10.0.0.7:8523'


def test_saved_url_used_by_api_status(client, monkeypatch):
    client.post('/api/config/rover_url', json={'url': 'http://10.0.0.7:8523'})

    captured = {}

    def fake_get(url, **kwargs):
        captured['url'] = url
        raise web_server.requests.exceptions.ConnectionError('offline')

    monkeypatch.setattr(web_server.requests, 'get', fake_get)
    data = client.get('/api/status').get_json()

    assert captured['url'] == 'http://10.0.0.7:8523/health'
    assert data['rover']['url'] == 'http://10.0.0.7:8523'


@pytest.mark.parametrize('bad', ['', 'curiosity.local:8523', 'ftp://x', 'http://', None])
def test_invalid_url_rejected(client, bad):
    resp = client.post('/api/config/rover_url', json={'url': bad})

    assert resp.status_code == 400
    assert 'error' in resp.get_json()


def test_load_config_precedence(tmp_path, monkeypatch):
    """A saved config value wins over the environment default on startup"""
    cfg = tmp_path / 'satellite_config.json'
    cfg.write_text(json.dumps({'rover_url': 'http://saved.local:8523'}))
    monkeypatch.setattr(web_server, 'CONFIG_FILE', str(cfg))

    assert web_server._load_config().get('rover_url') == 'http://saved.local:8523'


def test_rover_url_can_be_changed_without_a_login(tmp_path, monkeypatch):
    """This used to assert 401.

    The gate was there because repointing the rover is a control action on an
    open venue network. The problem is that require_operator means a Firebase
    sign-in, which means internet, and the field edit this endpoint exists for
    is the one an operator makes when the rover has moved - exactly when the
    wifi is least likely to work. Same call as camera start: on a box built to
    work offline, a gate that bites only when the network is down protects
    nothing worth the cost.
    """
    monkeypatch.setattr(web_server, 'CONFIG_FILE', str(tmp_path / 'satellite_config.json'))
    monkeypatch.delenv('OPERATOR_AUTH', raising=False)
    web_server.app.config['TESTING'] = True

    with web_server.app.test_client() as anon:
        resp = anon.post('/api/config/rover_url', json={'url': 'http://newrover.local:8523'})

    assert resp.status_code == 200
    assert web_server.ROVER_URL == 'http://newrover.local:8523'


def test_rover_url_is_still_validated_without_a_login(tmp_path, monkeypatch):
    """Dropping the login did not drop the checks. Validation is the control
    that actually stops this endpoint being pointed at nonsense, and it never
    depended on who was asking."""
    monkeypatch.setattr(web_server, 'CONFIG_FILE', str(tmp_path / 'satellite_config.json'))
    monkeypatch.delenv('OPERATOR_AUTH', raising=False)
    original_url = web_server.ROVER_URL
    web_server.app.config['TESTING'] = True

    with web_server.app.test_client() as anon:
        resp = anon.post('/api/config/rover_url', json={'url': 'javascript:alert(1)'})

    assert resp.status_code == 400
    assert web_server.ROVER_URL == original_url, 'the URL must not have changed'


def test_the_monitor_does_not_hardcode_the_camera_host(client):
    """The camera websocket URL was pinned to ws://mro.local:8890, so the feed
    only worked for someone reaching the Pi by that exact mDNS name. Opening
    the monitor by IP - or on any dev machine - left it dialling a host that
    does not resolve, sitting on "Connecting..." forever with nothing in the
    UI to say why."""
    page = client.get('/monitor/').get_data(as_text=True)

    assert 'mro.local:8890' not in page, 'the camera host must not be pinned'
    # Derived from wherever the page was served: the camera always runs on the
    # same machine as this web server, on the Pi and in development alike.
    assert 'window.location.hostname' in page
    assert f':{web_server.CAMERA_PORT}`' in page


def test_the_monitor_uses_the_configured_camera_port(client, monkeypatch):
    """CAMERA_PORT is env-tunable, so a page that renders 8890 regardless would
    silently ignore it."""
    monkeypatch.setattr(web_server, 'CAMERA_PORT', 9999)

    page = client.get('/monitor/').get_data(as_text=True)

    assert 'ws://${window.location.hostname}:9999' in page


class TestNoSignInDeadEnds:
    """The console must not tell an operator to sign in for something that
    needs no sign-in, and must not offer a sign-in that cannot work offline.

    Both messages were real: one for the rover path, one for the camera. The
    camera gate had already been removed, so that branch could not fire at all;
    the rover-path one sent the operator to a Firebase login, which needs
    internet, on the one box built to work without it. Its link also rendered
    in the browser default blue at 1.18:1 against this background.
    """

    def test_settings_offers_no_link_to_a_login(self, client):
        page = client.get('/settings').get_data(as_text=True)

        assert 'href="/operator/login"' not in page
        assert 'sign-in required' not in page.lower()

    def test_settings_does_not_ask_for_a_login_to_run_the_camera(self, client):
        page = client.get('/settings').get_data(as_text=True)

        assert 'sign in on the operator console' not in page.lower()

    def test_it_still_says_so_where_a_login_really_is_needed(self, client):
        """The setup rows read /operator/api/integrations, which is still
        gated. Removing two wrong messages must not remove the right one."""
        page = client.get('/settings').get_data(as_text=True)

        assert 'Sign in to see setup status.' in page

    def test_settings_still_reports_a_refused_save(self, client):
        """Dropping the branch must not drop the error handling with it."""
        page = client.get('/settings').get_data(as_text=True)

        assert "data.error || 'Save failed'" in page
