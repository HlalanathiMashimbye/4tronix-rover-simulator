"""
Mission validation for time and speed limits (User Story 401).
"""

import re
from limits import MISSION_TIME_LIMIT_SECONDS, MAX_ROVER_SPEED


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


def validate_mission_code(code: str) -> tuple[bool, list[str]]:
    """
    Validate mission code against time and speed limits.
    Returns (is_valid, error_messages).
    """
    errors = []

    # Check duration
    valid, error = validate_mission_duration(code)
    if not valid:
        errors.append(error)

    # Check speed
    valid, error = validate_rover_speed(code)
    if not valid:
        errors.append(error)

    return (len(errors) == 0, errors)
