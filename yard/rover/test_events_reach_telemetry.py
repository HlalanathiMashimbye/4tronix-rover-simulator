"""The rover's routes report through whatever telemetry they were given."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))

import rover_server  # noqa: E402
from service import RoverQueueService  # noqa: E402
from drivers import FakeRoverDriver  # noqa: E402
from telemetry import Telemetry  # noqa: E402


class Recorder(Telemetry):
    def __init__(self):
        self.events = []

    def capture(self, event, properties=None):
        self.events.append((event, properties))

    def capture_exception(self, error):
        pass

    def shutdown(self):
        pass


@pytest.fixture
def client_and_recorder():
    recorder = Recorder()
    service = RoverQueueService(FakeRoverDriver())
    app = rover_server.create_app(service, telemetry_backend=recorder)
    app.config['TESTING'] = True
    with app.test_client() as c:
        yield c, recorder


def test_queueing_instructions_is_reported(client_and_recorder):
    client, recorder = client_and_recorder

    client.post('/queue/add', json={'instructions': [{'action': 'forward', 'speed': 50}]})

    names = [e for e, _ in recorder.events]
    assert 'instruction_queue_submitted' in names


def test_the_emergency_stop_is_reported(client_and_recorder):
    """The one event worth being sure about: how often a rover was stopped."""
    client, recorder = client_and_recorder

    client.post('/queue/clear')

    names = [e for e, _ in recorder.events]
    assert 'rover_emergency_stop_requested' in names


def test_the_rover_still_works_when_telemetry_does_nothing(client_and_recorder):
    """A rover with no analytics is a rover that still drives."""
    from telemetry import NullTelemetry

    service = RoverQueueService(FakeRoverDriver())
    app = rover_server.create_app(service, telemetry_backend=NullTelemetry())
    app.config['TESTING'] = True

    with app.test_client() as c:
        resp = c.post('/queue/add', json={'instructions': [{'action': 'forward', 'speed': 50}]})
        assert resp.status_code == 200
        assert c.post('/queue/clear').status_code == 200
