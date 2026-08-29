"""
Rover Server - Flask HTTP Adapter

This is a thin adapter that translates HTTP requests to service calls.
All business logic is in the RoverQueueService.
"""

import atexit
import os
import re
import logging
import subprocess
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, request, jsonify, Response, stream_with_context, send_file
from werkzeug.exceptions import HTTPException

try:
    from posthog import Posthog
except ImportError:
    # Analytics must never be what stops a rover starting.
    #
    # This was a hard top-level import, so a machine without the posthog
    # package could not run the rover server at all - it failed with a bare
    # ModuleNotFoundError before Flask was even built. `npm run dev` inherited
    # that: the launcher kills every service when one dies, so a missing
    # analytics library took Mission Control and the satellite down with it and
    # opened no browser tabs, with the actual cause buried in a dead child
    # process.
    #
    # On a Pi in a science centre the stakes are higher than a broken dev
    # script. A dependency that failed to install must not be the reason a
    # child's mission cannot run.
    #
    # Every use site already guards with `if posthog_client is not None`, so
    # None here degrades to exactly what an unconfigured deployment does:
    # the rover runs, and no events are sent.
    Posthog = None
import queue as queue_module

from drivers import create_driver
from service import RoverQueueService, PHOTO_PATH

# Load the rover's own configuration without traversing into a parent app.
load_dotenv(Path(__file__).resolve().parent / '.env')

app = Flask(__name__)

posthog_client = None
_error_handler_registered = False

# Mast-camera detection is fixed at boot (the CSI sensor is probed once), so
# we detect on first request and cache it for the process lifetime. A reboot
# restarts this process and re-probes — exactly when the answer can change.
_camera_status = None


def _probe_camera():
    """Return {'detected': bool, 'model': str|None}. Cheap I2C-level detect."""
    try:
        out = subprocess.run(
            ['rpicam-hello', '--list-cameras'],
            capture_output=True, text=True, timeout=10
        ).stdout
        m = re.search(r'imx\d+', out)
        return {'detected': bool(m), 'model': m.group(0) if m else None}
    except Exception:
        return {'detected': False, 'model': None}


def get_camera_status():
    global _camera_status
    if _camera_status is None:
        _camera_status = _probe_camera()
    return _camera_status

# Service instance - initialized in main() or create_app()
service: RoverQueueService = None


def create_app(queue_service: RoverQueueService = None) -> Flask:
    """Create Flask app with optional injected service (for testing)."""
    global posthog_client, service, _error_handler_registered

    if posthog_client is None and Posthog is not None:
        project_token = os.environ.get('POSTHOG_PROJECT_TOKEN')
        host = os.environ.get('POSTHOG_HOST')
        if project_token and host:
            posthog_client = Posthog(
                project_token,
                host=host,
                enable_exception_autocapture=True,
            )
            atexit.register(posthog_client.shutdown)
        elif app.debug or os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true'):
            missing_variable = 'POSTHOG_PROJECT_TOKEN' if not project_token else 'POSTHOG_HOST'
            raise RuntimeError(
                f'{missing_variable} variable required by PostHog is missing or un-configured, '
                f'this causes events to be silently missed. This error stops appearing once '
                f'{missing_variable} is configured'
            )

    if queue_service:
        service = queue_service
    elif service is None:
        # Default: create service with auto-detected driver
        driver = create_driver()
        service = RoverQueueService(driver)
        service.start_processor()

    if not _error_handler_registered:
        @app.errorhandler(Exception)
        def capture_unhandled_exception(error):
            if isinstance(error, HTTPException):
                return error

            if posthog_client is not None:
                posthog_client.capture_exception(error)

            return jsonify({'error': 'Internal server error'}), 500

        _error_handler_registered = True

    return app


@app.route('/queue/add', methods=['POST'])
def queue_add():
    """Add instruction(s) to the queue"""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No JSON data provided'}), 400

    result = service.add_instructions(data)

    if result.get('status') == 'error':
        return jsonify(result), 400

    if posthog_client is not None:
        posthog_client.capture(
            'instruction_queue_submitted',
            properties={'instruction_count': result['added']},
        )

    return jsonify(result)


@app.route('/queue/clear', methods=['POST'])
def queue_clear():
    """Clear the queue and emergency stop"""
    result = service.clear_queue()

    if posthog_client is not None:
        posthog_client.capture(
            'rover_emergency_stop_requested',
            properties={'cleared_instruction_count': result['cleared']},
        )

    return jsonify(result)


@app.route('/queue/status', methods=['GET'])
def queue_status():
    """Get current queue status"""
    result = service.get_status()
    return jsonify(result)


@app.route('/queue/events', methods=['GET'])
def queue_events():
    """SSE endpoint — streams queue state changes to subscribers"""
    def generate():
        import json
        q = service.subscribe()
        try:
            yield f"data: {json.dumps(service.get_status())}\n\n"
            while True:
                try:
                    yield f"data: {q.get(timeout=30)}\n\n"
                except queue_module.Empty:
                    yield ": heartbeat\n\n"
        finally:
            service.unsubscribe(q)

    return Response(
        stream_with_context(generate()),
        content_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    )


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    result = service.get_health()
    result['camera'] = get_camera_status()
    return jsonify(result)


@app.route('/photo', methods=['GET'])
def photo():
    """Serve the most recent photo taken by take_photo() in student code"""
    if not os.path.exists(PHOTO_PATH):
        return jsonify({'error': 'No photo taken yet'}), 404
    return send_file(PHOTO_PATH, mimetype='image/jpeg', max_age=0)


def main():
    global service

    driver = create_driver()
    service = RoverQueueService(driver)
    create_app(service)

    driver_name = driver.__class__.__name__
    if driver_name == 'FakeRoverDriver':
        print("[yard] driver FakeRoverDriver (fake)")
    else:
        print("[yard] driver RealRoverDriver (hardware)")

    # Start queue processor
    service.start_processor()

    # Run Flask server
    try:
        logging.getLogger('werkzeug').setLevel(logging.ERROR)
        print("[yard] port 8523")
        import flask.cli
        flask.cli.show_server_banner = lambda *args, **kwargs: None
        app.run(host='0.0.0.0', port=8523, threaded=True)
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        service.cleanup()


if __name__ == '__main__':
    main()
