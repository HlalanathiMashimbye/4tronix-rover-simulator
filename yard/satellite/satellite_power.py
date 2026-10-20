"""Shutting the satellite down from its own Settings page.

It was switched off by pulling the plug, and on 17 October 2026 that emptied
every file a git pull had written a few minutes before: the card had not been
given the data yet. A recording still open when the plug goes has no index at
its end and does not play either. `systemctl poweroff` writes everything out
and stops the services in order, so it is the switch that should be used, and
it belongs on the page the operator already has open.

It needs root, so it goes through sudo with no password, for exactly this one
command (yard/deploy/satellite.sudoers). Whether the rule is there is asked
first with `sudo -n -l`, which runs nothing, so a missing rule is reported
before any recording has been stopped.
"""

import os
import shutil
import subprocess
import threading
import time

# Long enough for the page to get its answer, and draw the "unplug when" screen,
# before the yard's wifi goes with the satellite.
DELAY_SECONDS = 2.0

NOT_SET_UP = ('Shutting down from here needs a one-time setup on the Pi. '
              'Someone with the mars password runs: '
              'sudo bash yard/docs/setup-scripts/satellite-sudoers.sh')


def _poweroff_argv():
    sudo, systemctl = shutil.which('sudo'), shutil.which('systemctl')
    if not sudo or not systemctl:
        return None
    return [sudo, '-n', systemctl, 'poweroff']


def can_power_off():
    """(allowed, why not). Runs nothing but sudo's own check."""
    argv = _poweroff_argv()
    if argv is None:
        return False, 'This machine has no systemd to shut down with.'
    sudo, _flag, systemctl, action = argv
    try:
        result = subprocess.run([sudo, '-n', '-l', systemctl, action],
                                capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, f'Could not ask sudo ({type(error).__name__}).'
    if result.returncode != 0:
        return False, NOT_SET_UP
    return True, None


def save_recordings():
    """Stop and keep every recording still open, so each file is closed and plays."""
    from recording_control import open_recordings, stop_recording
    saved = []
    for mission_id, yard_id in open_recordings():
        kept, _path = stop_recording(mission_id, yard_id, keep=True)
        if kept:
            saved.append(mission_id)
    return saved


def _power_off_later(argv):
    time.sleep(DELAY_SECONDS)
    subprocess.run(argv, capture_output=True, text=True, timeout=30)


def shut_down(schedule=None):
    """(ok, saved recordings | why not).

    `schedule` runs the poweroff; a thread by default so the request that
    asked for it can be answered first.
    """
    allowed, why_not = can_power_off()
    if not allowed:
        return False, why_not
    saved = save_recordings()
    os.sync()
    argv = _poweroff_argv()
    if schedule is None:
        threading.Thread(target=_power_off_later, args=(argv,), daemon=True).start()
    else:
        schedule(lambda: subprocess.run(argv, capture_output=True, text=True, timeout=30))
    return True, saved
