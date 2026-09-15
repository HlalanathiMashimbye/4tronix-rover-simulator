"""
Rover Driver Interface and Implementations

Provides abstraction layer for rover hardware control with injectable drivers
for testability (real hardware vs a stand-in that keeps the same state).
"""

import os
import time
import threading
from abc import ABC, abstractmethod

from limits import MAX_ROVER_SPEED, MIN_ROVER_SPEED


# Wheel geometry, shared by both drivers so they cannot disagree about it. The
# steering servos are 9 (front left), 11 (rear left), 13 (rear right) and 15
# (front right).
STRAIGHT = {9: 0, 11: 0, 13: 0, 15: 0}

# Toed in for spinning on the spot.
PIVOT = {9: 50, 15: -50, 11: -50, 13: 50}


def steer_angles(front_degrees: float) -> dict:
    """Front wheels one way and rear wheels the other, as the steer blocks emit.

    Negative front_degrees steers left.
    """
    return {9: front_degrees, 15: front_degrees, 11: -front_degrees, 13: -front_degrees}


def check_speed(speed):
    """The speed, if the rover may be driven at it. ValueError if not.

    The motors take a PWM duty cycle from 0 to 100. The docstrings below said
    "(0-100)" while neither driver checked: the real one passed forward(500)
    straight to the motor library, and the fake printed it.
    """
    if (isinstance(speed, bool) or not isinstance(speed, (int, float))
            or not MIN_ROVER_SPEED <= speed <= MAX_ROVER_SPEED):
        raise ValueError(
            f'Speed must be a number from {MIN_ROVER_SPEED} to {MAX_ROVER_SPEED}, '
            f'got {speed!r}')
    return speed


class RoverDriver(ABC):
    """What every rover driver does, and the rule none of them may skip.

    The motion methods callers use are defined here, once, and check the speed
    before handing over to the implementation's `_forward`, `_spin_left` and so
    on. A new driver implements those and inherits the check, so it cannot
    forget it, and callers cannot tell which driver they were given.
    test_driver_contract.py holds both implementations to the same behaviour.
    """

    # True when the driver moves a physical rover; the status page shows
    # an amber badge when this is False
    hardware = True

    def forward(self, speed: int) -> None:
        """Move forward at given speed (0-100), wheels straight"""
        self._forward(check_speed(speed))

    def reverse(self, speed: int) -> None:
        """Move backward at given speed (0-100), wheels straight"""
        self._reverse(check_speed(speed))

    def spin_left(self, speed: int) -> None:
        """Spin left in place at given speed (0-100)"""
        self._spin_left(check_speed(speed))

    def spin_right(self, speed: int) -> None:
        """Spin right in place at given speed (0-100)"""
        self._spin_right(check_speed(speed))

    def steer_left(self, degrees: float, speed: int) -> None:
        """Steer left while moving forward at given speed (0-100)"""
        self._steer_left(degrees, check_speed(speed))

    def steer_right(self, degrees: float, speed: int) -> None:
        """Steer right while moving forward at given speed (0-100)"""
        self._steer_right(degrees, check_speed(speed))

    @abstractmethod
    def _forward(self, speed: float) -> None:
        """Drive forward. The speed has already been checked."""

    @abstractmethod
    def _reverse(self, speed: float) -> None:
        """Drive backward. The speed has already been checked."""

    @abstractmethod
    def _spin_left(self, speed: float) -> None:
        """Spin left in place. The speed has already been checked."""

    @abstractmethod
    def _spin_right(self, speed: float) -> None:
        """Spin right in place. The speed has already been checked."""

    @abstractmethod
    def _steer_left(self, degrees: float, speed: float) -> None:
        """Steer left while driving. The speed has already been checked."""

    @abstractmethod
    def _steer_right(self, degrees: float, speed: float) -> None:
        """Steer right while driving. The speed has already been checked."""

    @abstractmethod
    def stop(self) -> None:
        """Stop all movement and straighten the wheels"""

    @abstractmethod
    def set_leds(self, pattern: str) -> None:
        """Set LED pattern: 'forward', 'reverse', 'spin_left', 'spin_right', 'stop'"""

    @abstractmethod
    def cleanup(self) -> None:
        """Clean up resources"""


class FakeRoverDriver(RoverDriver):
    """A stand-in that keeps the state a rover would be in, instead of moving one.

    It used to print each command and remember nothing, so the most a test
    built on it could prove was that nothing crashed. The steering fault lived
    in that gap: the real driver straightened the wheels before driving, and
    nothing could see whether this one did. It now keeps the two facts the
    hardware has - where the wheels point, and what the motors are doing - in
    the terms test_driver_contract.py reads off the real driver.

    Still prints each command, because that log is what someone running the
    simulator watches.
    """

    hardware = False

    def __init__(self):
        self.wheels = dict(STRAIGHT)
        # ('forward', 60) and so on, named as the rover library names them.
        # None while stopped.
        self.motion = None
        self.animation_running = False

    def _forward(self, speed: float) -> None:
        print(f"[FAKE] Forward at speed {speed}")
        self.wheels.update(STRAIGHT)
        self.motion = ('forward', speed)

    def _reverse(self, speed: float) -> None:
        print(f"[FAKE] Reverse at speed {speed}")
        self.wheels.update(STRAIGHT)
        self.motion = ('reverse', speed)

    def _spin_left(self, speed: float) -> None:
        print(f"[FAKE] Spin left at speed {speed}")
        self.wheels.update(PIVOT)
        self.motion = ('spinLeft', speed)
        self.animation_running = True

    def _spin_right(self, speed: float) -> None:
        print(f"[FAKE] Spin right at speed {speed}")
        self.wheels.update(PIVOT)
        self.motion = ('spinRight', speed)
        self.animation_running = True

    def _steer_left(self, degrees: float, speed: float) -> None:
        print(f"[FAKE] Steer left {degrees}° at speed {speed}")
        self.wheels.update(steer_angles(-degrees))
        self.motion = ('forward', speed)

    def _steer_right(self, degrees: float, speed: float) -> None:
        print(f"[FAKE] Steer right {degrees}° at speed {speed}")
        self.wheels.update(steer_angles(degrees))
        self.motion = ('forward', speed)

    def stop(self) -> None:
        print("[FAKE] Stop")
        self.motion = None
        self.wheels.update(STRAIGHT)
        self.animation_running = False

    def set_leds(self, pattern: str) -> None:
        print(f"[FAKE] Set LEDs to pattern: {pattern}")

    def cleanup(self) -> None:
        self.motion = None
        self.animation_running = False
        print("[FAKE] Cleanup complete")


class RealRoverDriver(RoverDriver):
    """Real hardware driver - uses rover.py module on Pi"""

    def __init__(self):
        # Import rover module (only available on Pi)
        import rover
        self.rover = rover
        self.rover.init(40)

        self.animation_running = False
        self.animation_thread = None

        # Set initial LED state
        self._set_all_leds_white()

    def _forward(self, speed: float) -> None:
        self._set_leds_forward()
        # Straighten first, explicitly. rover.forward() used to do this itself
        # and that is exactly what made steering impossible, so the library no
        # longer touches the wheels - which means "drive straight" is now this
        # method's job to say. Without it, a forward straight after a spin
        # would drive off with the wheels still pivoted.
        self._point_wheels(STRAIGHT)
        self.rover.forward(speed)

    def _reverse(self, speed: float) -> None:
        self._set_leds_reverse()
        self._point_wheels(STRAIGHT)
        self.rover.reverse(speed)

    def _spin_left(self, speed: float) -> None:
        self.rover.stop()
        self._point_wheels(PIVOT)
        self._start_spin_animation('left')
        self.rover.spinLeft(speed)

    def _spin_right(self, speed: float) -> None:
        self.rover.stop()
        self._point_wheels(PIVOT)
        self._start_spin_animation('right')
        self.rover.spinRight(speed)

    def _steer_left(self, degrees: float, speed: float) -> None:
        self._set_leds_forward()
        self._point_wheels(steer_angles(-degrees))
        self.rover.forward(speed)

    def _steer_right(self, degrees: float, speed: float) -> None:
        self._set_leds_forward()
        self._point_wheels(steer_angles(degrees))
        self.rover.forward(speed)

    def stop(self) -> None:
        self._stop_spin_animation()
        self.rover.stop()
        self._point_wheels(STRAIGHT)
        self._set_all_leds_white()

    def set_leds(self, pattern: str) -> None:
        if pattern == 'forward':
            self._set_leds_forward()
        elif pattern == 'reverse':
            self._set_leds_reverse()
        elif pattern == 'stop':
            self._set_all_leds_white()
        # spin patterns handled by animation

    def cleanup(self) -> None:
        self._stop_spin_animation()
        self.rover.stop()
        self._set_all_leds_white()
        self.rover.cleanup()

    def _point_wheels(self, angles: dict) -> None:
        """Send each steering servo its angle, in the order given."""
        for servo, degrees in angles.items():
            self.rover.setServo(servo, degrees)

    def _set_all_leds_white(self) -> None:
        """Set all LEDs to white"""
        white = self.rover.fromRGB(255, 255, 255)
        for i in range(4):
            self.rover.setPixel(i, white)
        self.rover.show()

    def _set_leds_forward(self) -> None:
        """Set front LEDs to blue, rear to white"""
        blue = self.rover.fromRGB(0, 0, 255)
        white = self.rover.fromRGB(255, 255, 255)
        self.rover.setPixel(1, blue)   # Front left
        self.rover.setPixel(2, blue)   # Front right
        self.rover.setPixel(0, white)  # Rear left
        self.rover.setPixel(3, white)  # Rear right
        self.rover.show()

    def _set_leds_reverse(self) -> None:
        """Set rear LEDs to red, front to white"""
        red = self.rover.fromRGB(255, 0, 0)
        white = self.rover.fromRGB(255, 255, 255)
        self.rover.setPixel(1, white)  # Front left
        self.rover.setPixel(2, white)  # Front right
        self.rover.setPixel(0, red)    # Rear left
        self.rover.setPixel(3, red)    # Rear right
        self.rover.show()

    def _start_spin_animation(self, direction: str) -> None:
        """Start LED spin animation"""
        self._stop_spin_animation()
        self.animation_running = True
        self.animation_thread = threading.Thread(
            target=self._animate_spin_leds, args=(direction,), daemon=True
        )
        self.animation_thread.start()

    def _stop_spin_animation(self) -> None:
        """Stop LED spin animation"""
        self.animation_running = False
        if self.animation_thread:
            self.animation_thread.join(timeout=0.5)
            self.animation_thread = None

    def _animate_spin_leds(self, direction: str) -> None:
        """Animate LEDs in a rotating pattern for spin commands"""
        green = self.rover.fromRGB(0, 255, 0)
        white = self.rover.fromRGB(255, 255, 255)

        # LED positions: 0 (rear left), 1 (front left), 2 (front right), 3 (rear right)
        # Clockwise (spin right): 1 -> 2 -> 3 -> 0
        # Counterclockwise (spin left): 1 -> 0 -> 3 -> 2
        if direction == 'right':
            sequence = [1, 2, 3, 0]  # Clockwise
        else:
            sequence = [1, 0, 3, 2]  # Counterclockwise

        idx = 0
        while self.animation_running:
            for i in range(4):
                if i == sequence[idx]:
                    self.rover.setPixel(i, green)
                else:
                    self.rover.setPixel(i, white)
            self.rover.show()
            idx = (idx + 1) % 4
            time.sleep(0.15)


def create_driver() -> RoverDriver:
    """Factory function to create appropriate driver based on environment.

    ROVER_DRIVER overrides the detection: "fake" runs the simulator, "real"
    insists on hardware and fails loudly if it is not there. Without it the
    driver is chosen by whether an I2C device exists, which is right for a
    rover and wrong everywhere else - a simulator on a Pi that happens to have
    I2C enabled would otherwise try to drive motors that are not attached, and
    a rover whose library failed to import would quietly become a simulator
    and look like it was working.
    """
    requested = os.environ.get('ROVER_DRIVER', '').strip().lower()

    if requested == 'fake':
        return FakeRoverDriver()

    if requested == 'real':
        # No fallback on purpose. Asking for hardware and silently getting a
        # stand-in is how a rover that never moves looks healthy.
        return RealRoverDriver()

    if requested:
        raise ValueError(
            f"ROVER_DRIVER must be 'fake' or 'real', not {requested!r}")

    # Check if running on Pi by looking for I2C device
    if os.path.exists('/dev/i2c-1'):
        try:
            return RealRoverDriver()
        except ImportError:
            print("Warning: rover module not found, falling back to FakeRoverDriver")
            return FakeRoverDriver()
    else:
        return FakeRoverDriver()
