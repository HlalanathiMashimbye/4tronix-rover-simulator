"""The simulator has to agree with the rover about what a program does.

THE GAP THIS FILLS. Three implementations describe the same rover: the
TypeScript physics that mission-control renders and the satellite serves from
static/roversim/, the vendored 4tronix library that drives the real motors, and
(deprecated) yard/rover/rover_physics.py. Every claim that they agreed was a
comment. Nothing ran two of them and compared.

They did not agree. rover.forward() recentred the steering servos, so hardware
drove in a straight line through every steering mission while the browser drew
a curve; and the simulator hardcoded the wheel angle to 30 degrees, so it drew
the same curve whatever the learner asked for. Both survived a fully green
build for months.

This runs the learner's Python through BOTH and compares the wheel angles the
two end up with. It lives with the satellite's tests because the compiled
simulator it loads is a satellite-served artefact, and because
test_mission_import.py already establishes cross-language agreement as
something checked here rather than asserted in prose.
"""

import json
import os
import subprocess
import sys
import textwrap
import types

import pytest


# .../yard/satellite/tests/this_file.py -> up four to the repository root.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))
ROVERSIM = os.path.join(REPO, 'yard', 'satellite', 'static', 'roversim')
VENDOR = os.path.join(REPO, 'yard', 'rover', 'vendor')

STEERING_CHANNELS = [9, 15, 11, 13]

# Exactly what roverBlockly.ts emits, written out rather than generated, so a
# change on either side has to be looked at rather than silently agreed with.
STEER_LEFT_25 = """\
rover.setServo(9, -25)
rover.setServo(15, -25)
rover.setServo(11, 25)
rover.setServo(13, 25)
rover.forward(60)
time.sleep(2)
"""

STEER_RIGHT_10 = """\
rover.setServo(9, 10)
rover.setServo(15, 10)
rover.setServo(11, -10)
rover.setServo(13, -10)
rover.forward(60)
time.sleep(2)
"""

DRIVE_STRAIGHT = """\
rover.setServo(9, 0)
rover.setServo(11, 0)
rover.setServo(13, 0)
rover.setServo(15, 0)
rover.forward(60)
time.sleep(2)
"""

PROGRAMS = {
    'steer left 25': STEER_LEFT_25,
    'steer right 10': STEER_RIGHT_10,
    'drive straight': DRIVE_STRAIGHT,
}


# ---------------------------------------------------------------------------
# The rover's answer: run the program against the real vendored library
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
    """yard/rover/vendor/rover.py, with the Pi's hardware stubbed out."""
    for name in ['RPi', 'RPi.GPIO', 'rpi_ws281x', 'smbus', 'pca9685']:
        monkeypatch.setitem(sys.modules, name, _StubModule(name))
    sys.modules['RPi'].GPIO = sys.modules['RPi.GPIO']
    monkeypatch.delitem(sys.modules, 'rover', raising=False)
    monkeypatch.syspath_prepend(VENDOR)

    import rover
    for channel in ['p', 'q', 'a', 'b']:
        monkeypatch.setattr(rover, channel, _Anything(), raising=False)
    monkeypatch.setattr(rover, 'lDir', 0, raising=False)
    monkeypatch.setattr(rover, 'rDir', 0, raising=False)
    yield rover
    monkeypatch.delitem(sys.modules, 'rover', raising=False)


def rover_wheel_angles(rover_lib, monkeypatch, code):
    """The wheel angles the real library is left holding after the program.

    The program is executed, not pattern-matched, so anything the library does
    to the servos behind the caller's back is included - which is the entire
    fault this file exists for.
    """
    angles = {}
    monkeypatch.setattr(
        rover_lib, 'setServo', lambda channel, degrees: angles.__setitem__(channel, degrees))
    exec(compile(code, '<mission>', 'exec'),
         {'rover': rover_lib, 'time': types.SimpleNamespace(sleep=lambda s: None)})
    return {c: angles.get(c, 0) for c in STEERING_CHANNELS}


# ---------------------------------------------------------------------------
# The simulator's answer: run the same program through the shipped bundle
# ---------------------------------------------------------------------------

def simulator_wheel_angles(code):
    """The wheel angles the compiled simulator draws at the end of the program.

    Loads yard/satellite/static/roversim/, the committed build the satellite
    actually serves, rather than the TypeScript source - so a stale bundle is
    caught here too.
    """
    script = textwrap.dedent("""
        import { parseRoverCode } from %s;
        import { simulateCommands } from %s;
        // Through the environment, not argv: `node -e` shifts argv in a way
        // that is easy to get subtly wrong, and the code contains newlines.
        const code = process.env.MISSION_CODE;
        const t = simulateCommands(parseRoverCode(code));
        process.stdout.write(JSON.stringify(t[t.length - 1].servos));
    """) % (
        json.dumps(os.path.join(ROVERSIM, 'parseRoverCode.js')),
        json.dumps(os.path.join(ROVERSIM, 'simulateCommands.js')),
    )
    result = subprocess.run(
        [node_binary(), '--input-type=module', '-e', script],
        capture_output=True, text=True, timeout=60,
        env={**os.environ, 'MISSION_CODE': code})
    assert result.returncode == 0, result.stderr
    return {int(k): v for k, v in json.loads(result.stdout).items()}


def node_binary():
    from shutil import which
    found = which('node')
    if not found:
        pytest.skip('node is not on PATH, so the compiled simulator cannot be run')
    return found


# ---------------------------------------------------------------------------
# The comparison
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('name', sorted(PROGRAMS))
def test_the_two_implementations_steer_the_same_wheels_the_same_way(
        name, rover_lib, monkeypatch):
    code = PROGRAMS[name]

    on_the_rover = rover_wheel_angles(rover_lib, monkeypatch, code)
    in_the_simulator = simulator_wheel_angles(code)

    assert on_the_rover == in_the_simulator, (
        f'{name}: the rover holds {on_the_rover} but the simulator draws '
        f'{in_the_simulator}')


def test_a_steer_is_actually_a_steer_in_both(rover_lib, monkeypatch):
    """Guards the comparison above from passing by both sides being straight.

    If forward() recentres the wheels again AND the simulator stops reading the
    angle, the equality test would go green on {0,0,0,0}. This one insists the
    wheels are turned at all.
    """
    on_the_rover = rover_wheel_angles(rover_lib, monkeypatch, STEER_LEFT_25)
    in_the_simulator = simulator_wheel_angles(STEER_LEFT_25)

    assert on_the_rover == {9: -25, 15: -25, 11: 25, 13: 25}
    assert in_the_simulator == {9: -25, 15: -25, 11: 25, 13: 25}
