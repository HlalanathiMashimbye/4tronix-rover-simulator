"""
Satellite identity - who this box is, for mission locking.

Plan reference: yard/docs/offline-sync-plan.md section 3.3.

Why this exists rather than using an operator's identity as the lock owner:

there are no operator identities on this box. The sign-in went with the
Firestore mirror, so there is nobody to attribute a lock to. The satellite's
own id is the only stable principal it has, which is what this provides.

It was already effectively that way before the removal: OPERATOR_AUTH=off is
what got 45 missions through on Mandela Day when the science centre wifi could
not sustain Firebase sign-in, and in that mode every operator was the same
shared stub anyway.

"""

import json
import os
import threading
import uuid

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
# This must equal the id in mission-control's KNOWN_YARDS. A mismatch shows up
# as an empty queue, not as an error, so it is worth checking first when the
# satellite syncs cleanly but nothing arrives.
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
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(cfg, f, indent=2)
    except Exception:
        # A read-only filesystem must not stop the satellite booting; the id
        # just won't survive a restart, which degrades lock ownership rather
        # than breaking it.
        pass


def satellite_id():
    """Stable UUID for this satellite, generated once on first boot.

    Used as `lockOwner` on missions. Persisted to satellite_config.json so a
    restart reclaims its own leases rather than looking like a different box.
    """
    with _lock:
        if 'satellite_id' in _cached:
            return _cached['satellite_id']

        cfg = _load()
        sat_id = cfg.get('satellite_id')

        if not sat_id:
            sat_id = str(uuid.uuid4())
            cfg['satellite_id'] = sat_id
            _save(cfg)

        _cached['satellite_id'] = sat_id
        return sat_id


def yard_id():
    """Which yard's missions this satellite manages.

    Configured, never generated: it has to match the `yardId` that
    mission-control stamps on missions, so a wrong value shows up as an empty
    queue rather than as silent cross-yard interference.
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
