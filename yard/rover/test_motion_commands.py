"""
Tests for the motion command table in service.py.

WHY THIS FILE EXISTS. The six motion commands used to be six near-identical
elif branches: start the motors, wait, stop, differing only in which driver
method started them. Collapsing them into _MOTION_COMMANDS removes the
duplication but moves the risk: a typo in a table key is a command that
silently stops existing, where a typo in an elif branch is usually a syntax
error or an obviously dead branch.

So these tests pin the table's keys against the driver interface and against
what the satellite actually dispatches, which is what the old shape gave us
for free by being verbose.
"""

from unittest.mock import MagicMock

import pytest

from drivers import RoverDriver, FakeRoverDriver
from service import _MOTION_COMMANDS, RoverQueueService


EXPECTED_COMMANDS = {
    'forward', 'backward', 'reverse',
    'spin_left', 'spin_right',
    'steer_left', 'steer_right',
}


class TestTableCoverage:

    def test_covers_exactly_the_commands_the_elif_chain_accepted(self):
        """Guards against a command quietly disappearing behind a typo'd key."""
        assert set(_MOTION_COMMANDS) == EXPECTED_COMMANDS

    def test_every_entry_calls_a_method_the_driver_interface_declares(self):
        """A table entry naming a method RoverDriver lacks would fail only at
        runtime, on the rover, mid-mission. Catch it here instead."""
        driver = MagicMock(spec=RoverDriver)
        for name, start_motion in _MOTION_COMMANDS.items():
            driver.reset_mock()
            start_motion(driver, 60, 20)
            assert driver.method_calls, f'{name} called nothing on the driver'


class TestMotionSemantics:
    """The mapping itself: each command must still drive the way it used to."""

    def setup_method(self):
        self.driver = MagicMock(spec=RoverDriver)

    @pytest.mark.parametrize('cmd,expected_method', [
        ('forward', 'forward'),
        ('backward', 'reverse'),
        ('reverse', 'reverse'),
        ('spin_left', 'spin_left'),
        ('spin_right', 'spin_right'),
    ])
    def test_speed_only_commands(self, cmd, expected_method):
        _MOTION_COMMANDS[cmd](self.driver, 55, 20)
        getattr(self.driver, expected_method).assert_called_once_with(55)

    @pytest.mark.parametrize('cmd', ['steer_left', 'steer_right'])
    def test_steer_commands_take_degrees_first_then_speed(self, cmd):
        """Argument order matters and is easy to flip: steer_left(degrees, speed)."""
        _MOTION_COMMANDS[cmd](self.driver, 55, 30)
        getattr(self.driver, cmd).assert_called_once_with(30, 55)

    def test_backward_and_reverse_are_the_same_motion(self):
        _MOTION_COMMANDS['backward'](self.driver, 40, 20)
        _MOTION_COMMANDS['reverse'](self.driver, 40, 20)
        assert self.driver.reverse.call_count == 2
        self.driver.forward.assert_not_called()


class TestExecutionShape:
    """The shared shape the table factored out: start, wait, stop."""

    def test_a_motion_instruction_starts_waits_and_stops(self):
        driver = MagicMock(spec=RoverDriver)
        service = RoverQueueService(driver=driver)
        try:
            instruction = {
                'id': 'x', 'cmd': 'forward',
                'params': {'speed': 70, 'seconds': 0.0}, 'status': 'pending',
            }
            service._execute_instruction(instruction)

            driver.forward.assert_called_once_with(70)
            driver.stop.assert_called_once()
            assert instruction['status'] == 'completed'
        finally:
            service.cleanup()

    def test_an_unknown_command_is_not_treated_as_motion(self):
        """Falling into the motion branch on an unrecognised command would
        move the rover for a command nobody defined."""
        driver = MagicMock(spec=RoverDriver)
        service = RoverQueueService(driver=driver)
        try:
            instruction = {
                'id': 'x', 'cmd': 'launch_into_orbit',
                'params': {'speed': 70, 'seconds': 0.0}, 'status': 'pending',
            }
            service._execute_instruction(instruction)

            driver.forward.assert_not_called()
            driver.reverse.assert_not_called()
            assert instruction['status'] == 'completed'
        finally:
            service.cleanup()

    def test_the_real_fake_driver_starts_then_stops_in_that_order(self, capsys):
        """Same path with the driver the yard actually uses off-hardware.

        FakeRoverDriver reports by printing, so the log is the observable
        behaviour: the motion must be started before it is stopped, and its
        spin animation must not be left running afterwards.
        """
        driver = FakeRoverDriver()
        service = RoverQueueService(driver=driver)
        try:
            service._execute_instruction({
                'id': 'x', 'cmd': 'spin_right',
                'params': {'speed': 80, 'seconds': 0.0}, 'status': 'pending',
            })
        finally:
            service.cleanup()

        log = capsys.readouterr().out
        assert log.index('Spin right at speed 80') < log.index('Stop')
        assert driver.animation_running is False
