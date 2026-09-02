"""
Satellite settings an operator can change, and where they live.

These used to be environment variables, which meant changing a session
timeout or picking a camera involved editing a file on a Pi in a science
centre and restarting it. Nobody operating a yard should have to do that, so
they are declared here once and served by the Settings page.

Every tunable keeps its environment variable as the DEFAULT, so an existing
deployment behaves exactly as it did and a fresh one can still be seeded from
the environment. What changed is that the stored value wins, and takes effect
on the next use rather than the next restart.

Values are read from satellite_config.json on every use, deliberately. A box
that lives in a science centre is rarely restarted on purpose, so a setting
that needs a restart is a setting nobody changes.
"""

import json
import os

# name -> (config key, env var, default, cast, bounds or None)
#
# Bounds are enforced on both read and write: a hand-edited config file is as
# likely a source of nonsense as the form is, and a zero-second camera timeout
# would refuse every run.
#
# sessionMaxAge and sessionRecheck used to live here, tuning how long an
# operator stayed signed in and how often Firebase was re-asked whether they
# still should be. There is no sign-in on this box any more, so they were two
# controls on the Settings page that changed nothing.
TUNABLES = {
    'cameraHost': ('camera_host', 'CAMERA_HOST', 'localhost', str, None),
    'cameraReadyTimeout': ('camera_ready_timeout', 'CAMERA_READY_TIMEOUT', 2.0, float, (0.5, 30.0)),
}


def _clamp(value, bounds):
    return value if bounds is None else max(bounds[0], min(value, bounds[1]))


def _default(name):
    _key, env_var, fallback, cast, bounds = TUNABLES[name]
    raw = os.environ.get(env_var)
    if raw is None or raw.strip() == '':
        return fallback
    try:
        return _clamp(cast(raw.strip()), bounds)
    except (TypeError, ValueError):
        # A malformed env value is a typo, not an instruction. Using the
        # built-in default keeps the satellite booting and the Settings page
        # able to correct it.
        return fallback


def get(name):
    """The stored value, else the environment, else the built-in default."""
    key, _env, _fallback, cast, bounds = TUNABLES[name]
    try:
        from satellite_identity import CONFIG_FILE
        with open(CONFIG_FILE) as f:
            stored = json.load(f).get(key)
        if stored is None:
            return _default(name)
        return _clamp(cast(stored), bounds)
    except Exception:
        return _default(name)


def all_values():
    return {name: get(name) for name in TUNABLES}


def limits():
    return {name: list(spec[4]) for name, spec in TUNABLES.items() if spec[4]}


def save(updates):
    """Persist the given tunables. Returns the values now in force.

    Unknown names are ignored rather than written: this is fed straight from a
    request body, and a config file is not the place to let a caller invent
    keys. A value that will not cast is a 400 for the caller to fix, not
    something to silently drop.
    """
    from satellite_identity import CONFIG_FILE, _load, _save

    cfg = _load()
    for name, raw in updates.items():
        if name not in TUNABLES:
            continue
        key, _env, _fallback, cast, bounds = TUNABLES[name]
        cfg[key] = _clamp(cast(raw), bounds)

    _save(cfg)
    # Re-read rather than echo, so the caller sees what actually landed,
    # including a value that was clamped or one the write silently lost on a
    # read-only filesystem.
    _ = CONFIG_FILE
    return all_values()
