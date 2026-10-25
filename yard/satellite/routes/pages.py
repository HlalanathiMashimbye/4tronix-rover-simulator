"""
The pages people look at: the station hub, the run station, Settings, the
tablet editor and the TV monitor, plus the chrome every console page shares.
"""

import socket
from flask import Blueprint, render_template, redirect

import tunables
from routes.network import CAMERA_PORT, SERVER_PORT, local_ip
from routes.rover import rover_url

pages_bp = Blueprint('pages', __name__)


@pages_bp.app_context_processor
def _console_chrome():
    """Context every page gets, because _nav.html is included by every page.

    A per-route render_template argument would have to be repeated in five
    places and forgotten in the sixth.
    """
    # Read per page, like every tunable: a yard repointed on the Settings page
    # links to the new Mission Control on its next page, not its next restart.
    mission_control = tunables.get('missionControlUrl')
    return {
        'mission_control_url': mission_control,
        # The operator console, not the hub's home page: that is the learner
        # feed, and an operator pressing "back" was never there.
        'mission_control_back_url': mission_control + '/operator',
    }


@pages_bp.route('/')
def index():
    """The station hub.

    No sign-in and no Firestore. This used to open on the Firestore-backed
    mission queue, behind a sign-in, which made the one thing a yard has to be
    able to do - run a mission - depend on reaching Firebase, on a box whose
    whole point is working when the venue wifi does not. Pasting code into
    /code/ and pressing run talks to the rover over the LAN and needs nothing
    else, so that is the door now.

    /code/ and /monitor/ are login-free for the same reason: tablets and the
    TV are pointed at those URLs once during setup and never sign in.
    """
    return render_template('home.html', server_ip=local_ip(), server_port=SERVER_PORT)


@pages_bp.route('/run/')
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
    # camera_port for the same reason the monitor gets it: the live view dials
    # the camera stream from the browser, and the port is server config.
    return render_template('run.html', yard_id=yard_id(),
                           camera_port=CAMERA_PORT)


@pages_bp.route('/settings')
def settings():
    """Diagnostics and the satellite's tunables.

    Was /status, and that URL still works: it is written on setup sheets and
    bookmarked on the yard's tablets, so it redirects here rather than 404ing.
    """
    return render_template('settings.html', rover_url=rover_url())


@pages_bp.route('/status')
def status():
    return redirect('/settings')


@pages_bp.route('/code/')
def code():
    """Tablet Blockly interface"""
    return render_template('code.html')


@pages_bp.route('/monitor/')
def monitor():
    """TV display interface"""
    return render_template('monitor.html',
                           server_hostname=socket.gethostname(),
                           server_ip=local_ip(),
                           camera_port=CAMERA_PORT,
                           server_port=SERVER_PORT)
