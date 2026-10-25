"""
The rover, through this satellite: health, discovery, its address, and the
queue the run station and the monitor drive it with.

The rover's address is app state (app.config['ROVER_URL']), not a module
global. It used to be `global ROVER_URL` in web_server.py, so it could only be
changed by assigning to a module and only read by importing one; the console
blueprint and the mission watcher already read it through
app.config['ROVER_URL_GETTER'], and now everything does.
"""

import logging
import socket

import requests
from flask import Blueprint, current_app, request, jsonify, Response, stream_with_context

from routes.network import local_ip
from satellite_identity import _load, _save

rover_bp = Blueprint('rover', __name__)

# Request timeout for rover API calls
ROVER_TIMEOUT = 5.0


def rover_url():
    """The rover this satellite drives, as Settings last saved it."""
    return current_app.config['ROVER_URL']


def _note_recorded_dispatches(body):
    """Tell recording_control which rover instructions belong to which recording.

    The rover gives each instruction an id, and this proxy is the only place
    that sees that id next to the mission it was sent for. Best effort: the
    rover has already accepted the dispatch, so nothing here may turn it into
    an error.
    """
    try:
        from recording_control import note_dispatch, recording_key
        from satellite_identity import yard_id

        yard = yard_id()
        for instruction in (body or {}).get('instructions') or []:
            params = instruction.get('params') or {}
            if params.get('mission_id') and instruction.get('id'):
                note_dispatch(recording_key(params['mission_id']), yard, instruction['id'])
    except Exception as e:
        logging.getLogger(__name__).warning('Could not note a dispatch for its recording: %s', e)


@rover_bp.route('/api/status', methods=['GET'])
def api_status():
    from recording_cleanup import disk_stats
    from recording_control import active_recordings, readiness

    satellite = {
        'hostname': socket.gethostname(),
        'ip': local_ip(),
        'disk': disk_stats(),
    }

    rover = {'reachable': False, 'driver': None, 'queue_size': None, 'url': rover_url()}
    try:
        resp = requests.get(f'{rover_url()}/health', timeout=2.0)
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

    # The one camera answer, shared with every other endpoint and page. It
    # carries whether the port is open AND whether frames are arriving, which
    # used to be two separate endpoints that pages mixed and matched until
    # they contradicted each other.
    from camera_state import snapshot
    camera = snapshot()

    recording_ready, recording_detail = readiness()
    from youtube_upload import summary as upload_summary
    response = jsonify({
        'satellite': satellite,
        'rover': rover,
        'camera': camera,
        # The top bar's upload chip, on every page. Read from the notes on the
        # card; nothing here goes out to the internet.
        'uploads': upload_summary(),
        # Read now, not from the camera's snapshot. The snapshot is kept for
        # up to four seconds to save probing the camera, and the run station
        # takes this list's word for when a run has finished: a snapshot from
        # before Send, without the new recording in it, read as the rover
        # finishing a second after it set off. Reading a dict costs nothing.
        'recording': {
            'active': active_recordings(),
            'ready': recording_ready,
            'detail': recording_detail,
        },
    })
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response


@rover_bp.route('/api/rover/discover', methods=['GET'])
def api_rover_discover():
    """Rovers answering on this network.

    So the normal way to set the address is picking one that demonstrably
    works, rather than typing three things correctly from memory.
    """
    from rover_discovery import discover

    found = discover(current_url=rover_url())
    return jsonify({'rovers': [
        {
            'url': f['url'],
            'addresses': f['addresses'],
            'driver': f['health'].get('driver'),
            'hardware': f['health'].get('hardware'),
            'queueSize': f['health'].get('queue_size'),
            # Any of its addresses, not only the one shown: the saved address
            # is often the IP while the rover is listed by its mDNS name.
            'current': any(u.rstrip('/') == rover_url().rstrip('/') for u in f['addresses']),
        }
        for f in found
    ]})


@rover_bp.route('/api/config/rover_url', methods=['POST'])
def api_set_rover_url():
    """Set the rover URL at runtime (from the /status page) and persist it.

    Not gated, and that is a reversal. The old reasoning was that repointing
    the rover is a control action: anyone on the venue network could aim this
    satellite at a different machine and the console would carry on reporting
    success. True, but it assumed the gate was free, and it is not.
    require_operator meant a Firebase sign-in, which meant internet, and the
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
    from rover_discovery import normalise, probe

    data = request.get_json(silent=True) or {}
    url = normalise(data.get('url'))
    if not url:
        return jsonify({'error': 'Give the rover an address, like curiosity.local'}), 400

    # Check something is actually there before saving it.
    #
    # This used to accept anything beginning with http, so a mistyped address
    # saved happily and the yard looked broken with nothing on the page saying
    # why. That is exactly what happened at a demo. A wrong address is the
    # likely mistake here, not a malformed one.
    #
    # `force` exists for setting an address before the rover is switched on,
    # which is legitimate - it just should not be the accident.
    if not data.get('force'):
        ok, detail = probe(url)
        if not ok:
            return jsonify({
                'error': f'{url} did not answer as a rover: {detail}.',
                'url': url,
                'unreachable': True,
            }), 409

    current_app.config['ROVER_URL'] = url
    cfg = _load()
    cfg['rover_url'] = url
    persisted = _save(cfg)

    return jsonify({'status': 'ok', 'rover_url': url, 'persisted': persisted})


@rover_bp.route('/api/queue/add', methods=['POST'])
def api_queue_add():
    """Proxy to rover queue/add endpoint"""
    try:
        data = request.get_json()
        resp = requests.post(
            f'{rover_url()}/queue/add',
            json=data,
            timeout=ROVER_TIMEOUT
        )
        body = resp.json()
        if resp.status_code < 400:
            _note_recorded_dispatches(body)
        return jsonify(body), resp.status_code
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Cannot connect to rover server'}), 503
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Rover server timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@rover_bp.route('/api/queue/clear', methods=['POST'])
def api_queue_clear():
    """Proxy to rover queue/clear endpoint - the emergency stop.

    UNAUTHENTICATED, and always was: even back when other controls on this
    server sat behind require_operator (gone now with the rest of the login,
    see satellite_identity.py), this one deliberately did not. The tablets at
    /code/ never sign in (see index()), and this is the stop button a child or
    a facilitator hits when the rover is heading for a table leg. An auth gate
    here would mean the one control that has to work for anyone in the room is
    the one that asks for a password first.

    The worst an unauthenticated caller can do is stop the robot. That is the
    safe direction to fail in, so it stays open on purpose.
    """
    try:
        resp = requests.post(
            f'{rover_url()}/queue/clear',
            timeout=ROVER_TIMEOUT
        )
        return jsonify(resp.json()), resp.status_code
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Cannot connect to rover server'}), 503
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Rover server timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@rover_bp.route('/api/queue/status', methods=['GET'])
def api_queue_status():
    """Proxy to rover queue/status endpoint"""
    try:
        resp = requests.get(
            f'{rover_url()}/queue/status',
            timeout=ROVER_TIMEOUT
        )
        return jsonify(resp.json()), resp.status_code
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Cannot connect to rover server'}), 503
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Rover server timeout'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@rover_bp.route('/api/queue/events', methods=['GET'])
def api_queue_events():
    """SSE proxy — forwards rover event stream to browser"""
    try:
        rover_resp = requests.get(
            f'{rover_url()}/queue/events',
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


@rover_bp.route('/api/photo', methods=['GET'])
def api_photo():
    """Proxy the rover's latest photo (taken by the take-a-picture block)"""
    try:
        resp = requests.get(f'{rover_url()}/photo', timeout=ROVER_TIMEOUT)
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


@rover_bp.route('/api/health', methods=['GET'])
def api_health():
    """Health check - also checks rover connectivity"""
    rover_status = 'unknown'
    try:
        resp = requests.get(f'{rover_url()}/health', timeout=2.0)
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
        'rover_url': rover_url(),
        'rover_status': rover_status
    })
