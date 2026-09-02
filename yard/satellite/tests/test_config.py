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

    def test_nothing_on_settings_asks_for_a_sign_in(self, client):
        """This asserted the opposite one change ago, and the premise moved.

        The setup rows were the last thing on this page behind a login, so
        keeping their prompt was right while /api/integrations was gated. It
        no longer is: every endpoint Settings reads is open, so any sign-in
        prompt left here would point at a door that is not locked.
        """
        page = client.get('/settings').get_data(as_text=True).lower()

        assert 'sign in' not in page
        assert 'sign-in required' not in page

    def test_the_settings_page_reads_only_open_endpoints(self, client):
        """The reason the page can say that: nothing it loads is gated.

        The sync and integrations endpoints were on this list and are gone
        entirely now, along with the Firestore mirror behind them.
        """
        for path in ('/operator/api/config/tunables',
                     '/operator/api/camera'):
            assert client.get(path).status_code == 200, path

    def test_settings_still_reports_a_refused_save(self, client):
        """Dropping the branch must not drop the error handling with it."""
        page = client.get('/settings').get_data(as_text=True)

        assert "data.error || 'Save failed'" in page


class TestConsoleDesignSystem:
    """The two pages that were overhauled, held to what the overhaul decided.

    These are the choices that are easy to undo by accident later, not a
    screenshot test: which colour means "press this", which means "something is
    wrong", and whether a finger can hit the controls.
    """

    def test_the_action_colour_is_not_the_status_colour(self, client):
        """Mars orange was brand, every primary button, AND the neighbour of
        every amber warning. A call to action and a warning strip read as the
        same thing, so neither won. Actions are the teal signal now; orange
        stays on brand chrome."""
        css = client.get('/static/yard-base.css').get_data(as_text=True)

        assert '--signal:' in css
        assert '--ok-weak:' in css and '--warn-weak:' in css and '--bad-weak:' in css

    def test_the_run_station_has_one_filled_action(self, client):
        """Send to rover moves a physical rover. It is the only filled button
        on the page; Import, Download and Copy description are outlines."""
        page = client.get('/run/').get_data(as_text=True)

        assert '.btn.run-primary' in page
        assert 'background: var(--signal)' in page
        assert '.run-desk .btn.primary' in page
        assert 'background: transparent' in page

    def test_send_refuses_until_the_yard_is_ready(self, client):
        """It used to stay enabled while the warning underneath said not to
        run, which is the console contradicting itself at the one moment an
        operator is moving fast."""
        page = client.get('/run/').get_data(as_text=True)

        assert 'function paintGate()' in page
        assert "$('runBtn').disabled = !ready" in page

    def test_the_sequence_is_drawn_as_a_sequence(self, client):
        """Four equally weighted cards in a Z, and the only thing saying which
        came first was the words "Step N"."""
        page = client.get('/run/').get_data(as_text=True)

        assert 'class="spine"' in page
        assert 'class="node-num"' in page

    def test_health_reads_across_the_top_of_settings(self, client):
        """It was a narrow left column of three stacked cards, given a third of
        the width it never needed, with the bottom half empty while the middle
        column scrolled."""
        page = client.get('/settings').get_data(as_text=True)

        assert 'class="health-strip"' in page
        head = page.index('class="health-strip"')
        assert head < page.index('class="settings-grid"'), 'health comes first'

    def test_touch_targets_are_raised_for_a_finger(self, client):
        """The yard is operated from a tablet and these were tuned by eye on a
        laptop: 26px Copy buttons, a 28px Start camera, a 36px select."""
        for path in ('/run/', '/settings'):
            page = client.get(path).get_data(as_text=True)
            assert '@media (pointer: coarse)' in page, path
            assert 'min-height: 44px' in page, path

    def test_hidden_actually_hides(self, client):
        """Every component sets an explicit display, which beats the UA
        stylesheet's [hidden] rule, so el.hidden = true changed nothing and the
        Start camera button sat there on a primed camera."""
        css = client.get('/static/yard-base.css').get_data(as_text=True)

        assert '[hidden] { display: none !important; }' in css

    def test_neither_page_uses_an_em_dash(self, client):
        """A standing rule on this project."""
        for path in ('/run/', '/settings'):
            page = client.get(path).get_data(as_text=True)
            body = page.replace("(value ?? '—')", '')   # the no-value placeholder
            assert '—' not in body, path
            assert '&mdash;' not in body, path


class TestMonitorBacklog:
    """Anything the rover did before the monitor opened arrives through one
    fetch on load; the SSE stream that follows carries only changes.

    That single attempt was the whole safety net. If it failed - a rover blip,
    or the satellite still coming up behind it - the page sat empty until the
    rover next did something, which on an idle yard is a long time and looks
    exactly like a mission going missing.
    """

    def test_the_backlog_fetch_is_retried(self, client):
        page = client.get('/monitor/').get_data(as_text=True)

        assert 'function loadBacklog(attempt)' in page
        assert 'loadBacklog(attempt + 1)' in page

    def test_refresh_reports_failure_so_the_retry_can_see_it(self, client):
        """It used to swallow the error, which left the caller unable to tell a
        successful load from a failed one."""
        page = client.get('/monitor/').get_data(as_text=True)
        body = page[page.index('async refresh()'):]
        body = body[:body.index('updateUI(data) {')]

        assert 'throw e;' in body

    def test_a_slow_poll_backs_the_stream_up(self, client):
        page = client.get('/monitor/').get_data(as_text=True)

        assert 'setInterval(function () { queue.refresh(); }, 15000)' in page


class TestMonitorSimFeed:
    """The simulated rover view, on a page that was opened after the run.

    The sim played from `status.current`, which the rover clears the moment a
    run finishes. So the sequence "send a mission, then open the monitor" drew
    a parked rover on an empty yard, and the TV stayed that way until somebody
    ran the next mission. Two separate faults, both fixed here.
    """

    def test_a_late_subscriber_is_given_the_last_snapshot(self, client):
        """The sim awaits /api/status before it subscribes, so by the time it
        registered, the one snapshot carrying the backlog had already been
        dispatched and it had nothing to replay."""
        page = client.get('/monitor/').get_data(as_text=True)

        assert 'onQueueEvent: (fn) => {' in page
        assert 'if (lastStatus) {' in page

    def test_a_fetched_snapshot_reaches_the_same_subscribers_as_a_pushed_one(self, client):
        """refresh() went straight to updateUI, so the load-time snapshot was
        seen by the queue display and by nothing else."""
        page = client.get('/monitor/').get_data(as_text=True)

        assert 'function dispatchStatus(status)' in page
        assert 'queue.onStatus = dispatchStatus;' in page
        assert 'if (this.onStatus) { this.onStatus(data); }' in page

    def test_the_dispatcher_is_ready_before_the_backlog_is_fetched(self, client):
        """Ordering is the whole fix: a dispatcher installed after the fetch
        would miss exactly the snapshot that matters."""
        page = client.get('/monitor/').get_data(as_text=True)

        assert page.index('queue.onStatus = dispatchStatus;') < page.index('function loadBacklog(attempt)')

    def test_the_sim_falls_back_to_the_last_finished_run(self, client):
        """`current` is empty once a run ends, which is the normal state of a
        yard someone has just walked up to."""
        js = client.get('/static/sim-monitor.js').get_data(as_text=True)

        assert 'function lastRunFrom(status)' in js
        assert "entry.cmd === 'run_python'" in js
        assert 'view.play(previous)' in js

    def test_the_fallback_only_applies_to_the_first_snapshot(self, client):
        """Otherwise every idle poll would restart the last run, and the yard
        would loop one mission forever."""
        js = client.get('/static/sim-monitor.js').get_data(as_text=True)

        assert 'let seenAnything = false;' in js
        assert 'if (!seenAnything) {' in js
