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

class Choices(tuple):
    """Allowed values for a tunable that is picked, not typed.

    Its own type so `_clamp` can tell "one of these" from "between these two"
    without guessing from the shape of a tuple. A value outside the list falls
    back to the first entry rather than raising: a hand-edited config file
    should not stop the camera starting.
    """


# The camera is 4:3 all the way down - the IMX500 sensor is 4056x3040 - so
# every option here is 4:3. Anything else would letterbox or stretch on the
# monitor, which crops the yard out of the picture.
#
# Labels rather than dimensions on the Settings page: an operator picking a
# camera setting at an event should not have to know what 1280x960 means, only
# that it is sharper and costs more.
CAMERA_RESOLUTIONS = Choices(('640x480', '1280x960', '1920x1440'))

RESOLUTION_LABELS = {
    '640x480': 'Standard',
    '1280x960': 'Sharp',
    '1920x1440': 'Sharpest',
}


def resolution_size(value=None):
    """The chosen resolution as a (width, height) pair."""
    raw = value if value is not None else get('cameraResolution')
    try:
        w, h = raw.lower().split('x')
        return int(w), int(h)
    except (AttributeError, ValueError):
        return 640, 480


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
# `hidden` keeps a setting real - readable, overridable by environment - while
# keeping it off the Settings page. cameraHost is the only one: it has one
# correct value on a yard, because the camera and the web server are the same
# Pi, and its only other use is pointing a laptop's web_server at the Pi's
# camera while developing. A control whose reachable settings are "correct" and
# "broken" is not a control.
HIDDEN = ('cameraHost',)

TUNABLES = {
    'cameraHost': ('camera_host', 'CAMERA_HOST', 'localhost', str, None),
    'cameraReadyTimeout': ('camera_ready_timeout', 'CAMERA_READY_TIMEOUT', 2.0, float, (0.5, 30.0)),
    'cameraResolution': ('camera_resolution', 'CAMERA_RESOLUTION', '640x480', str, CAMERA_RESOLUTIONS),
    'cleanupGracePeriod': ('cleanup_grace_hours', 'CLEANUP_GRACE_HOURS', 72.0, float, (1.0, 168.0)),
    'cleanupMaxAge': ('cleanup_max_days', 'CLEANUP_MAX_DAYS', 21.0, float, (1.0, 60.0)),
    'cleanupMinFreeGB': ('cleanup_min_free_gb', 'CLEANUP_MIN_FREE_GB', 2.0, float, (0.5, 16.0)),
}


def _clamp(value, bounds):
    if bounds is None:
        return value
    if isinstance(bounds, Choices):
        return value if value in bounds else bounds[0]
    return max(bounds[0], min(value, bounds[1]))


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
    """Every tunable, including the hidden ones. For code, not the page."""
    return {name: get(name) for name in TUNABLES}


def operator_values():
    """What the Settings page shows: everything an operator should decide."""
    return {name: get(name) for name in TUNABLES if name not in HIDDEN}


def limits():
    """Numeric ranges, for the inputs the operator types into."""
    return {name: list(spec[4]) for name, spec in TUNABLES.items()
            if spec[4] and not isinstance(spec[4], Choices) and name not in HIDDEN}


def options():
    """Allowed values for the tunables the operator picks from a list.

    Served alongside limits() so the Settings page can render a choice as a
    choice - buttons with names on them - rather than a box to type a number
    into that it has to validate afterwards.
    """
    return {name: {'values': list(spec[4]),
                   'labels': [RESOLUTION_LABELS.get(v, v) for v in spec[4]]}
            for name, spec in TUNABLES.items() if isinstance(spec[4], Choices)}


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
