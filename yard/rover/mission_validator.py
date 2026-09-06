"""
Mission validation for time and speed limits (User Story 401), and for calls
the rover cannot actually make.
"""

import re
from limits import MISSION_TIME_LIMIT_SECONDS, MAX_ROVER_SPEED


# How many arguments the rover library's motion functions really take.
#
# WHY THIS IS HERE. The browser simulator accepts an older, high-level form -
# rover.forward(speed, seconds), rover.steerLeft(degrees, speed, seconds) - so
# that missions saved before the change still replay. The rover has never had
# it. forward() takes one argument and steerLeft() does not exist at all, so a
# mission in that form played back perfectly on screen and then raised
# TypeError or AttributeError the moment it reached the hardware.
#
# It is caught here, before the rover is asked to do anything, rather than
# emulated. The obvious alternative - giving the library the duration argument
# it appears to be missing - would put a time.sleep() inside the library, and
# StudentCodeRunner's tracer only fires on student-code frames. A sleep in a
# library frame cannot be interrupted, so that shim would buy back old missions
# by building a rover the stop button could not stop.
#
# test_rover_api_table_matches_the_library.py checks this table against the
# real signatures, so it cannot quietly drift from what the rover can do.
ROVER_MOTION_ARITY = {
    'forward': 1,
    'reverse': 1,
    'spinLeft': 1,
    'spinRight': 1,
}

# Accepted by the simulator, absent from the rover library entirely.
ROVER_MISSING_FUNCTIONS = ('steerLeft', 'steerRight')


def calculate_python_duration(code: str) -> float:
    """
    Total seconds a mission will sleep for, `for _ in range(n)` loops multiplied out.

    A parse rather than an execution, so it is a floor and not a guarantee: a
    `while` loop, or a sleep whose argument is a variable, is invisible here.

    Both ways of pausing count. `rover.wait` is on the allowlist and is what a
    learner writing Python by hand tends to reach for, but this only ever
    matched `time.sleep`, so a mission built from rover.wait measured as zero
    seconds and cleared the ceiling on both sides of the LAN.

    Mirrors calculatePythonDuration in
    mission-control/src/core/domain/safety/calculateMissionDuration.ts.
    """
    total_seconds = 0.0

    # Each entry is a loop we are inside: the indent its `for` header sat at,
    # and how many times it runs. Recording the header's own indent is what
    # makes sequential loops work - assuming four spaces per level, as this
    # first did, stacked the second `for` on top of the first and multiplied
    # two sibling loops together.
    loops = []

    for line in code.split('\n'):
        trimmed = line.strip()
        if not trimmed:
            continue
        indent = len(line) - len(line.lstrip())

        # Anything at or left of a loop header is outside that loop.
        while loops and indent <= loops[-1][0]:
            loops.pop()

        loop_match = re.match(r'^for\s+\w+\s+in\s+range\s*\(\s*(\d+)\s*\)', trimmed)
        if loop_match:
            loops.append((indent, int(loop_match.group(1)) or 1))

        sleep_match = re.search(r'(?:time\.sleep|rover\.wait)\s*\(\s*([\d.]+)\s*\)', trimmed)
        if sleep_match:
            multiplier = 1
            for _, times in loops:
                multiplier *= times
            total_seconds += float(sleep_match.group(1)) * multiplier

    return total_seconds


def find_max_speed_in_python(code: str) -> int:
    """
    Find the maximum speed value in Python code.
    Looks for rover.forward(N), rover.reverse(N), etc.
    Returns 0 if no speed values found.
    """
    max_speed = 0
    # Match rover.forward(N), rover.reverse(N), rover.spinLeft(N), etc.
    pattern = r'rover\.(forward|reverse|spinLeft|spinRight|steerLeft|steerRight)\s*\(\s*(\d+)\s*\)'
    for match in re.finditer(pattern, code):
        speed = int(match.group(2)) or 0
        max_speed = max(max_speed, speed)
    return max_speed


def validate_mission_duration(code: str) -> tuple[bool, str | None]:
    """
    Validate that mission duration does not exceed limit.
    Returns (is_valid, error_message).
    """
    duration = calculate_python_duration(code)
    if duration > MISSION_TIME_LIMIT_SECONDS:
        return (
            False,
            f'Mission time limit exceeded. A mission cannot exceed {MISSION_TIME_LIMIT_SECONDS} seconds. Please reduce the seconds in your Python instructions.',
        )
    return (True, None)


def validate_rover_speed(code: str) -> tuple[bool, str | None]:
    """
    Validate that rover speed does not exceed limit.
    Returns (is_valid, error_message).
    """
    max_speed = find_max_speed_in_python(code)
    if max_speed > MAX_ROVER_SPEED:
        return (False, f'Speed limit exceeded. The maximum rover speed is {MAX_ROVER_SPEED}.')
    return (True, None)


def _arguments_in(call_text: str) -> int:
    """How many arguments a call was written with. Empty parens is zero."""
    inner = call_text[call_text.index('(') + 1:call_text.rindex(')')].strip()
    if not inner:
        return 0
    # Splitting on commas is enough because the rover API takes only numbers
    # and rover.fromRGB(...), and fromRGB is not one of the calls checked here.
    return len(inner.split(','))


def _without_comments(code: str) -> str:
    """The code with `#` comments removed.

    Generated missions are mostly comments - the block generator writes one
    above every instruction - so a check that reads them refuses missions over
    text that never runs.
    """
    return '\n'.join(line.split('#', 1)[0] for line in code.split('\n'))


def validate_rover_api(code: str) -> tuple[bool, str | None]:
    """
    Reject calls the rover cannot make, before it is asked to make them.
    Returns (is_valid, error_message).
    """
    executable = _without_comments(code)

    for name in ROVER_MISSING_FUNCTIONS:
        if re.search(r'rover\.' + name + r'\s*\(', executable):
            return (False, _OLD_STYLE_MESSAGE)

    for name, arity in ROVER_MOTION_ARITY.items():
        for match in re.finditer(r'rover\.' + name + r'\s*\([^()]*\)', executable):
            if _arguments_in(match.group(0)) > arity:
                return (False, _OLD_STYLE_MESSAGE)

    return (True, None)


# Says what to do, not what went wrong with them. A learner opening a mission
# saved months ago has done nothing incorrect.
_OLD_STYLE_MESSAGE = (
    'This mission uses an older style of rover instruction that the rover '
    'cannot run. Open the mission in Mission Control and save it again to '
    'update the instructions, then send it to the yard.'
)


def validate_mission_code(code: str) -> tuple[bool, list[str]]:
    """
    Validate mission code against time and speed limits, and against what the
    rover library can actually be asked to do.
    Returns (is_valid, error_messages).
    """
    errors = []

    # Checked first: if the code cannot run at all, the speed and duration it
    # claims are beside the point, and the older form hides its speed from
    # find_max_speed_in_python anyway.
    valid, error = validate_rover_api(code)
    if not valid:
        errors.append(error)

    # Check duration
    valid, error = validate_mission_duration(code)
    if not valid:
        errors.append(error)

    # Check speed
    valid, error = validate_rover_speed(code)
    if not valid:
        errors.append(error)

    return (len(errors) == 0, errors)
