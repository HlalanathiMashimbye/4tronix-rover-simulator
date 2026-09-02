"""
Unit Tests for Mission Validation (User Story 401)
"""

import pytest
from mission_validator import (
    calculate_python_duration,
    find_max_speed_in_python,
    validate_mission_duration,
    validate_rover_speed,
    validate_mission_code,
)
from limits import MISSION_TIME_LIMIT_SECONDS, MAX_ROVER_SPEED


class TestCalculatePythonDuration:
    def test_no_sleep_calls(self):
        code = 'rover.forward(60)\nrover.stop()'
        assert calculate_python_duration(code) == 0

    def test_single_sleep_call(self):
        code = 'rover.forward(60)\ntime.sleep(2.5)\nrover.stop()'
        assert calculate_python_duration(code) == 2.5

    def test_multiple_sleep_calls(self):
        code = 'time.sleep(1)\nrover.forward(60)\ntime.sleep(2)\nrover.stop()'
        assert calculate_python_duration(code) == 3

    def test_sleep_in_loop(self):
        code = 'for _ in range(3):\n    time.sleep(2)'
        assert calculate_python_duration(code) == 6

    def test_nested_loops(self):
        code = 'for _ in range(2):\n    for _ in range(3):\n        time.sleep(1)'
        assert calculate_python_duration(code) == 6

    def test_mixed_loop_and_non_loop(self):
        # 1 outside + (2 x 2) inside + 1 after = 6. This asserted 7 while the
        # tracker guessed loop depth from four-space indentation: the line that
        # LEAVES the loop was counted before the loop was popped, so the
        # trailing sleep was billed twice.
        code = 'time.sleep(1)\nfor _ in range(2):\n    time.sleep(2)\ntime.sleep(1)'
        assert calculate_python_duration(code) == 6

    def test_sequential_loops_are_not_multiplied(self):
        code = (
            'for _ in range(2):\n'
            '    time.sleep(1)\n'
            'for _ in range(3):\n'
            '    time.sleep(1)'
        )
        assert calculate_python_duration(code) == 5

    def test_comments_and_blank_lines_do_not_end_a_loop(self):
        code = '# a square\nfor _ in range(4):\n\n    # drive\n    time.sleep(5)\n'
        assert calculate_python_duration(code) == 20


class TestFindMaxSpeedInPython:
    def test_no_speed_calls(self):
        code = 'time.sleep(1)\nrover.stop()'
        assert find_max_speed_in_python(code) == 0

    def test_forward_speed(self):
        code = 'rover.forward(75)'
        assert find_max_speed_in_python(code) == 75

    def test_multiple_speeds(self):
        code = 'rover.forward(50)\nrover.spinLeft(80)\nrover.reverse(60)'
        assert find_max_speed_in_python(code) == 80

    def test_various_rover_methods(self):
        code = '''rover.forward(40)
rover.reverse(50)
rover.spinLeft(90)
rover.spinRight(70)
rover.steerLeft(60)
rover.steerRight(55)'''
        assert find_max_speed_in_python(code) == 90


class TestValidateMissionDuration:
    def test_valid_duration_under_limit(self):
        code = f'time.sleep({MISSION_TIME_LIMIT_SECONDS - 1})'
        is_valid, error = validate_mission_duration(code)
        assert is_valid is True
        assert error is None

    def test_valid_duration_at_limit(self):
        code = f'time.sleep({MISSION_TIME_LIMIT_SECONDS})'
        is_valid, error = validate_mission_duration(code)
        assert is_valid is True
        assert error is None

    def test_invalid_duration_over_limit(self):
        code = f'time.sleep({MISSION_TIME_LIMIT_SECONDS + 1})'
        is_valid, error = validate_mission_duration(code)
        assert is_valid is False
        assert error is not None
        assert 'Mission time limit exceeded' in error

    def test_invalid_duration_in_loop(self):
        code = f'for _ in range(2):\n    time.sleep({MISSION_TIME_LIMIT_SECONDS})'
        is_valid, error = validate_mission_duration(code)
        assert is_valid is False
        assert error is not None


class TestValidateRoverSpeed:
    def test_valid_speed_under_limit(self):
        code = f'rover.forward({MAX_ROVER_SPEED - 1})'
        is_valid, error = validate_rover_speed(code)
        assert is_valid is True
        assert error is None

    def test_valid_speed_at_limit(self):
        code = f'rover.forward({MAX_ROVER_SPEED})'
        is_valid, error = validate_rover_speed(code)
        assert is_valid is True
        assert error is None

    def test_invalid_speed_over_limit(self):
        code = f'rover.forward({MAX_ROVER_SPEED + 1})'
        is_valid, error = validate_rover_speed(code)
        assert is_valid is False
        assert error is not None
        assert 'Speed limit exceeded' in error


class TestValidateMissionCode:
    def test_valid_mission(self):
        code = f'''rover.forward({MAX_ROVER_SPEED})
time.sleep({MISSION_TIME_LIMIT_SECONDS})
rover.stop()'''
        is_valid, errors = validate_mission_code(code)
        assert is_valid is True
        assert len(errors) == 0

    def test_duration_exceeds_limit(self):
        code = f'time.sleep({MISSION_TIME_LIMIT_SECONDS + 1})'
        is_valid, errors = validate_mission_code(code)
        assert is_valid is False
        assert len(errors) > 0
        assert any('Mission time limit' in e for e in errors)

    def test_speed_exceeds_limit(self):
        code = f'rover.forward({MAX_ROVER_SPEED + 1})'
        is_valid, errors = validate_mission_code(code)
        assert is_valid is False
        assert len(errors) > 0
        assert any('Speed limit' in e for e in errors)

    def test_both_limits_exceeded(self):
        code = f'''rover.forward({MAX_ROVER_SPEED + 1})
time.sleep({MISSION_TIME_LIMIT_SECONDS + 1})'''
        is_valid, errors = validate_mission_code(code)
        assert is_valid is False
        assert len(errors) == 2
