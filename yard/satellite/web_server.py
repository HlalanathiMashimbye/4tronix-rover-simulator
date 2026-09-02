"""
Satellite Web Server - Flask server for web interfaces

Runs on mro.local:3001 (override with the SATELLITE_PORT env var).
Serves tablet Blockly interface and TV monitor display.
Proxies API calls to rover server.
"""

import os
import json
import logging
import socket
import threading
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import (Flask, render_template, request, jsonify, Response,
                   stream_with_context, session, redirect, send_file)

# Load this file's own .env before anything below reads os.environ - Flask
# has no built-in equivalent of Next.js's automatic .env loading. Load by
# explicit path (not the default upward search) so this never picks up a
# different .env from a parent directory (e.g. mission-control's).
load_dotenv(Path(__file__).resolve().parent / '.env')

CAMERA_PORT = int(os.environ.get('CAMERA_PORT', 8890))

# Read here rather than only in __main__ so the monitor can print the address
# a tablet should actually be typing. The TV footer used to hard-code :5050,
# which stopped being true when the default moved to 3001 - a wrong number on
# a wall-mounted screen is worse than no number at all.
SERVER_PORT = int(os.environ.get('SATELLITE_PORT', 3001))

# Runtime config persisted across restarts (e.g. rover URL edited on /status)
CONFIG_FILE = os.environ.get(
    'SATELLITE_CONFIG',
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'satellite_config.json')
)


def _load_config():
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_config(cfg):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)


def _recording_name(raw):
    """An operator-supplied name reduced to something safe to put in a path.

    Everything outside letters, digits, dash and underscore becomes a dash, so
    a name typed at an event ("Thabo's square!") cannot walk out of the
    recordings directory or collide with the mission__yard naming the queue
    flow uses.
    """
    import re
    name = re.sub(r'[^A-Za-z0-9_-]+', '-', (raw or '').strip()).strip('-')
    return name[:60]


def _local_ip():
    # UDP connect never sends a packet — OS just picks the right source
    # interface from the routing table. Try private ranges then fall back.
    for dest in ('10.255.255.255', '192.168.255.255', '172.16.255.255'):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((dest, 1))
            ip = s.getsockname()[0]
            s.close()
            if not ip.startswith('127.'):
                return ip
        except Exception:
            pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return 'unknown'

app = Flask(__name__)

# Operator console sessions. A stable secret keeps operators signed in across
# restarts; without one, sessions just reset on restart (re-login).
# No login remains, so nothing is kept in a session. Flask still wants a key
# for flash() and anything else that touches the session object.
app.secret_key = os.environ.get('OPERATOR_SESSION_SECRET') or os.urandom(32)

# Rover server URL — a value saved from the /status page wins over the
# environment default, so field edits survive a systemd restart
ROVER_URL = _load_config().get('rover_url') or os.environ.get('ROVER_URL', 'http://marspi.local:8523')

# What is left of /operator/: camera control and the satellite's tunables. The
# mission queue that used to live there went with the Firestore mirror. The
# getter indirection means a rover path edited on Settings applies everywhere.
app.config['ROVER_URL_GETTER'] = lambda: ROVER_URL
import operator_console  # noqa: E402  (needs app + config above)
app.register_blueprint(operator_console.operator_bp)

# Request timeout for rover API calls
ROVER_TIMEOUT = 5.0


@app.route('/')
def index():
    """The station hub.

    No sign-in and no Firestore. This used to be the mission queue behind an
    operator login, which put a Firebase round trip in front of the one thing
    a yard has to be able to do on a night when the venue wifi is down.

    It used to open on the Firestore-backed mission queue, behind a sign-in.
    That made the one thing a yard has to be able to do - run a mission -
    depend on reaching Firebase, on a box whose whole point is working when
    the venue wifi does not. Pasting code into /code/ and pressing run talks
    to the rover over the LAN and needs nothing else, so that is the door.

    /code/ and /monitor/ are login-free for the same reason: tablets and the
    TV are pointed at those URLs once during setup and never sign in.
    """
    return render_template('home.html', server_ip=_local_ip(), server_port=SERVER_PORT)


@app.route('/run/')
def run_station():
    """The operator's station for one mission, start to handover.

    Deliberately not /code/. That is an editor, used on a tablet mid-activity
    with a child watching, and its job is to get code onto the rover. This is
    the bookkeeping around a run: which mission it is, recording it, getting
    the video off the box, and the YouTube description that makes the upload
    link itself back.

    No "mark complete" here on purpose: closing a mission is Mission Control's
    job, and having two places to do it is how a mission ends up completed in
    one and processing in the other.

    Login-free like the rest of the console, for the same reason: none of this
    can depend on reaching Firebase.
    """
    from satellite_identity import yard_id
    return render_template('run.html', server_ip=_local_ip(),
                           server_port=SERVER_PORT, yard_id=yard_id())


@app.route('/settings')
def settings():
    """Diagnostics and the satellite's tunables.

    Was /status, and that URL still works: it is written on setup sheets and
    bookmarked on the yard's tablets, so it redirects here rather than 404ing.
    """
    return render_template('settings.html', rover_url=ROVER_URL)


@app.route('/status')
def status():
    return redirect('/settings')


@app.route('/api/status', methods=['GET'])
def api_status():
    satellite = {
        'hostname': socket.gethostname(),
        'ip': _local_ip(),
    }

    rover = {'reachable': False, 'driver': None, 'queue_size': None, 'url': ROVER_URL}
    try:
        resp = requests.get(f'{ROVER_URL}/health', timeout=2.0)
        if resp.status_code == 200:
            data = resp.json()
            rover['reachable'] = True
            rover['driver'] = data.get('driver')
            rover['queue_size'] = data.get('queue_size')
            rover['status'] = data.get('status')
            rover['processor_alive'] = data.get('processor_alive')
            rover['hardware'] = data.get('hardware')
            rover['camera'] = data.get('camera')
    except Exception:
        pass

    # Only that the camera process is accepting connections. Whether frames
    # are actually flowing costs a websocket probe, which is too much to spend
    # every 5 seconds on every open page - the recording start pays for that
    # answer at the one moment it changes the outcome.
    from camera_control import is_listening
    camera = {
        'reachable': is_listening(port=CAMERA_PORT),
        'port': CAMERA_PORT,
    }

    return jsonify({
        'satellite': satellite,
        'rover': rover,
        'camera': camera,
    })


@app.route('/api/config/rover_url', methods=['POST'])
def api_set_rover_url():
    """Set the rover URL at runtime (from the /status page) and persist it.

    Not gated, and that is a reversal. The old reasoning was that repointing
    the rover is a control action: anyone on the venue network could aim this
    satellite at a different machine and the console would carry on reporting
    success. True, but it assumed the gate was free, and it is not.
    require_operator means a Firebase sign-in, which means internet, and the
    field edit this endpoint exists for is the one an operator makes when the
    rover has moved to a new address - which is exactly when the yard is least
    likely to have working wifi. A control that only unlocks when the network
    is healthy is missing on the night it is needed.

    The same call was made for camera start: on a box whose whole point is
    working offline, an auth gate that bites only when the wifi is down
    protects nothing worth the cost. What is left is the network boundary
    itself - the satellite serves the yard's own LAN - plus validation below,
    which still rejects anything that is not an http(s) URL.
    """
    global ROVER_URL
    data = request.get_json(silent=True) or {}
    url = (data.get('url') or '').strip().rstrip('/')
    if not url.startswith(('http://', 'https://')) or len(url.split('//', 1)[1]) == 0:
        return jsonify({'error': 'URL must start with http:// or https://'}), 400

    ROVER_URL = url
    persisted = True
    try:
        cfg = _load_config()
        cfg['rover_url'] = url
        _save_config(cfg)
    except Exception:
        persisted = False

    return jsonify({'status': 'ok', 'rover_url': url, 'persisted': persisted})


@app.route('/code/')
def code():
    """Tablet Blockly interface"""
    return render_template('code.html')


@app.route('/monitor/')
def monitor():
    """TV display interface"""
    return render_template('monitor.html',
                           server_hostname=socket.gethostname(),
                           server_ip=_local_ip(),
                           camera_port=CAMERA_PORT,
                           server_port=SERVER_PORT)


@app.route('/api/queue/add', methods=['POST'])
def api_queue_add():
    """Proxy to rover queue/add endpoint"""
    try:
        data = request.get_json()
        resp = requests.post(
            f'{ROVER_URL}/queue/add',
            json=data,
            timeout=ROVER_TIMEOUT
        )
        return jsonify(resp.json()), resp.status_code
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Cannot connect to rover server'}), 503
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Rover server timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/queue/clear', methods=['POST'])
def api_queue_clear():
    """Proxy to rover queue/clear endpoint - the emergency stop.

    DELIBERATELY NOT behind require_operator, unlike every other control on
    this server. The tablets at /code/ never sign in (see index()), and this is
    the stop button a child or a facilitator hits when the rover is heading for
    a table leg. An auth gate here would mean the one control that has to work
    for anyone in the room is the one that asks for a password first.

    The worst an unauthenticated caller can do is stop the robot. That is the
    safe direction to fail in, so it stays open on purpose.
    """
    try:
        resp = requests.post(
            f'{ROVER_URL}/queue/clear',
            timeout=ROVER_TIMEOUT
        )
        return jsonify(resp.json()), resp.status_code
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Cannot connect to rover server'}), 503
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Rover server timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/queue/status', methods=['GET'])
def api_queue_status():
    """Proxy to rover queue/status endpoint"""
    try:
        resp = requests.get(
            f'{ROVER_URL}/queue/status',
            timeout=ROVER_TIMEOUT
        )
        return jsonify(resp.json()), resp.status_code
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Cannot connect to rover server'}), 503
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Rover server timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/queue/events', methods=['GET'])
def api_queue_events():
    """SSE proxy — forwards rover event stream to browser"""
    try:
        rover_resp = requests.get(
            f'{ROVER_URL}/queue/events',
            stream=True,
            # Rover heartbeats every 30s of idle, so a 45s read timeout only
            # fires when the rover died without closing the socket
            timeout=(3.05, 45)
        )
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
        return Response('Rover unreachable', status=503)

    def generate():
        try:
            for chunk in rover_resp.iter_content(chunk_size=None):
                if chunk:
                    yield chunk
        except (requests.exceptions.ConnectionError,
                requests.exceptions.ChunkedEncodingError,
                requests.exceptions.ReadTimeout):
            # End the stream; the browser's EventSource reconnects (~3s)
            pass
        finally:
            rover_resp.close()

    return Response(
        stream_with_context(generate()),
        content_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )


@app.route('/api/photo', methods=['GET'])
def api_photo():
    """Proxy the rover's latest photo (taken by the take-a-picture block)"""
    try:
        resp = requests.get(f'{ROVER_URL}/photo', timeout=ROVER_TIMEOUT)
        return Response(
            resp.content,
            status=resp.status_code,
            content_type=resp.headers.get('Content-Type', 'image/jpeg'),
            headers={'Cache-Control': 'no-cache'}
        )
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Cannot connect to rover server'}), 503
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Rover server timeout'}), 504


@app.route('/api/camera/ready', methods=['GET'])
def api_camera_ready():
    """Whether frames are actually arriving, not just whether the port is open.

    /api/status answers the cheap question because it is polled every five
    seconds by every open page. This is the expensive one, asked on demand by
    the run station, because "primed" on an operator's screen has to mean the
    thing that decides whether a recording contains anything.
    """
    from recording_control import is_ready

    ready, detail = is_ready()
    return jsonify({'ready': ready, 'detail': detail})


@app.route('/api/recording/start', methods=['POST'])
def api_recording_start():
    """Start recording a copy-paste run.

    Dispatching a mission from the queue starts a recording on the operator's
    behalf. Pasting code into /code/ never did, so the manual flow produced no
    video at all: the operator ran the rover, and there was nothing to take
    away and upload.

    The name is the operator's, not a mission id, because a pasted run has no
    mission. Whatever they type is what the file is called and what they will
    recognise later when matching it to a mission in Mission Control.
    """
    from recording_control import is_ready, start_recording
    from satellite_identity import yard_id

    data = request.get_json(silent=True) or {}
    name = _recording_name(data.get('name'))
    if not name:
        return jsonify({'error': 'Give the recording a name'}), 400

    # The same gate console/missions.py puts in front of a queued dispatch.
    # Without it the manual loop was the one path that would happily report
    # 'recording' with no frames arriving, and the operator found out at the
    # end of the night when there was no file to upload. A camera that is
    # merely listening is not a camera that is recording.
    ready, detail = is_ready()
    if not ready:
        return jsonify({
            'error': f'Camera is not ready ({detail}). Fix the camera feed before '
                     'you run - a run with no video cannot be handed over later.',
        }), 503

    ok, detail = start_recording(name, yard_id())
    if not ok:
        return jsonify({'error': detail}), 503
    return jsonify({'status': 'recording', 'name': name})


@app.route('/api/recording/stop', methods=['POST'])
def api_recording_stop():
    """Stop a copy-paste run's recording, keeping the file unless told not to."""
    from recording_control import stop_recording
    from satellite_identity import yard_id

    data = request.get_json(silent=True) or {}
    name = _recording_name(data.get('name'))
    if not name:
        return jsonify({'error': 'Give the recording a name'}), 400

    keep = data.get('keep', True)
    ok, detail = stop_recording(name, yard_id(), keep=bool(keep))
    return jsonify({'status': 'stopped', 'kept': bool(keep), 'detail': detail}), (200 if ok else 200)


@app.route('/api/recordings', methods=['GET'])
def api_recordings():
    """The videos sitting on this satellite, newest first.

    Step five of the manual loop: the operator takes the file to their own
    device, uploads it to YouTube and pastes the link into Mission Control.
    Until this existed the recordings were written and then unreachable, so
    the loop could not be closed by hand at all.

    Deliberately unauthenticated, like /code/ and /monitor/. The whole point
    is that this works when the venue wifi cannot reach Firebase, and an
    operator who can already drive the rover from this network gains nothing
    by being able to read a video of it.
    """
    from recording_control import RECORDINGS_DIR

    try:
        names = os.listdir(RECORDINGS_DIR)
    except OSError:
        # No directory yet simply means nothing has been recorded.
        return jsonify({'recordings': []})

    files = []
    for name in names:
        if not name.endswith('.mp4'):
            continue
        try:
            stat = os.stat(os.path.join(RECORDINGS_DIR, name))
        except OSError:
            continue
        files.append({
            'name': name,
            'bytes': stat.st_size,
            'modified': datetime.fromtimestamp(stat.st_mtime, timezone.utc)
                .isoformat().replace('+00:00', 'Z'),
        })

    files.sort(key=lambda f: f['modified'], reverse=True)
    return jsonify({'recordings': files})


@app.route('/api/recordings/<path:name>', methods=['GET'])
def api_recording_download(name):
    """Download one recording.

    The name is resolved and then checked to be inside the recordings
    directory, rather than trusted or merely sanitised: this is a path taken
    straight from a URL on a network the satellite does not control, and
    ../../ is the oldest trick there is.
    """
    from recording_control import RECORDINGS_DIR

    root = os.path.realpath(RECORDINGS_DIR)
    target = os.path.realpath(os.path.join(root, name))
    if os.path.commonpath([root, target]) != root or not target.endswith('.mp4'):
        return jsonify({'error': 'No such recording'}), 404
    if not os.path.isfile(target):
        return jsonify({'error': 'No such recording'}), 404

    return send_file(target, mimetype='video/mp4', as_attachment=True,
                     download_name=os.path.basename(target))


@app.route('/api/health', methods=['GET'])
def api_health():
    """Health check - also checks rover connectivity"""
    rover_status = 'unknown'
    try:
        resp = requests.get(f'{ROVER_URL}/health', timeout=2.0)
        if resp.status_code == 200:
            rover_status = 'connected'
        else:
            rover_status = 'error'
    except requests.exceptions.ConnectionError:
        rover_status = 'disconnected'
    except requests.exceptions.Timeout:
        rover_status = 'timeout'

    return jsonify({
        'status': 'ok',
        'rover_url': ROVER_URL,
        'rover_status': rover_status
    })


if __name__ == '__main__':
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    port = SERVER_PORT
    print(f"[satellite] serving on port {port}")
    print(f"[satellite] rover url {ROVER_URL}")
    import flask.cli
    flask.cli.show_server_banner = lambda *args, **kwargs: None
    # Releases the camera when the rover reports a run is over, so a recording
    # does not run until someone remembers to stop it. The only background
    # thread left: the mirror, its sync worker and the startup recovery that
    # went with them are gone.
    from mission_watcher import run_watcher_thread
    run_watcher_thread(lambda: app.config.get(
        'ROVER_URL_GETTER',
        lambda: os.environ.get('ROVER_URL', 'http://marspi.local:8523'))())

    app.run(host='0.0.0.0', port=port, threaded=True, use_reloader=False)

