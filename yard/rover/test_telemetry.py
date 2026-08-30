"""
Telemetry is inverted: the rover depends on an interface, not on a vendor.

The failure that motivated this was a rover that could not boot because an
analytics package was missing. These tests are mostly about that: whatever
telemetry does or does not do, the rover runs.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from telemetry import (  # noqa: E402
    Telemetry,
    NullTelemetry,
    PostHogTelemetry,
    create_telemetry,
)


@pytest.fixture(autouse=True)
def clear_config(monkeypatch):
    monkeypatch.delenv('POSTHOG_PROJECT_TOKEN', raising=False)
    monkeypatch.delenv('POSTHOG_HOST', raising=False)


class RecordingTelemetry(Telemetry):
    """What a test injects. That this is easy to write is the point."""

    def __init__(self):
        self.events = []
        self.errors = []
        self.shutdowns = 0

    def capture(self, event, properties=None):
        self.events.append((event, properties))

    def capture_exception(self, error):
        self.errors.append(error)

    def shutdown(self):
        self.shutdowns += 1


class TestTheDefault:
    def test_no_configuration_gives_a_telemetry_that_does_nothing(self):
        # A rover nobody pointed at an analytics project is the normal case,
        # not an error.
        assert isinstance(create_telemetry(), NullTelemetry)

    def test_the_null_backend_never_raises(self):
        # These calls sit on the path that queues instructions and fires the
        # emergency stop. Nothing here may throw.
        null = NullTelemetry()
        null.capture('anything', {'a': 1})
        null.capture_exception(RuntimeError('boom'))
        null.shutdown()
        null.shutdown()

    def test_it_satisfies_the_interface(self):
        assert isinstance(NullTelemetry(), Telemetry)


class TestWhenTheVendorIsMissing:
    def test_configured_but_not_installed_falls_back_rather_than_raising(
        self, monkeypatch, capsys,
    ):
        """The bug this whole change came from.

        A hard import of posthog meant the rover could not start without the
        package. Now a missing package costs the metrics, not the rover.
        """
        monkeypatch.setenv('POSTHOG_PROJECT_TOKEN', 'ph_token')
        monkeypatch.setenv('POSTHOG_HOST', 'https://eu.i.posthog.com')

        real_import = __builtins__['__import__'] if isinstance(__builtins__, dict) else __builtins__.__import__

        def blocked(name, *args, **kwargs):
            if name == 'posthog' or name.startswith('posthog.'):
                raise ImportError('simulated: posthog not installed')
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr('builtins.__import__', blocked)

        backend = create_telemetry()

        assert isinstance(backend, NullTelemetry)
        # And it says so once, rather than failing silently.
        assert 'not installed' in capsys.readouterr().out


class TestMisconfiguration:
    def test_half_a_configuration_is_loud_in_debug(self, monkeypatch):
        # A typo that would send events nowhere is worth stopping for while
        # developing.
        monkeypatch.setenv('POSTHOG_PROJECT_TOKEN', 'ph_token')

        with pytest.raises(RuntimeError, match='POSTHOG_HOST'):
            create_telemetry(debug=True)

    def test_half_a_configuration_is_tolerated_outside_debug(self, monkeypatch):
        # In production, refusing to start the rover over an analytics typo is
        # the worse failure.
        monkeypatch.setenv('POSTHOG_PROJECT_TOKEN', 'ph_token')

        assert isinstance(create_telemetry(debug=False), NullTelemetry)


class TestTheVendorAdapterContainsItsOwnFailures:
    def test_a_backend_that_throws_does_not_reach_the_caller(self):
        """An analytics outage must not look like a failed mission."""

        class Exploding:
            def capture(self, *a, **k):
                raise ConnectionError('analytics down')

            def capture_exception(self, *a, **k):
                raise ConnectionError('analytics down')

            def shutdown(self):
                raise ConnectionError('analytics down')

        backend = PostHogTelemetry.__new__(PostHogTelemetry)
        backend._client = Exploding()

        backend.capture('instruction_queue_submitted', {'instruction_count': 3})
        backend.capture_exception(RuntimeError('boom'))
        backend.shutdown()


class TestInjection:
    def test_the_server_takes_whatever_it_is_given(self):
        """The point of the interface: a test can substitute its own."""
        import rover_server

        recorder = RecordingTelemetry()
        rover_server.create_app(telemetry_backend=recorder)

        assert rover_server.telemetry is recorder
