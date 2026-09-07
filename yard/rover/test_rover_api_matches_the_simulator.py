"""Code the simulator will happily play has to be code the rover can run.

THE FAULT THIS EXISTS FOR. parseRoverCode accepts an older, high-level form so
that missions saved before the low-level change still replay in the browser:

    rover.forward(60, 2)          # speed and seconds
    rover.steerLeft(20, 60, 2)    # degrees, speed and seconds

The rover has never had it. forward() takes one argument, and steerLeft() does
not exist at all. So one of those missions played back perfectly on screen, was
sent to the yard, and raised TypeError or AttributeError on the rover - a
mission that looked correct everywhere a person could see it and only broke
where nobody was watching.

Nothing caught it: mission_validator checked seconds and speed, and neither
notices a call the library cannot make. The speed check missed it twice over,
because its regex needs the closing bracket right after the number, so a
two-argument call had its speed silently unvalidated as well.
"""

import inspect
import sys
import types

import pytest

from mission_validator import (
    ROVER_MISSING_FUNCTIONS,
    ROVER_MOTION_ARITY,
    validate_mission_code,
    validate_rover_api,
)


# The modern form: what roverBlockly.ts generates today, and what the rover
# runs. None of this may be rejected.
MODERN = """\
rover.setServo(9, -20)
rover.setServo(15, -20)
rover.setServo(11, 20)
rover.setServo(13, 20)
rover.forward(60)
time.sleep(2)
rover.stop()
rover.setColor(rover.fromRGB(255, 0, 0))
rover.setPixel(0, rover.fromRGB(0, 255, 0))
rover.show()
"""


class TestTheOlderFormIsRefusedBeforeItReachesTheRover:
    @pytest.mark.parametrize('line', [
        'rover.forward(60, 2)',
        'rover.reverse(60, 2)',
        'rover.spinLeft(60, 2)',
        'rover.spinRight(60, 2)',
        'rover.steerLeft(20, 60, 2)',
        'rover.steerRight(20, 60, 2)',
    ])
    def test_every_call_the_rover_cannot_make_is_refused(self, line):
        valid, error = validate_rover_api(line)

        assert not valid, f'{line} would have reached the rover and raised'
        assert error

    @pytest.mark.parametrize('line', [
        'rover.forward(60, 2)',
        'rover.steerLeft(20, 60, 2)',
    ])
    def test_the_whole_mission_is_refused_not_just_the_api_check(self, line):
        valid, errors = validate_mission_code(line)

        assert not valid
        assert errors

    def test_the_message_says_what_to_do_about_it(self):
        _, error = validate_rover_api('rover.forward(60, 2)')

        # A learner opening a mission saved months ago has done nothing wrong,
        # so the message has to point at the fix, not at them.
        assert 'save it again' in error.lower()
        assert 'fail' not in error.lower()


class TestTheModernFormIsLeftAlone:
    def test_a_current_mission_passes(self):
        valid, error = validate_rover_api(MODERN)

        assert valid, error

    def test_the_whole_validator_passes_it_too(self):
        valid, errors = validate_mission_code(MODERN)

        assert valid, errors

    @pytest.mark.parametrize('line', [
        'rover.setServo(9, -20)',              # two arguments, and correct
        'rover.fromRGB(255, 255, 255)',        # three, and correct
        'rover.setPixel(0, rover.fromRGB(0, 0, 255))',
        'rover.stop()',
        'rover.forward(60)',
        'rover.getDistance()',
    ])
    def test_calls_that_are_fine_stay_fine(self, line):
        valid, error = validate_rover_api(line)

        assert valid, f'{line} was refused: {error}'

    def test_a_comment_describing_the_old_form_is_not_a_call(self):
        # The generated Python is full of explanatory comments, and one of them
        # mentioning an old command must not stop the mission running.
        valid, _ = validate_rover_api('# rover.forward(60, 2) used to mean this\nrover.forward(60)')

        assert valid


# ---------------------------------------------------------------------------
# Keeping the table honest
# ---------------------------------------------------------------------------

class _Anything:
    def __init__(self, *a, **k):
        pass

    def __call__(self, *a, **k):
        return _Anything()

    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        return _Anything()


class _StubModule(types.ModuleType):
    __all__: list = []

    def __getattr__(self, name):
        if name.startswith('__'):
            raise AttributeError(name)
        return _Anything()


@pytest.fixture
def rover_lib(monkeypatch):
    import os

    for name in ['RPi', 'RPi.GPIO', 'rpi_ws281x', 'smbus', 'pca9685']:
        monkeypatch.setitem(sys.modules, name, _StubModule(name))
    sys.modules['RPi'].GPIO = sys.modules['RPi.GPIO']
    monkeypatch.delitem(sys.modules, 'rover', raising=False)
    monkeypatch.syspath_prepend(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor'))

    import rover
    yield rover
    monkeypatch.delitem(sys.modules, 'rover', raising=False)


class TestTheTableSaysWhatTheLibraryActuallyDoes:
    """The validator's table is a second copy of the library's signatures.

    It cannot read them directly - the validator runs on the rover, where the
    library needs real I2C to import - so the two are checked against each
    other here instead, which is what stops the copy going stale.
    """

    def test_every_arity_matches_the_real_signature(self, rover_lib):
        for name, arity in ROVER_MOTION_ARITY.items():
            real = inspect.signature(getattr(rover_lib, name))

            assert len(real.parameters) == arity, (
                f'rover.{name}{real} takes {len(real.parameters)} arguments, '
                f'but the validator believes {arity}')

    def test_the_functions_called_missing_really_are_missing(self, rover_lib):
        for name in ROVER_MISSING_FUNCTIONS:
            assert not hasattr(rover_lib, name), (
                f'rover.{name} exists now, so the validator should stop '
                f'refusing missions that call it')
