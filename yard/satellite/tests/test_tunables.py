"""
Settings that used to be environment variables.

Changing the camera host or its readiness timeout meant editing a .env on a Pi in
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
        monkeypatch.delenv('CAMERA_READY_TIMEOUT', raising=False)

        assert tunables.get('cameraReadyTimeout') == 2.0

    def test_environment_is_the_default_so_existing_deployments_do_not_move(self, monkeypatch):
        monkeypatch.setenv('CAMERA_READY_TIMEOUT', '9.0')

        assert tunables.get('cameraReadyTimeout') == 9.0

    def test_the_stored_value_wins_over_the_environment(self, monkeypatch):
        monkeypatch.setenv('CAMERA_READY_TIMEOUT', '9.0')
        _write_config(camera_ready_timeout=6.0)

        assert tunables.get('cameraReadyTimeout') == 6.0

    def test_a_malformed_environment_value_does_not_stop_the_satellite(self, monkeypatch):
        """A typo is not an instruction. Booting with the default leaves the
        Settings page reachable to correct it."""
        monkeypatch.setenv('CAMERA_READY_TIMEOUT', 'soon')

        assert tunables.get('cameraReadyTimeout') == 2.0


class TestBounds:
    # Enforced on read too: a hand-edited config file is as likely a source of
    # nonsense as the form, and a 0-second recheck would hammer Firebase.
    def test_a_stored_value_below_the_floor_is_clamped(self):
        _write_config(camera_ready_timeout=0.01)

        assert tunables.get('cameraReadyTimeout') == 0.5

    def test_a_stored_value_above_the_ceiling_is_clamped(self):
        _write_config(camera_ready_timeout=999999999)

        assert tunables.get('cameraReadyTimeout') == 30.0

    def test_saving_clamps_rather_than_refusing(self):
        assert tunables.save({'cameraReadyTimeout': 0.01})['cameraReadyTimeout'] == 0.5


class TestSaving:
    def test_saved_values_survive_and_are_read_back(self):
        tunables.save({'cameraHost': 'pi-camera.local', 'cameraReadyTimeout': 12.0})

        assert tunables.get('cameraHost') == 'pi-camera.local'
        assert tunables.get('cameraReadyTimeout') == 12.0

    def test_unknown_keys_are_never_written(self):
        """Fed straight from a request body: a config file is not the place to
        let a caller invent keys."""
        tunables.save({'cameraHost': 'a.local', 'sneaky': 'value'})

        with open(satellite_identity.CONFIG_FILE) as f:
            assert 'sneaky' not in json.load(f)

    def test_saving_one_setting_leaves_the_others_alone(self):
        tunables.save({'cameraReadyTimeout': 9.0})
        tunables.save({'cameraHost': 'other.local'})

        assert tunables.get('cameraReadyTimeout') == 9.0

    def test_a_value_that_cannot_cast_raises_for_the_caller_to_handle(self):
        with pytest.raises((TypeError, ValueError)):
            tunables.save({'cameraReadyTimeout': 'never'})


class TestReadersUseIt:
    """The point of the move: the code paths read the setting, not the env."""

    def test_camera_host_follows_the_stored_value(self):
        """Replaces a session-lifetime check that read through console.auth,
        which went with the login. Same point, a reader that still exists."""
        from recording_control import _camera_uri
        _write_config(camera_host='camera.local')

        assert 'camera.local' in _camera_uri()

    def test_camera_ready_timeout_follows_the_stored_value(self):
        from recording_control import _ready_timeout
        _write_config(camera_ready_timeout=7.5)

        assert _ready_timeout() == 7.5


class TestWhichWayUp:
    """The camera's picture, half a turn round or as it is mounted.

    The Cape Town camera films the yard upside down against the simulator's
    map: the start spot on the right of the video and on the left of the
    simulation. Turning the picture is a setting, so nobody has to go up a
    ladder, and so a yard whose camera is the right way up is left alone.
    """

    def test_a_yard_that_has_set_nothing_is_left_as_mounted(self, monkeypatch):
        monkeypatch.delenv('CAMERA_ROTATION', raising=False)

        assert tunables.get('cameraRotation') == '0'
        assert tunables.camera_turned_round() is False

    def test_turned_round_once_the_settings_page_says_so(self):
        tunables.save({'cameraRotation': '180'})

        assert tunables.camera_turned_round() is True

    def test_the_environment_can_seed_it_for_a_fresh_box(self, monkeypatch):
        monkeypatch.setenv('CAMERA_ROTATION', '180')

        assert tunables.camera_turned_round() is True

    @pytest.mark.parametrize('nonsense', ['90', '270', 'upside-down', ''])
    def test_anything_but_half_a_turn_is_no_turn(self, nonsense):
        # A quarter turn would make the 4:3 picture 3:4, and everything after
        # the camera is 4:3. A hand-edited file does not get to ask for one.
        _write_config(camera_rotation=nonsense)

        assert tunables.get('cameraRotation') == '0'
        assert tunables.camera_turned_round() is False

    def test_the_settings_page_is_given_it_as_a_choice_with_words_on_it(self):
        options = tunables.options()

        assert options['cameraRotation'] == {
            'values': ['0', '180'],
            'labels': ['As mounted', 'Turned round'],
        }
        assert 'cameraRotation' in tunables.operator_values()

    def test_picture_quality_keeps_its_own_words(self):
        # One table of labels served every choice; a second choice must not
        # borrow the first one's, or lose them for it.
        assert tunables.options()['cameraResolution']['labels'] == ['Standard', 'Sharp', 'Sharpest']

