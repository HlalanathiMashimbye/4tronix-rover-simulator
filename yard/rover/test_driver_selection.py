"""Which driver the rover server runs with, and who decides.

Detection by "is there an I2C device" is right for a rover and wrong for
anything else running the same server. The simulator needs to be something you
ask for, not something you get because the hardware happened to be absent -
and hardware needs to be something you can insist on, because a rover that
quietly became a simulator looks perfectly healthy right up until nobody
notices the wheels never turned.
"""

import os

import pytest

import drivers
from drivers import FakeRoverDriver, create_driver


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv('ROVER_DRIVER', raising=False)


class TestExplicitRequestWins:
    def test_fake_is_honoured_even_on_a_pi(self, monkeypatch):
        """A simulator on a Pi with I2C enabled must not drive real motors."""
        monkeypatch.setattr(os.path, 'exists', lambda p: True)
        monkeypatch.setenv('ROVER_DRIVER', 'fake')

        assert isinstance(create_driver(), FakeRoverDriver)

    def test_real_does_not_fall_back_to_fake(self, monkeypatch):
        """Asking for hardware and getting a stand-in is the silent failure.

        The detection path deliberately falls back when the rover library is
        missing. This path deliberately does not: if you said 'real' and the
        library is not there, that is a broken rover and it should say so.
        """
        monkeypatch.setattr(os.path, 'exists', lambda p: True)
        monkeypatch.setattr(
            drivers, 'RealRoverDriver',
            lambda: (_ for _ in ()).throw(ImportError('no rover module')))
        monkeypatch.setenv('ROVER_DRIVER', 'real')

        with pytest.raises(ImportError):
            create_driver()

    @pytest.mark.parametrize('value', ['FAKE', ' fake ', 'Fake'])
    def test_case_and_whitespace_do_not_matter(self, monkeypatch, value):
        monkeypatch.setattr(os.path, 'exists', lambda p: True)
        monkeypatch.setenv('ROVER_DRIVER', value)

        assert isinstance(create_driver(), FakeRoverDriver)

    def test_a_typo_is_refused_rather_than_guessed(self, monkeypatch):
        """'simulator', 'sim', 'true' - all plausible, none of them a mode.

        Treating an unrecognised value as "use detection" would mean a typo in
        a unit file silently gives you hardware.
        """
        monkeypatch.setenv('ROVER_DRIVER', 'simulator')

        with pytest.raises(ValueError, match='fake'):
            create_driver()


class TestDetectionStillApplies:
    def test_no_i2c_means_the_simulator(self, monkeypatch):
        monkeypatch.setattr(os.path, 'exists', lambda p: False)

        assert isinstance(create_driver(), FakeRoverDriver)

    def test_an_empty_variable_is_not_a_request(self, monkeypatch):
        """Unit files and shells set variables to "" all the time."""
        monkeypatch.setattr(os.path, 'exists', lambda p: False)
        monkeypatch.setenv('ROVER_DRIVER', '')

        assert isinstance(create_driver(), FakeRoverDriver)
