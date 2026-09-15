"""One set of expectations, run against both rover drivers.

AGENTS.md cites RealRoverDriver and FakeRoverDriver as this repository's
Liskov substitution example: the simulator is the same server with the fake
underneath, so "switch to the simulator" is a button. That only holds if the
fake behaves like the rover, and for most of the project nothing checked. The
fake printed and recorded nothing, and the steering fault lived in exactly that
gap - the real driver straightened its wheels before driving, and nothing could
see whether the stand-in did.

Every test here runs twice. The real driver drives a recording stand-in for the
4tronix library, so it is judged on what it asks the hardware to do; the fake
is judged on the state it keeps. Both must leave the wheels in the same place
and the motors doing the same thing.

Wheel angles are written out as literals, not imported from drivers.py, so a
wrong table cannot make both drivers wrong together and still pass.
"""

import sys

import pytest

from drivers import FakeRoverDriver, RealRoverDriver, RoverDriver
from service import RoverQueueService

STRAIGHT = {9: 0, 11: 0, 13: 0, 15: 0}
PIVOT = {9: 50, 11: -50, 13: 50, 15: -50}


class RecordingRoverLibrary:
    """Where the wheels point and what the motors do, as the library leaves them."""

    def __init__(self):
        self.wheels = {}
        self.motion = None

    def init(self, brightness):
        pass

    def setServo(self, channel, degrees):
        self.wheels[channel] = degrees

    def forward(self, speed):
        self.motion = ('forward', speed)

    def reverse(self, speed):
        self.motion = ('reverse', speed)

    def spinLeft(self, speed):
        self.motion = ('spinLeft', speed)

    def spinRight(self, speed):
        self.motion = ('spinRight', speed)

    def stop(self):
        self.motion = None

    def cleanup(self):
        pass

    def fromRGB(self, r, g, b):
        return (r, g, b)

    def setPixel(self, i, colour):
        pass

    def show(self):
        pass


@pytest.fixture(params=['fake', 'real'])
def rover(request, monkeypatch):
    """(driver, observe): observe() is (wheels, motion), however that driver keeps them."""
    if request.param == 'fake':
        driver = FakeRoverDriver()
        state = lambda: (driver.wheels, driver.motion)  # noqa: E731
    else:
        library = RecordingRoverLibrary()
        monkeypatch.setitem(sys.modules, 'rover', library)
        driver = RealRoverDriver()
        state = lambda: (library.wheels, library.motion)  # noqa: E731

    def observe():
        wheels, motion = state()
        return {servo: wheels.get(servo) for servo in STRAIGHT}, motion

    yield driver, observe
    driver.cleanup()


class TestTheSameMotion:
    def test_forward_drives_with_the_wheels_straight(self, rover):
        driver, observe = rover
        driver.forward(60)
        assert observe() == (STRAIGHT, ('forward', 60))

    def test_reverse_drives_with_the_wheels_straight(self, rover):
        driver, observe = rover
        driver.reverse(45)
        assert observe() == (STRAIGHT, ('reverse', 45))

    def test_spin_left_pivots_the_wheels(self, rover):
        driver, observe = rover
        driver.spin_left(70)
        assert observe() == (PIVOT, ('spinLeft', 70))

    def test_spin_right_pivots_the_wheels(self, rover):
        driver, observe = rover
        driver.spin_right(70)
        assert observe() == (PIVOT, ('spinRight', 70))

    @pytest.mark.parametrize('degrees', [10, 25, 40])
    def test_steer_left_angles_front_and_rear_opposite_ways(self, rover, degrees):
        driver, observe = rover
        driver.steer_left(degrees, 60)
        assert observe() == (
            {9: -degrees, 15: -degrees, 11: degrees, 13: degrees}, ('forward', 60))

    @pytest.mark.parametrize('degrees', [10, 25, 40])
    def test_steer_right_angles_front_and_rear_opposite_ways(self, rover, degrees):
        driver, observe = rover
        driver.steer_right(degrees, 60)
        assert observe() == (
            {9: degrees, 15: degrees, 11: -degrees, 13: -degrees}, ('forward', 60))

    def test_forward_after_a_spin_straightens_the_wheels_first(self, rover):
        """The steering fault, stated as a contract rather than a driver detail."""
        driver, observe = rover
        driver.spin_left(60)
        driver.forward(60)
        assert observe() == (STRAIGHT, ('forward', 60))

    def test_stop_halts_the_motors_and_straightens_the_wheels(self, rover):
        driver, observe = rover
        driver.steer_left(30, 60)
        driver.stop()
        assert observe() == (STRAIGHT, None)


class TestTheSameSpeedRange:
    @pytest.mark.parametrize('speed', [0, 100, 55.5])
    def test_a_speed_inside_the_range_is_driven(self, rover, speed):
        driver, observe = rover
        driver.forward(speed)
        assert observe()[1] == ('forward', speed)

    @pytest.mark.parametrize('command', ['forward', 'reverse', 'spin_left', 'spin_right'])
    @pytest.mark.parametrize('speed', [-1, 101, 500, '60', True, None])
    def test_a_speed_outside_the_range_is_refused_before_anything_moves(
            self, rover, command, speed):
        driver, observe = rover
        before = observe()

        with pytest.raises(ValueError):
            getattr(driver, command)(speed)

        assert observe() == before

    @pytest.mark.parametrize('command', ['steer_left', 'steer_right'])
    def test_steering_refuses_a_bad_speed_too(self, rover, command):
        driver, observe = rover
        before = observe()

        with pytest.raises(ValueError):
            getattr(driver, command)(20, 101)

        assert observe() == before


def test_a_new_driver_inherits_the_speed_check_without_writing_it():
    """Why the check lives on RoverDriver rather than in each implementation.

    A third driver - a different rover, a network simulator - implements the
    underscore methods and gets the range for nothing. It has no way to
    receive a speed the base class refused.
    """
    started = []

    class Minimal(RoverDriver):
        hardware = False

        def _forward(self, speed):
            started.append(speed)

        _reverse = _spin_left = _spin_right = _forward

        def _steer_left(self, degrees, speed):
            started.append(speed)

        _steer_right = _steer_left

        def stop(self):
            pass

        def set_leds(self, pattern):
            pass

        def cleanup(self):
            pass

    with pytest.raises(ValueError):
        Minimal().forward(101)
    assert started == []


def test_the_queue_reports_a_refused_speed_rather_than_driving_it():
    driver = FakeRoverDriver()
    service = RoverQueueService(driver=driver)
    instruction = {
        'id': 'x', 'cmd': 'forward',
        'params': {'speed': 150, 'seconds': 0.0}, 'status': 'pending',
    }
    try:
        service._execute_instruction(instruction)
    finally:
        service.cleanup()

    assert instruction['status'] == 'error'
    assert 'Speed must be a number from 0 to 100' in instruction['error']
    assert driver.motion is None
