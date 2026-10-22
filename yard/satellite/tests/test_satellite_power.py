"""Shutting the satellite down, and the sudo rule that lets it.

The satellite went off at the plug. On 17 October 2026 that left every file a
git pull had written minutes before empty, and it leaves a recording still
open unplayable. Shutting down cleanly needs root, through a passwordless sudo
rule for exactly the commands the code runs.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import camera_control
import recording_control
import satellite_power
import web_server

RULE = Path(__file__).resolve().parents[2] / 'deploy' / 'satellite.sudoers'
INSTALLER = Path(__file__).resolve().parents[2] / 'docs' / 'setup-scripts' / 'satellite-sudoers.sh'
SUDO, SYSTEMCTL = '/usr/bin/sudo', '/usr/bin/systemctl'


class Done:
    def __init__(self, returncode=0, stdout=''):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = ''


# sudo -l on the satellite on 21 October 2026, with the rule installed.
INSTALLED = """User mars may run the following commands on mro:
    (ALL : ALL) ALL
    (root) NOPASSWD: /usr/bin/systemctl restart satellite-web, /usr/bin/systemctl restart satellite-web.service, /usr/bin/systemctl restart satellite-camera, /usr/bin/systemctl restart satellite-camera.service, /usr/bin/systemctl stop satellite-camera, /usr/bin/systemctl stop satellite-camera.service, /usr/bin/systemctl poweroff
"""


@pytest.fixture
def pi(monkeypatch, tmp_path):
    """A Pi with systemd, sudo, and the recording table empty. `runs` is every
    command satellite_power ran; `listing` is what `sudo -n -l` prints, or
    None for a sudo that wants a password just to list."""
    monkeypatch.setattr(satellite_power.shutil, 'which',
                        lambda name: {'sudo': SUDO, 'systemctl': SYSTEMCTL}.get(name))
    monkeypatch.setattr(satellite_power.os, 'sync', lambda: None)
    monkeypatch.setattr(recording_control, 'RECORDINGS_DIR', str(tmp_path))
    monkeypatch.setattr(recording_control, '_ensure_consumer_started', lambda: None)
    for table in ('_writers', '_paths', '_started', '_dispatches'):
        monkeypatch.setattr(recording_control, table, {})

    state = {'listing': INSTALLED, 'runs': []}

    def run(argv, **_kwargs):
        state['runs'].append(argv)
        if argv == [SUDO, '-n', '-l']:
            return Done(1) if state['listing'] is None else Done(0, state['listing'])
        return Done(0)

    monkeypatch.setattr(satellite_power.subprocess, 'run', run)
    return state


def test_it_asks_sudo_whether_it_may_before_doing_anything(pi):
    assert satellite_power.can_power_off() == (True, None)
    assert pi['runs'] == [[SUDO, '-n', '-l']], 'a listing, not the command'


def test_without_the_rule_it_says_how_to_set_it_up_and_stops_nothing(pi):
    pi['listing'] = None
    recording_control.start_recording('m1', 'curiosity')

    ok, why = satellite_power.shut_down(schedule=lambda fn: fn())

    assert not ok and 'satellite-sudoers.sh' in why
    assert recording_control.is_recording('m1', 'curiosity'), 'a refused shutdown leaves the run filming'
    assert [SUDO, '-n', SYSTEMCTL, 'poweroff'] not in pi['runs']


def test_power_off_allowed_only_with_a_password_is_not_allowed(pi):
    """What `sudo -n -l systemctl poweroff` got wrong: once any entry needs no
    password, it says yes to everything mars may run at all. On the satellite
    it said yes to reboot, which needs the password."""
    pi['listing'] = INSTALLED.replace(', /usr/bin/systemctl poweroff', '')

    assert satellite_power.can_power_off() == (False, satellite_power.NOT_SET_UP)


def test_the_listing_is_read_entry_by_entry():
    assert satellite_power.passwordless(INSTALLED, '/usr/bin/systemctl poweroff')
    assert satellite_power.passwordless(INSTALLED, '/usr/bin/systemctl restart satellite-camera')
    assert not satellite_power.passwordless(INSTALLED, '/usr/bin/systemctl reboot')
    # A prefix of an entry is not the entry.
    assert not satellite_power.passwordless(INSTALLED, '/usr/bin/systemctl restart satellite')


def test_a_machine_without_systemd_cannot_shut_down_from_here(monkeypatch, pi):
    monkeypatch.setattr(satellite_power.shutil, 'which', lambda name: None)

    assert satellite_power.can_power_off()[0] is False


def test_open_recordings_are_closed_and_kept_before_the_power_goes(pi):
    """A file still open when the power goes has no index at its end."""
    recording_control.start_recording('m1', 'curiosity')
    path = recording_control._paths[('m1', 'curiosity')]
    open(path, 'wb').write(b'frames')
    order = []
    real_stop = recording_control.stop_recording

    def stop(*args, **kwargs):
        order.append('stopped')
        return real_stop(*args, **kwargs)

    recording_control.stop_recording = stop
    try:
        ok, saved = satellite_power.shut_down(schedule=lambda fn: (order.append('poweroff'), fn()))
    finally:
        recording_control.stop_recording = real_stop

    assert ok and saved == ['m1']
    assert order == ['stopped', 'poweroff']
    assert not recording_control.is_recording('m1', 'curiosity')
    assert os.path.exists(path), 'kept, not discarded'
    assert pi['runs'][-1] == [SUDO, '-n', SYSTEMCTL, 'poweroff']


def test_the_route_answers_before_the_power_goes(monkeypatch):
    monkeypatch.setattr(satellite_power, 'shut_down', lambda: (True, ['m1']))
    client = web_server.app.test_client()

    resp = client.post('/operator/api/satellite/shutdown')

    assert resp.status_code == 202
    assert resp.get_json() == {'status': 'shutting-down', 'saved': ['m1']}


def test_the_route_reports_a_missing_rule_as_unavailable(monkeypatch):
    monkeypatch.setattr(satellite_power, 'shut_down', lambda: (False, satellite_power.NOT_SET_UP))
    client = web_server.app.test_client()

    resp = client.post('/operator/api/satellite/shutdown')

    assert resp.status_code == 503
    assert 'satellite-sudoers.sh' in resp.get_json()['error']


def _rule_commands():
    text = RULE.read_text()
    joined = re.sub(r'\\\n\s*', '', text)
    commands = set()
    for line in joined.splitlines():
        match = re.match(r'\s*Cmnd_Alias\s+\w+\s*=\s*(.+)', line)
        if match:
            commands.update(part.strip() for part in match.group(1).split(','))
    return commands


def test_the_rule_allows_exactly_what_the_code_runs_and_nothing_else():
    """sudo matches the whole command, so a rule that is one word out
    installs cleanly and allows nothing. And anything extra here is something
    anyone on the yard's wifi can ask the satellite to do as root."""
    camera = camera_control.SERVICE_NAME
    expected = {
        # camera_control tries both spellings of the unit, for both actions
        # the Settings page has buttons for.
        *(f'{SYSTEMCTL} {action} {unit}' for action in ('restart', 'stop')
          for unit in (camera, camera + '.service')),
        # What a person, or an agent over ssh, runs after a git pull.
        f'{SYSTEMCTL} restart satellite-web',
        f'{SYSTEMCTL} restart satellite-web.service',
        # satellite_power's one command, without the sudo -n in front.
        f'{SYSTEMCTL} poweroff',
    }

    assert _rule_commands() == expected
    assert re.search(r'^mars ALL=\(root\) NOPASSWD: SATELLITE_WEB, SATELLITE_CAMERA, SATELLITE_POWER$',
                     RULE.read_text(), re.M)


def test_the_power_command_is_the_one_in_the_rule(monkeypatch):
    monkeypatch.setattr(satellite_power.shutil, 'which',
                        lambda name: {'sudo': SUDO, 'systemctl': SYSTEMCTL}.get(name))

    sudo, flag, *command = satellite_power._poweroff_argv()

    assert flag == '-n', 'never waits for a password nobody is there to type'
    assert ' '.join(command) in _rule_commands()


@pytest.mark.skipif(not shutil.which('visudo'), reason='visudo is not installed here')
def test_the_rule_is_valid_sudoers():
    """A sudoers file with a syntax error can lock everyone out of sudo."""
    result = subprocess.run(['visudo', '-cf', str(RULE)], capture_output=True, text=True)

    assert result.returncode == 0, result.stdout + result.stderr


def test_the_installer_checks_the_rule_before_it_goes_in():
    script = INSTALLER.read_text()

    assert script.index('visudo -cf') < script.index('install -o root -g root -m 0440')
    assert os.access(INSTALLER, os.X_OK)


@pytest.mark.skipif(not shutil.which('bash'), reason='bash is not installed here')
@pytest.mark.parametrize('command,passwordless', [
    ('restart satellite-web', True), ('restart satellite-camera', True),
    ('stop satellite-camera', True), ('poweroff', True),
    ('reboot', False), ('restart satellite', False),
])
def test_the_installer_reads_the_same_list(command, passwordless):
    """Its check after installing is the installer's own bash, run here on
    the listing the satellite printed."""
    script = INSTALLER.read_text()
    function = script[script.index('nopasswd() {'):script.index('}', script.index('nopasswd() {')) + 1]
    probe = f'{function}\nnopasswd "{command}"'

    result = subprocess.run(['bash', '-c', probe], capture_output=True, text=True,
                            env={**os.environ, 'listing': INSTALLED})

    assert (result.returncode == 0) == passwordless, result.stderr
