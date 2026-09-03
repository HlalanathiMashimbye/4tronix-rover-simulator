"""
One answer to "is the camera working", shared by every page.

There were three, and they disagreed. /api/status said whether the port was
open. /api/camera/ready said whether frames were arriving. /operator/api/camera
said what camera_control thought the process was doing. Settings polled the
third, the run station polled the first and the second, and the monitor used
none of them and opened its own socket. So one page could show a working camera
while another showed a dead one, both truthfully, and an operator had no way to
tell which to believe.

This module computes all of it once. Every endpoint and every page now reads
the same snapshot.

Cached deliberately. "Frames are arriving" costs a websocket probe, and
/api/status is polled every five seconds by every open page - three pages would
mean three competing camera clients per poll. One probe per TTL, whoever asks.
"""

import os
import socket
import threading
import time

# Long enough that a wall of pages polling at 5s cannot cause more than one
# probe per cycle; short enough that a camera coming up shows within a poll.
TTL_SECONDS = 4.0

_lock = threading.Lock()
_cache = {'checked_at': 0.0, 'snapshot': None}
_probing = threading.Event()


def _listening(host, port):
    """Only that the port accepts a connection - cheap, and not the same
    question as whether the camera is producing anything."""
    try:
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except OSError:
        return False


def _build():
    import tunables
    from recording_control import is_ready, active_recordings

    host = tunables.get('cameraHost')
    port = int(os.environ.get('CAMERA_PORT', 8890))
    listening = _listening(host, port)

    # No point probing for frames on a port nothing is listening on, and the
    # probe's timeout is the slowest thing here.
    if listening:
        ready, detail = is_ready()
    else:
        ready, detail = False, 'camera server is not running'

    try:
        from camera_control import describe
        control = describe()
    except Exception:
        control = {'managedBy': 'unknown'}

    return {
        'host': host,
        'port': port,
        'wsUrl': f'ws://{host}:{port}',
        'listening': listening,
        'ready': ready,
        'detail': detail,
        'managedBy': control.get('managedBy'),
        'cameraIndex': int(os.environ.get('CAMERA_INDEX', '') or 0),
        'recording': active_recordings(),
        # Kept because the pages and their tests have always read this name.
        # It means "listening", which is what it always meant.
        'reachable': listening,
        'hint': None if listening else (
            'Camera server is not running. Use Start below. On a Mac it uses '
            'the built-in webcam (no object detection) and needs Camera '
            'permission; press Start and the message will say what to do.'
        ),
    }


def snapshot(max_age=TTL_SECONDS):
    """The current camera state, recomputed at most once per max_age.

    Pass max_age=0 straight after starting or stopping the camera, where the
    cached answer is known to be stale and the caller is willing to wait.
    """
    now = time.monotonic()
    with _lock:
        cached = _cache['snapshot']
        if cached is not None and (now - _cache['checked_at']) < max_age:
            return dict(cached)

    # Outside the lock: probing can take a second, and holding the lock would
    # queue every other page behind it. One prober at a time; the rest take the
    # previous answer rather than piling more clients onto the camera.
    if _probing.is_set() and cached is not None:
        return dict(cached)

    _probing.set()
    try:
        fresh = _build()
        with _lock:
            _cache['snapshot'] = fresh
            _cache['checked_at'] = time.monotonic()
        return dict(fresh)
    finally:
        _probing.clear()


def invalidate():
    """Forget the cached answer. Called after starting or stopping the camera,
    so the next page to ask sees what actually happened rather than the state
    from before the button was pressed."""
    with _lock:
        _cache['snapshot'] = None
        _cache['checked_at'] = 0.0
