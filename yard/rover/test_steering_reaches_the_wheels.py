"""Steering has to survive the throttle command that follows it.

THE FAULT THIS EXISTS FOR. The idiom every steering mission is built from -
the one the Blockly generator emits and parseRoverCode documents - is:

    rover.setServo(9, -20)   # angle the wheels
    rover.forward(60)        # drive
    time.sleep(2)

forward() used to recentre all four steering servos on entry. So the second
line threw away the first, every steering mission drove in a straight line on
hardware, and the browser simulator drew a curve nobody could reproduce in the
yard. Nothing caught it because no test ever ran the vendored library and no
test compared it to the simulator.

Both halves are checked here: the library must leave the wheels alone, and the
driver must straighten them itself when straight is what it means.
"""

import sys
import types

import pytest


# ---------------------------------------------------------------------------
# Loading the real vendored rover.py off a Pi
# ---------------------------------------------------------------------------

class _Anything:
    """Stands in for any hardware object, for any call, returning itself."""

    def __init__(self, *a, **k):
        pass

    def __call__(self, *a, **k):
        return _Anything()

    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        return _Anything()


class _StubModule(types.ModuleType):
    # `from rpi_ws281x import *` reads __all__, so it has to be a real list.
    __all__: list = []

    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        return _Anything()


@pytest.fixture
def rover_lib(monkeypatch):
    """The actual yard/rover/vendor/rover.py, with the Pi's hardware stubbed.

    Imported for real rather than re-implemented: the whole point is to assert
    what the code on the rover does, and a hand-written stand-in would only
    assert what this test file believes.
    """
    import os

    for name in ['RPi', 'RPi.GPIO', 'rpi_ws281x', 'smbus', 'pca9685']:
        monkeypatch.setitem(sys.modules, name, _StubModule(name))
    sys.modules['RPi'].GPIO = sys.modules['RPi.GPIO']
    monkeypatch.delitem(sys.modules, 'rover', raising=False)

    vendor = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor')
    monkeypatch.syspath_prepend(vendor)
    import rover

    # init() is what normally creates these; it needs real I2C, so the motor
    # PWM channels are filled in directly. Nothing here asserts on them.
    for channel in ['p', 'q', 'a', 'b']:
        monkeypatch.setattr(rover, channel, _Anything(), raising=False)
    monkeypatch.setattr(rover, 'lDir', 0, raising=False)
    monkeypatch.setattr(rover, 'rDir', 0, raising=False)

    yield rover
    monkeypatch.delitem(sys.modules, 'rover', raising=False)


@pytest.fixture
def servo_writes(rover_lib, monkeypatch):
    """Every (channel, degrees) the library asks the servo driver for."""
    written = []
    monkeypatch.setattr(
        rover_lib, 'setServo', lambda channel, degrees: written.append((channel, degrees)))
    return written


STEERING_CHANNELS = {9, 11, 13, 15}


class TestTheLibraryLeavesTheWheelsAlone:
    def test_forward_does_not_move_the_steering_servos(self, rover_lib, servo_writes):
        """The regression itself. Fails the moment forward() recentres again."""
        rover_lib.forward(60)

        assert [w for w in servo_writes if w[0] in STEERING_CHANNELS] == []

    def test_reverse_does_not_move_the_steering_servos(self, rover_lib, servo_writes):
        rover_lib.reverse(60)

        assert [w for w in servo_writes if w[0] in STEERING_CHANNELS] == []

    @pytest.mark.parametrize('degrees', [-45, -20, -1, 1, 20, 45])
    def test_a_steer_survives_the_forward_that_follows_it(
            self, rover_lib, servo_writes, degrees):
        """The learner's own idiom, at angles a learner would actually pick.

        A range rather than one value because a check that only ever sees 20
        would still pass against a forward() that clamped every steer to 20.
        """
        rover_lib.setServo(9, -degrees)
        rover_lib.setServo(15, -degrees)
        rover_lib.setServo(11, degrees)
        rover_lib.setServo(13, degrees)
        servo_writes.clear()

        rover_lib.forward(60)

        assert servo_writes == [], (
            f'forward(60) overwrote the {degrees} degree steer: {servo_writes}')

    def test_spin_still_pivots_the_wheels(self, rover_lib, servo_writes):
        """Spin keeps setting its own geometry - without it, spin is not spin.

        This is the behaviour the recentring was originally added to protect,
        and it has to survive the fix that removed the recentring.
        """
        rover_lib.spinLeft(60)

        assert dict(servo_writes) == {9: 50, 15: -50, 11: -50, 13: 50}


# ---------------------------------------------------------------------------
# The driver half
# ---------------------------------------------------------------------------

class FakeRoverModule:
    """Records what RealRoverDriver asks the rover library to do, in order."""

    def __init__(self):
        self.calls = []
        self.servos = {}

    def init(self, brightness):
        self.calls.append(('init', brightness))

    def setServo(self, channel, degrees):
        self.calls.append(('setServo', channel, degrees))
        self.servos[channel] = degrees

    def forward(self, speed):
        self.calls.append(('forward', speed))

    def reverse(self, speed):
        self.calls.append(('reverse', speed))

    def spinLeft(self, speed):
        self.calls.append(('spinLeft', speed))

    def spinRight(self, speed):
        self.calls.append(('spinRight', speed))

    def stop(self):
        self.calls.append(('stop',))

    def cleanup(self):
        self.calls.append(('cleanup',))

    def fromRGB(self, r, g, b):
        return (r, g, b)

    def setPixel(self, i, colour):
        pass

    def show(self):
        pass


@pytest.fixture
def driver(monkeypatch):
    from drivers import RealRoverDriver

    fake = FakeRoverModule()
    monkeypatch.setitem(sys.modules, 'rover', fake)
    made = RealRoverDriver()
    made.rover = fake
    return made


class TestTheDriverSaysWhatItMeans:
    def test_manual_forward_straightens_the_wheels_itself(self, driver):
        """The library no longer does it, so the driver has to.

        Otherwise a manual forward straight after a manual spin drives off
        with the wheels still pivoted at 50 degrees.
        """
        driver.spin_left(60)
        driver.rover.calls.clear()

        driver.forward(60)

        assert driver.rover.servos == {9: 0, 11: 0, 13: 0, 15: 0}

    def test_straightening_happens_before_the_motors_start(self, driver):
        """Order matters: setting the angle after the motors are running
        makes the rover lurch off crooked and then correct itself."""
        driver.forward(60)

        names = [c[0] for c in driver.rover.calls]
        assert names.index('setServo') < names.index('forward')

    @pytest.mark.parametrize('degrees', [10, 25, 40])
    def test_manual_steer_leaves_the_wheels_angled(self, driver, degrees):
        """The manual-control half of the same regression.

        RealRoverDriver.steer_left sets four servos and then calls
        rover.forward(), which used to undo all four one line later.
        """
        driver.steer_left(degrees, 60)

        assert driver.rover.servos == {9: -degrees, 15: -degrees,
                                       11: degrees, 13: degrees}

    @pytest.mark.parametrize('degrees', [10, 25, 40])
    def test_manual_steer_right_leaves_the_wheels_angled(self, driver, degrees):
        driver.steer_right(degrees, 60)

        assert driver.rover.servos == {9: degrees, 15: degrees,
                                       11: -degrees, 13: -degrees}
