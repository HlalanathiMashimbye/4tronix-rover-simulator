"""
Satellite identity: which yard this box serves, and the config file it keeps
that answer in. `yard_id()` keys recordings and labels the run station.

The config helpers live here because this was the first module to need a
file that survives restarts; tunables, the camera and the YouTube uploader
read and write the same file through them.
"""

import json
import os
import threading

CONFIG_FILE = os.environ.get(
    'SATELLITE_CONFIG',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'satellite_config.json')
)

# Missions carry yardId; a satellite only ever manages its own yard's missions.
#
# Named after the rover itself, which answers to `curiosity.local` on the yard
# LAN. The id a mission carries in Firestore is then the same word you ssh to,
# rather than `uct-rover-1`, which matched nothing anyone could see anywhere.
#
# This must equal a yard id Mission Control actually knows about. Yards are
# Firestore data now, added on the settings page - KNOWN_YARDS in
# infrastructure/config/yards.ts is only the seed list the migration carried
# across, kept for history. A mismatch does not error: it shows up as
# recordings uploaded under a yard id the YouTube linker cannot match to any
# run.
DEFAULT_YARD_ID = 'curiosity'

_lock = threading.Lock()
_cached = {}


def _load():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save(cfg):
    """Write the config. False when it could not be: a read-only filesystem
    must not stop the satellite booting, the setting just won't survive a
    restart, and Settings says so."""
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(cfg, f, indent=2)
        return True
    except Exception:
        return False


def yard_id():
    """Which yard's missions this satellite manages.

    Configured, never generated: it has to match the `yardId` that
    mission-control stamps on missions, so a wrong value shows up as
    recordings nothing in Mission Control can match to a run, rather than as
    silent cross-yard interference.
    """
    with _lock:
        if 'yard_id' in _cached:
            return _cached['yard_id']

        env_value = os.environ.get('YARD_ID')
        value = env_value or _load().get('yard_id') or DEFAULT_YARD_ID

        _cached['yard_id'] = value
        return value


def reset_cache():
    """Test hook - forget the memoised values."""
    with _lock:
        _cached.clear()
