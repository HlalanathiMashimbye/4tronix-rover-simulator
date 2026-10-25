"""
Where the rover finds the 4tronix hardware library.

RealRoverDriver imports it from here, and a learner's program drives the same
library through the driver (see test_driver_contract.py), so this is the one
place its location is decided.
"""

import os

from drivers import rover_lib_path


def test_defaults_to_the_vendored_copy_beside_this_package(monkeypatch):
    monkeypatch.delenv('ROVER_LIB_PATH', raising=False)
    path = rover_lib_path()
    assert os.path.isfile(os.path.join(path, 'rover.py')), (
        f'expected the vendored 4tronix library at {path}/rover.py'
    )


def test_no_absolute_machine_path_is_baked_in(monkeypatch):
    """The marksheet flagged a hardcoded '/home/mars'. It must stay gone."""
    monkeypatch.delenv('ROVER_LIB_PATH', raising=False)
    assert '/home/mars' not in rover_lib_path()


def test_rover_lib_path_env_var_overrides(monkeypatch):
    monkeypatch.setenv('ROVER_LIB_PATH', '/somewhere/else')
    assert rover_lib_path() == '/somewhere/else'
