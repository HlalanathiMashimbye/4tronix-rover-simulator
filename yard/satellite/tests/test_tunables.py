"""
Settings that used to be environment variables.

Changing a session timeout or the camera host meant editing a .env on a Pi in
a science centre and restarting it, which is why nobody ever changed them.
They are Settings-page values now, with the old environment variables kept as
defaults so an existing deployment behaves exactly as it did.
"""

import json

import pytest

import satellite_identity
import tunables


def _write_config(**values):
    # satellite_identity.CONFIG_FILE, not a from-import: the autouse fixture
    # repoints it at a tmp path per test, and a module-level `from ... import`
    # would have captured the real one and written to the developer's box.
    with open(satellite_identity.CONFIG_FILE, 'w') as f:
        json.dump(values, f)


class TestPrecedence:
    def test_built_in_default_when_nothing_is_set(self, monkeypatch):
        monkeypatch.delenv('OPERATOR_SESSION_MAX_AGE', raising=False)

        assert tunables.get('sessionMaxAge') == 12 * 3600

    def test_environment_is_the_default_so_existing_deployments_do_not_move(self, monkeypatch):
        monkeypatch.setenv('OPERATOR_SESSION_MAX_AGE', '3600')

        assert tunables.get('sessionMaxAge') == 3600

    def test_the_stored_value_wins_over_the_environment(self, monkeypatch):
        monkeypatch.setenv('OPERATOR_SESSION_MAX_AGE', '3600')
        _write_config(session_max_age=1800)

        assert tunables.get('sessionMaxAge') == 1800

    def test_a_malformed_environment_value_does_not_stop_the_satellite(self, monkeypatch):
        """A typo is not an instruction. Booting with the default leaves the
        Settings page reachable to correct it."""
        monkeypatch.setenv('CAMERA_READY_TIMEOUT', 'soon')

        assert tunables.get('cameraReadyTimeout') == 2.0


class TestBounds:
    # Enforced on read too: a hand-edited config file is as likely a source of
    # nonsense as the form, and a 0-second recheck would hammer Firebase.
    def test_a_stored_value_below_the_floor_is_clamped(self):
        _write_config(session_recheck=1)

        assert tunables.get('sessionRecheck') == 30

    def test_a_stored_value_above_the_ceiling_is_clamped(self):
        _write_config(session_max_age=999999999)

        assert tunables.get('sessionMaxAge') == 7 * 24 * 3600

    def test_saving_clamps_rather_than_refusing(self):
        assert tunables.save({'sessionRecheck': 5})['sessionRecheck'] == 30


class TestSaving:
    def test_saved_values_survive_and_are_read_back(self):
        tunables.save({'cameraHost': 'pi-camera.local', 'sessionRecheck': 120})

        assert tunables.get('cameraHost') == 'pi-camera.local'
        assert tunables.get('sessionRecheck') == 120

    def test_unknown_keys_are_never_written(self):
        """Fed straight from a request body: a config file is not the place to
        let a caller invent keys."""
        tunables.save({'cameraHost': 'a.local', 'sneaky': 'value'})

        with open(satellite_identity.CONFIG_FILE) as f:
            assert 'sneaky' not in json.load(f)

    def test_saving_one_setting_leaves_the_others_alone(self):
        tunables.save({'sessionRecheck': 90})
        tunables.save({'cameraHost': 'other.local'})

        assert tunables.get('sessionRecheck') == 90

    def test_a_value_that_cannot_cast_raises_for_the_caller_to_handle(self):
        with pytest.raises((TypeError, ValueError)):
            tunables.save({'sessionMaxAge': 'never'})


class TestReadersUseIt:
    """The point of the move: the code paths read the setting, not the env."""

    def test_session_expiry_follows_the_stored_value(self):
        from console.auth import session_max_age
        _write_config(session_max_age=600)

        assert session_max_age() == 600

    def test_camera_ready_timeout_follows_the_stored_value(self):
        from recording_control import _ready_timeout
        _write_config(camera_ready_timeout=7.5)

        assert _ready_timeout() == 7.5
