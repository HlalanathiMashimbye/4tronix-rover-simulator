"""
Camera control routes.

The camera is a systemd unit on the Pi and a spawned process off it; that
split lives in camera_control.py, and these routes are the thin web layer
over it. They were sandwiched between mission dispatch and sync config in
the old console, sharing nothing with either.
"""

import os

from flask import jsonify, request

import camera_control
from console.auth import require_operator
from console.blueprint import operator_bp

@operator_bp.route('/api/camera/start', methods=['POST'])
@require_operator
def api_camera_start():
    """Start (or restart) the camera server.

    Behind require_operator deliberately. Spawning a process is the most
    powerful thing this console can do, and it sits on a network anyone at the
    venue can join. The command itself is hardcoded - see camera_control - so
    nothing from this request reaches a shell; the auth gate is defence in
    depth rather than the only control.

    An optional camera index is accepted and validated as an integer. It is the
    device selector on a development machine, the analogue of the rover URL.
    """
    from camera_control import start

    data = request.get_json(silent=True) or {}
    index = data.get('cameraIndex')
    if index is not None:
        try:
            index = int(index)
        except (TypeError, ValueError):
            return jsonify({'error': 'cameraIndex must be a number'}), 400
        if not 0 <= index <= 15:
            return jsonify({'error': 'cameraIndex must be between 0 and 15'}), 400
        _persist_camera_index(index)

    ok, detail = start(camera_index=index)
    if not ok:
        return jsonify({'error': detail}), 502

    # The server needs a moment to bind, so the caller polls /api/camera
    # rather than this reporting a readiness it cannot yet know.
    return jsonify({'status': 'ok', 'detail': detail})


@operator_bp.route('/api/camera/stop', methods=['POST'])
@require_operator
def api_camera_stop():
    from camera_control import stop

    ok, detail = stop()
    if not ok:
        return jsonify({'error': detail}), 502
    return jsonify({'status': 'ok', 'detail': detail})


def _persist_camera_index(index):
    """Remember the device across restarts, like the rover URL."""
    try:
        from satellite_identity import CONFIG_FILE
        import json
        try:
            with open(CONFIG_FILE) as f:
                cfg = json.load(f)
        except Exception:
            cfg = {}
        cfg['camera_index'] = index
        with open(CONFIG_FILE, 'w') as f:
            json.dump(cfg, f, indent=2)
        os.environ['CAMERA_INDEX'] = str(index)
    except (OSError, ValueError, ImportError) as e:
        # Best effort: the index still applies to the start about to happen,
        # it just will not survive a restart. Logged rather than swallowed so
        # a read-only config file is not invisible.
        print(f'could not persist camera_index: {e}')


@operator_bp.route('/api/camera', methods=['GET'])
@require_operator
def api_camera_status():
    """Whether the camera feed is up, and which backend is serving it.

    The backend matters to an operator: on the Pi the IMX500 does object
    detection on its own NPU, whereas a laptop webcam is a plain feed. Showing
    'no detection' beats someone concluding detection is broken.
    """
    port = int(os.environ.get('CAMERA_PORT', 8890))
    host = os.environ.get('CAMERA_HOST', 'localhost')

    import socket
    reachable = False
    try:
        with socket.create_connection((host, port), timeout=1.0):
            reachable = True
    except OSError:
        pass

    try:
        from camera_control import describe
        control = describe()
    except Exception:
        control = {'managedBy': 'unknown', 'running': reachable}

    return jsonify({
        'reachable': reachable,
        'host': host,
        'port': port,
        'wsUrl': f'ws://{host}:{port}',
        'managedBy': control.get('managedBy'),
        'cameraIndex': int(os.environ.get('CAMERA_INDEX', 0)),
        'hint': None if reachable else (
            'Camera server is not running. Use Start below. On a Mac it uses '
            'the built-in webcam (no object detection) and needs Camera '
            'permission; press Start and the message will say what to do.'
        ),
    })

