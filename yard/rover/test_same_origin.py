"""The rover server only takes a state change from the yard, not a web page.

Same rule as the satellite's same_origin.py, kept in this package because the
two share no code. The decision test below pins the same three cases the
satellite's does, so the two copies cannot drift apart; the integration test
proves a cross-site stop cannot reach the queue, while the satellite's own
proxy call (which carries no Origin) still does.
"""

from datetime import datetime

import pytest

import same_origin
from drivers import FakeRoverDriver
from service import RoverQueueService
from rover_server import app, create_app

EVIL = 'https://evil.example'


@pytest.fixture
def client():
    """A test client with a fake driver and no processor, so what is queued
    stays queued and a clear is visible."""
    service = RoverQueueService(
        driver=FakeRoverDriver(),
        time_provider=lambda: datetime(2024, 1, 15, 12, 0, 0),
        uuid_provider=lambda: 'test-uuid',
    )
    create_app(service)
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client
    service.cleanup()


def test_the_decision_refuses_cross_site_and_allows_our_own_and_no_browser():
    """The same three cases yard/satellite/test_same_origin.py pins, so the two
    copies of the rule answer alike."""
    host = 'curiosity.local:8523'
    assert not same_origin.is_allowed('POST', host, 'cross-site', None)
    assert not same_origin.is_allowed('POST', host, None, 'https://evil.example')
    assert same_origin.is_allowed('POST', host, 'same-origin', 'http://curiosity.local:8523')
    assert same_origin.is_allowed('POST', host, None, None)


def test_a_cross_site_clear_is_refused_and_leaves_the_queue_alone(client):
    client.post('/queue/add', json=[{'cmd': 'forward', 'params': {}},
                                    {'cmd': 'forward', 'params': {}}])
    before = client.get('/queue/status').get_json()['pending_count']

    resp = client.post('/queue/clear', headers={'Origin': EVIL})

    assert resp.status_code == 403
    after = client.get('/queue/status').get_json()['pending_count']
    assert after == before == 2, 'a cross-site clear must not empty the queue'


def test_the_satellite_proxy_call_still_clears_the_queue(client):
    """The proxy posts server-to-server with no Origin, so it is allowed."""
    client.post('/queue/add', json=[{'cmd': 'forward', 'params': {}}])

    resp = client.post('/queue/clear')

    assert resp.status_code == 200
    assert resp.get_json()['cleared'] == 1
