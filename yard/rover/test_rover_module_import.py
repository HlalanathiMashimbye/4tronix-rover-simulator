"""
Tests for how run_python finds a `rover` module to drive.

WHY THIS FILE EXISTS. Every other test in this suite injects a rover_module
into RoverQueueService, so the real import path in _import_rover_module has
historically run on nobody's machine but a developer's laptop, and never in
CI. That blind spot bit: when legacy/simulator/roversimulator.py moved out of
the repo root, the off-Pi fallback kept pointing at the root, and run_python
raised ModuleNotFoundError for anyone without the 4tronix hardware library.
All 135 tests stayed green.

These tests assert the two directories the import resolves against actually
contain what they promise, which is exactly the class of breakage a file move
causes and the type-checker cannot see.
"""

import os
import sys

import pytest

import service


class TestRoverLibPath:
    """The on-Pi half: where `import rover` looks."""

    def test_defaults_to_the_vendored_copy_beside_this_package(self, monkeypatch):
        monkeypatch.delenv('ROVER_LIB_PATH', raising=False)
        path = service._rover_lib_path()
        assert os.path.isfile(os.path.join(path, 'rover.py')), (
            f'expected the vendored 4tronix library at {path}/rover.py'
        )

    def test_no_absolute_machine_path_is_baked_in(self, monkeypatch):
        """The marksheet flagged a hardcoded '/home/mars'. It must stay gone."""
        monkeypatch.delenv('ROVER_LIB_PATH', raising=False)
        assert '/home/mars' not in service._rover_lib_path()

    def test_rover_lib_path_env_var_overrides(self, monkeypatch):
        monkeypatch.setenv('ROVER_LIB_PATH', '/somewhere/else')
        assert service._rover_lib_path() == '/somewhere/else'


class TestSimulatorPath:
    """The off-Pi half: where `import roversimulator` looks."""

    def test_resolves_to_the_directory_holding_roversimulator(self):
        path = service._simulator_path()
        assert os.path.isfile(os.path.join(path, 'roversimulator.py')), (
            f'expected legacy/simulator/roversimulator.py, computed {path}. '
            'If the legacy simulator moved, _simulator_path must move with it.'
        )

    def test_the_simulator_exposes_the_api_run_python_calls(self):
        """roversimulator stands in for `rover`, so it needs the same surface.

        Skipped rather than failed when its own dependencies are absent:
        roversimulator imports rover_web_driver, which imports requests, and
        requests is deliberately not in yard/rover/requirements.txt.
        """
        pytest.importorskip('requests')
        sys.path.insert(0, service._simulator_path())
        try:
            import roversimulator
        finally:
            sys.path.remove(service._simulator_path())
        for name in ('forward', 'reverse', 'spinLeft', 'spinRight', 'stop', 'setServo'):
            assert hasattr(roversimulator, name), f'roversimulator is missing {name}()'


class TestImportRoverModule:
    """The function itself, end to end."""

    def test_falls_back_to_the_simulator_when_the_hardware_lib_is_absent(self, monkeypatch):
        """Off the Pi, `import rover` fails and we must still get a usable module.

        Points ROVER_LIB_PATH at an empty directory so the hardware import
        cannot succeed even on a machine that happens to have the 4tronix
        library installed, making this deterministic everywhere.
        """
        pytest.importorskip('requests')
        monkeypatch.setenv('ROVER_LIB_PATH', os.path.join(os.path.dirname(__file__), 'vendor', 'nonexistent'))
        monkeypatch.delitem(sys.modules, 'rover', raising=False)

        module = service._import_rover_module()

        assert hasattr(module, 'forward')
        assert hasattr(module, 'stop')
