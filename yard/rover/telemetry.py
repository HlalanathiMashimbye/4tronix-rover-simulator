"""
Telemetry for the rover, behind an interface it owns.

WHY THIS EXISTS RATHER THAN CALLING POSTHOG DIRECTLY.

rover_server.py used to import PostHog, read POSTHOG_PROJECT_TOKEN and
POSTHOG_HOST, and call the vendor's methods at each site. That inverts the
dependency the wrong way: the rover's control server, which is the thing that
moves a robot, knew the name of an analytics vendor. Changing vendors meant
editing the server, and a package that failed to install stopped the rover
booting at all.

So the server depends on `Telemetry`, and the vendor depends on `Telemetry`
too. The word "posthog" appears in exactly one class below and nowhere else in
this package. Same shape as drivers.py: a small interface, a real
implementation, a substitute, and a factory that picks between them - which is
already how the rover treats the hardware it cannot assume is present.

NullTelemetry is why the call sites have no `if client is not None` guards
left. Something is always there; sometimes it does nothing.
"""

import os
from abc import ABC, abstractmethod


class Telemetry(ABC):
    """What the rover needs of analytics. Deliberately three methods."""

    @abstractmethod
    def capture(self, event: str, properties: dict = None) -> None:
        """Record that something happened."""

    @abstractmethod
    def capture_exception(self, error: BaseException) -> None:
        """Record an unhandled error."""

    @abstractmethod
    def shutdown(self) -> None:
        """Flush anything buffered. Safe to call more than once."""


class NullTelemetry(Telemetry):
    """Does nothing, successfully.

    The default, and what runs whenever analytics is unconfigured or its
    package is absent. A rover with no telemetry is a rover that still drives:
    nothing here may raise, because these calls sit on the path that queues and
    stops a robot.
    """

    def capture(self, event: str, properties: dict = None) -> None:
        pass

    def capture_exception(self, error: BaseException) -> None:
        pass

    def shutdown(self) -> None:
        pass


class PostHogTelemetry(Telemetry):
    """The one place that knows PostHog exists.

    Every method swallows its own failures. An analytics backend that is down,
    slow, or misbehaving must not surface as a failed mission: these calls are
    made from request handlers that queue instructions and fire the emergency
    stop.
    """

    def __init__(self, project_token: str, host: str):
        from posthog import Posthog  # imported here, so nothing else needs it

        self._client = Posthog(
            project_token,
            host=host,
            enable_exception_autocapture=True,
        )

    def capture(self, event: str, properties: dict = None) -> None:
        try:
            self._client.capture(event, properties=properties or {})
        except Exception as error:
            print(f'[telemetry] capture failed: {error}')

    def capture_exception(self, error: BaseException) -> None:
        try:
            self._client.capture_exception(error)
        except Exception as send_error:
            print(f'[telemetry] capture_exception failed: {send_error}')

    def shutdown(self) -> None:
        try:
            self._client.shutdown()
        except Exception as error:
            print(f'[telemetry] shutdown failed: {error}')


def create_telemetry(debug: bool = False) -> Telemetry:
    """Pick an implementation from the environment. Mirrors create_driver().

    Returns NullTelemetry unless a backend is both configured and installed.

    `debug` preserves the original loud failure: while developing, a half-set
    configuration (one of the two variables) is a typo worth stopping for,
    because the alternative is events silently going nowhere. Absent
    configuration is not an error - it is the normal state of a rover that
    nobody has pointed at an analytics project.
    """
    project_token = os.environ.get('POSTHOG_PROJECT_TOKEN')
    host = os.environ.get('POSTHOG_HOST')

    if project_token and host:
        try:
            return PostHogTelemetry(project_token, host)
        except ImportError:
            # Configured but not installed. Say so once and carry on: the rover
            # matters more than the metrics.
            print('[telemetry] posthog is configured but not installed; '
                  'events will not be sent. Install it with: '
                  'pip install -r requirements.txt')
            return NullTelemetry()

    if (project_token or host) and debug:
        missing = 'POSTHOG_PROJECT_TOKEN' if not project_token else 'POSTHOG_HOST'
        raise RuntimeError(
            f'{missing} is missing while the other half of the PostHog '
            f'configuration is set, so events would be silently dropped. Set '
            f'{missing}, or unset both to run without telemetry.'
        )

    return NullTelemetry()
