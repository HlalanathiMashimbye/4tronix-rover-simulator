"""
Satellite Web Server - the Flask app for the yard's web interfaces.

Runs on mro.local:3001 (override with the SATELLITE_PORT env var). Serves the
station hub, the run station, Settings, the tablet editor and the TV monitor,
and proxies the rover's API.

This file is the app factory and nothing else. It used to be the app, its
configuration, its state and every route in one module, built as a side
effect of importing it, with the rover's address in a `global`. The routes
are blueprints in routes/ and console/; the address is app config.
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request

# Load this file's own .env before anything below reads os.environ - Flask
# has no built-in equivalent of Next.js's automatic .env loading. Load by
# explicit path (not the default upward search) so this never picks up a
# different .env from a parent directory (e.g. mission-control's).
load_dotenv(Path(__file__).resolve().parent / '.env')

import operator_console  # noqa: E402  (after .env: reads the environment)
from routes import BLUEPRINTS  # noqa: E402
from routes.network import SERVER_PORT  # noqa: E402
from same_origin import is_allowed  # noqa: E402
from satellite_identity import _load  # noqa: E402

DEFAULT_ROVER_URL = 'http://marspi.local:8523'


def _restore_camera_index():
    """The camera picked on Settings, back in force after a restart.

    Settings has always saved camera_index, and nothing read it back: every
    restart quietly returned to camera 0, which on a Mac with an iPhone nearby
    is often not the camera anyone chose. Same precedence as the rover URL.
    """
    index = _load().get('camera_index')
    if isinstance(index, int) and not isinstance(index, bool) and 0 <= index <= 15:
        os.environ['CAMERA_INDEX'] = str(index)


def create_app() -> Flask:
    """The satellite's Flask app, configured from Settings and the environment."""
    app = Flask(__name__)

    # Nothing on this server touches the Flask session any more - the operator
    # login that used it is gone - so there is nothing to keep across a
    # restart and no reason to configure a secret. A per-process random key
    # keeps flash() and anything else that reaches for `session` working.
    app.secret_key = os.urandom(32)

    # The rover's address: a value saved from Settings wins over the
    # environment default, so field edits survive a systemd restart. The
    # getter is what the console and the mission watcher read, so an address
    # changed on Settings applies everywhere at once.
    app.config['ROVER_URL'] = _load().get('rover_url') or os.environ.get('ROVER_URL', DEFAULT_ROVER_URL)
    app.config['ROVER_URL_GETTER'] = lambda: app.config['ROVER_URL']

    _restore_camera_index()

    # One gate in front of every route, so no route can forget it: a request
    # that would change state must come from the satellite's own pages. There
    # is no sign-in to lean on and must not be; same_origin.py has why, and why
    # this is not an offline gate.
    @app.before_request
    def _state_changes_come_from_our_pages():
        if not is_allowed(request.method, request.host,
                          request.headers.get('Sec-Fetch-Site'),
                          request.headers.get('Origin')):
            return jsonify({'error': "This change has to come from the "
                            "satellite's own pages."}), 403

    # /operator: the camera, the tunables and shutdown. Everything else is in routes/.
    app.register_blueprint(operator_console.operator_bp)
    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)
    return app


# What `python web_server.py` serves and what the tests drive.
app = create_app()


if __name__ == '__main__':
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    port = SERVER_PORT
    print(f"[satellite] serving on port {port}")
    print(f"[satellite] rover url {app.config['ROVER_URL']}")
    import flask.cli
    flask.cli.show_server_banner = lambda *args, **kwargs: None
    # Releases the camera when the rover reports a run is over, so a recording
    # does not run until someone remembers to stop it. The only background
    # thread left: the mirror, its sync worker and the startup recovery that
    # went with them are gone.
    from mission_watcher import run_watcher_thread
    run_watcher_thread(app.config['ROVER_URL_GETTER'])

    app.run(host='0.0.0.0', port=port, threaded=True, use_reloader=False)
