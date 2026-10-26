"""The satellite only takes a state change from its own pages.

The gate lives in same_origin.py and is wired in once in web_server.create_app,
so these tests drive it two ways: the decision function directly (the three
cases the rover's copy must also hold, so the two cannot drift), and the real
routes through the Flask test client, where a cross-site POST must never reach
a handler.
"""

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import same_origin
import satellite_power
import web_server

EVIL = 'https://evil.example'

# The state-changing routes named in the brief, by full path. The walk below
# proves nothing escapes the gate; this list is here so a reader can see which
# routes it is about, and the walk cross-checks that the list has not gone
# stale.
STATE_CHANGING_ROUTES = [
    '/operator/api/satellite/shutdown',
    '/operator/api/camera/start',
    '/operator/api/camera/stop',
    '/operator/api/config/tunables',
    '/operator/api/config/upload-secret',
    '/api/config/rover_url',
    '/api/queue/add',
    '/api/queue/clear',
    '/api/recording/start',
    '/api/recording/stop',
    '/api/recordings/delete',
]


# The three cases the rover's same_origin.is_allowed must answer the same way
# (yard/rover/test_same_origin.py pins the identical set). This is how two
# copies of one rule in two packages are kept from drifting.
def test_the_decision_refuses_cross_site_and_allows_our_own_and_no_browser():
    host = 'mro.local:3001'
    # A page on another site, named by Sec-Fetch-Site or by Origin.
    assert not same_origin.is_allowed('POST', host, 'cross-site', None)
    assert not same_origin.is_allowed('POST', host, None, 'https://evil.example')
    # The satellite's own page.
    assert same_origin.is_allowed('POST', host, 'same-origin', 'http://mro.local:3001')
    # Not a browser at all (the proxy, curl, the tests): no such header.
    assert same_origin.is_allowed('POST', host, None, None)


@pytest.mark.parametrize('path', STATE_CHANGING_ROUTES)
def test_a_cross_site_post_is_refused_for_each_state_changing_route(path):
    client = web_server.app.test_client()

    resp = client.post(path, headers={'Origin': EVIL})

    assert resp.status_code == 403
    assert "satellite's own pages" in resp.get_json()['error']


def test_the_refused_shutdown_never_powers_the_box_off(monkeypatch):
    """The gate runs before the handler, so a refused shutdown never calls it."""
    called = []
    monkeypatch.setattr(satellite_power, 'shut_down',
                        lambda *a, **k: called.append(True) or (True, []))
    client = web_server.app.test_client()

    resp = client.post('/operator/api/satellite/shutdown', headers={'Origin': EVIL})

    assert resp.status_code == 403
    assert not called, 'shut_down must not run for a cross-site request'


def test_a_cross_site_post_named_by_sec_fetch_site_is_refused():
    client = web_server.app.test_client()

    resp = client.post('/operator/api/satellite/shutdown',
                       headers={'Sec-Fetch-Site': 'cross-site'})

    assert resp.status_code == 403


def test_our_own_page_and_a_non_browser_caller_both_pass():
    client = web_server.app.test_client()
    host = {'HTTP_HOST': 'mro.local:3001'}

    same_origin_post = client.post('/operator/api/config/tunables',
                                   json={}, environ_overrides=host,
                                   headers={'Origin': 'http://mro.local:3001'})
    no_header_post = client.post('/operator/api/config/tunables',
                                 json={}, environ_overrides=host)

    assert same_origin_post.status_code != 403
    assert no_header_post.status_code != 403


def test_the_origin_must_match_host_and_port():
    """A page served from another port on the same host is still cross-origin."""
    client = web_server.app.test_client()
    host = {'HTTP_HOST': 'mro.local:3001'}

    right_port = client.post('/operator/api/config/tunables', json={},
                             environ_overrides=host,
                             headers={'Origin': 'http://mro.local:3001'})
    wrong_port = client.post('/operator/api/config/tunables', json={},
                             environ_overrides=host,
                             headers={'Origin': 'http://mro.local:9999'})

    assert right_port.status_code != 403
    assert wrong_port.status_code == 403


def test_gets_are_never_refused():
    client = web_server.app.test_client()

    resp = client.get('/api/health', headers={'Origin': EVIL})

    assert resp.status_code == 200


def _concrete_path(rule):
    """A URL for a rule, with any <converter:name> part filled so it resolves."""
    return re.sub(r'<[^>]+>', 'x', rule.rule)


def test_no_non_get_route_escapes_the_gate():
    """Walk every route: a method that can change state must be refused cross
    site. A route added later with no same-origin thought of its own is caught
    here, because the gate is one hook in front of them all."""
    client = web_server.app.test_client()
    covered = set()

    for rule in web_server.app.url_map.iter_rules():
        changing = rule.methods - same_origin.SAFE_METHODS
        if not changing:
            continue
        path = _concrete_path(rule)
        for method in sorted(changing):
            resp = client.open(path, method=method, headers={'Origin': EVIL})
            assert resp.status_code == 403, f'{method} {path} was not refused'
        covered.add(rule.rule)

    # The hand-listed routes are real and all got walked, so the list cannot
    # quietly fall behind the routes.
    assert set(STATE_CHANGING_ROUTES) <= covered
