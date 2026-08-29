"""
Operator Console - Flask blueprint for the yard operator interface

Mounted on the satellite web server at /operator/. Operators sign in with
their Firebase email/password (the account needs an 'operator' or 'admin'
custom claim), see the mission queue from Firestore, and send a mission's
Python straight to the rover queue with one tap. Mark-complete and the
YouTube link close the loop so learners see their run on the public site.

The public mission-control web app has no operator surface at all; this
console is the only operator UI and it lives on the yard's local network.

Configuration (environment):
  FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
      Service account for Firestore + token verification (same variable
      names as mission-control's .env, so one env file can feed both).
      GOOGLE_APPLICATION_CREDENTIALS (path to a JSON key) also works.
  FIREBASE_WEB_API_KEY (or NEXT_PUBLIC_FIREBASE_API_KEY)
      Web API key used for the email/password sign-in REST call.
  OPERATOR_SESSION_SECRET
      Optional. Stable Flask session secret; unset means sessions reset
      when the server restarts (operators just log in again).
  YOUTUBE_API_KEY / YOUTUBE_CHANNEL_ID
      Optional. Powers the background poll (start_polling/check_for_new_videos)
      that auto-links a completed mission to its YouTube upload by matching
      "MissionID: <id>" in the video description. Either unset disables the
      poll (it logs and no-ops) - manual "attach YouTube URL" still works
      without these.
  MISSION_CONTROL_URL
      Optional. Base URL of the mission-control web app, used to fire a
      best-effort POST /api/missions/<id>/notify after a status change so the
      learner gets a status email. This console remains fully functional
      (Firestore is still updated) if mission-control is unreachable or this
      is unset - the call is fire-and-forget. Defaults to
      http://localhost:3000.

The module file is named operator_console (not operator) so it does not
shadow Python's stdlib `operator` module.
"""

import os
import re
import threading
import time
from datetime import datetime, timezone
from functools import wraps

import requests
from flask import Blueprint, current_app, jsonify, redirect, render_template, request, session

operator_bp = Blueprint('operator', __name__, url_prefix='/operator')

# Timeouts (seconds)
LOGIN_TIMEOUT = 10.0
ROVER_TIMEOUT = 5.0
NOTIFY_TIMEOUT = 10.0

MISSIONS_COLLECTION = 'missions'
# Upper bound on a single page of finished missions. Not a cap on what the
# console can reach - the client pages through - just a guard so a stray
# ?finished=999999 cannot make the satellite render the whole archive at once.
MAX_FINISHED_PAGE = 200

# Accepts standard watch URLs and short youtu.be links (mirrors what the
# learner-facing mission page can embed).
YOUTUBE_URL_PATTERNS = (
    re.compile(r'^https?://(www\.)?youtube\.com/watch\?v=[\w-]+'),
    re.compile(r'^https?://youtu\.be/[\w-]+'),
)

IDENTITY_TOOLKIT_SIGN_IN = (
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword'
)

# Lazily initialised firebase_admin handles. Kept behind functions so tests
# can monkeypatch _firestore / _verify_id_token without firebase-admin or
# real credentials.
_firebase_app = None
# start_polling and start_sync_worker are both spawned as daemon threads at
# server startup (web_server.py) and each call into _init_firebase() as their
# very first action - without this lock, both can pass the `is not None`
# check before either finishes building credentials, and the second
# firebase_admin.initialize_app() call raises "app already exists".
_firebase_lock = threading.Lock()


def _web_api_key():
    return (
        os.environ.get('FIREBASE_WEB_API_KEY')
        or os.environ.get('NEXT_PUBLIC_FIREBASE_API_KEY')
    )


# Remembered so the login page and the status page do not each retry a broken
# credential, and so the reason is printed once rather than per request.
_admin_config_error = None


def _admin_configured():
    """Whether this satellite can actually authenticate, not whether some
    variables happen to be set.

    This used to require GOOGLE_APPLICATION_CREDENTIALS or all three
    FIREBASE_* key variables, which meant it reported "not configured" for a
    satellite running on Application Default Credentials - the mode staging,
    prod and now local dev all use. Sign-in was refused while the credential
    underneath it worked perfectly.

    Asking the real question instead: try to build the Firebase app, and say
    yes if it built. _init_firebase memoises, so this costs one attempt and
    then nothing.
    """
    global _admin_config_error
    try:
        _init_firebase()
        _admin_config_error = None
        return True
    except Exception as error:
        message = str(error)
        if message != _admin_config_error:
            _admin_config_error = message
            print(f'[operator] Firebase credentials unavailable: {message}')
        return False


def _clean_env(name):
    """An env value with surrounding quotes and whitespace removed, or None.

    .env files keep their quotes when a shell is not doing the parsing, and a
    quoted empty string is still empty.
    """
    raw = os.environ.get(name)
    if raw is None:
        return None
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        value = value[1:-1]
    return value or None


def _init_firebase():
    """Initialise firebase_admin once, from env credentials."""
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app

    import firebase_admin
    from firebase_admin import credentials

    with _firebase_lock:
        # Re-check inside the lock: whichever thread lost the race to
        # acquire it has almost certainly arrived here because the winner
        # already finished initialising.
        if _firebase_app is not None:
            return _firebase_app

        # Same three-way choice as mission-control's firebase-admin.ts, and
        # deliberately so: the two used to disagree, and the satellite quietly
        # talked to a different Firebase project for weeks.
        #
        #   both key variables set   -> that service account
        #   neither set              -> Application Default Credentials
        #   exactly one set          -> refuse, because it is a broken .env
        client_email = _clean_env('FIREBASE_CLIENT_EMAIL')
        private_key = _clean_env('FIREBASE_PRIVATE_KEY')

        if client_email and private_key:
            cred = credentials.Certificate({
                'type': 'service_account',
                'project_id': _clean_env('FIREBASE_PROJECT_ID'),
                'client_email': client_email,
                # \n in the private key survives .env files as the two
                # characters backslash-n; decode them back to newlines.
                'private_key': private_key.replace('\\n', '\n'),
                'token_uri': 'https://oauth2.googleapis.com/token',
            })
        elif client_email or private_key:
            # Falling back to ADC here would authenticate as a DIFFERENT
            # identity than the one intended, silently. Fail instead.
            missing = 'FIREBASE_PRIVATE_KEY' if client_email else 'FIREBASE_CLIENT_EMAIL'
            raise RuntimeError(
                f'Incomplete Firebase service account config: {missing} is not '
                f'set while the other half is. Set both, or unset both to use '
                f'Application Default Credentials.'
            )
        else:
            cred = credentials.ApplicationDefault()

        # Pass the project EXPLICITLY, as mission-control does.
        #
        # Without it firebase_admin infers the project from the credential, and
        # under ADC that is whatever `gcloud config get-value project` happens
        # to say - which on this machine was still the retired project. The
        # satellite would then report one project while FIREBASE_PROJECT_ID
        # said another, which is exactly the kind of disagreement that hid the
        # env drift in the first place.
        options = {}
        project_id = _clean_env('FIREBASE_PROJECT_ID')
        if project_id:
            options['projectId'] = project_id

        try:
            _firebase_app = firebase_admin.initialize_app(
                cred, options, name='operator-console',
            )
        except ValueError:
            # Already registered by something this lock didn't cover (e.g. a
            # prior dev-server run that left firebase_admin's process-wide
            # app registry populated) - reuse it instead of crashing.
            _firebase_app = firebase_admin.get_app(name='operator-console')

    return _firebase_app


def _firestore():
    from firebase_admin import firestore
    return firestore.client(app=_init_firebase())


def _verify_id_token(id_token):
    from firebase_admin import auth
    return auth.verify_id_token(id_token, app=_init_firebase())


def _rover_url():
    getter = current_app.config.get('ROVER_URL_GETTER')
    return getter() if getter else os.environ.get('ROVER_URL', 'http://marspi.local:8523')


def _mission_control_url():
    getter = current_app.config.get('MISSION_CONTROL_URL_GETTER')
    return getter() if getter else os.environ.get('MISSION_CONTROL_URL', 'http://localhost:3000')


def _notify_mission_control(mission_id, status):
    """Best-effort status-email trigger, called after Firestore is already
    updated. Must never raise - a learner missing an email is far cheaper
    than an operator unable to run the rover because mission-control happens
    to be down.
    """
    try:
        requests.post(
            f'{_mission_control_url()}/api/missions/{mission_id}/notify',
            json={'status': status},
            timeout=NOTIFY_TIMEOUT,
        )
    except requests.exceptions.RequestException:
        current_app.logger.warning(
            'Failed to notify mission-control of status change (mission=%s, status=%s)',
            mission_id, status,
        )


def _notify_mission_control_async(mission_id, status):
    """Fire _notify_mission_control on a background thread so a slow or
    unreachable mission-control - a Cloud Run cold start, or the venue wifi
    the operator console already has to tolerate - never delays the
    operator's response. The rover dispatch / Firestore write this follows
    has already succeeded by the time this is called.

    Flask's app context is thread-local and does not propagate to new
    threads automatically, so it's captured here (while still on the
    request's thread) and re-pushed inside the background thread.
    """
    app = current_app._get_current_object()

    def run():
        with app.app_context():
            _notify_mission_control(mission_id, status)

    threading.Thread(target=run, daemon=True).start()


def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

# Event-day escape hatch: OPERATOR_AUTH=off skips login entirely. Firebase
# sign-in needs internet, and venue wifi (science centre) can be too flaky to
# get operators through the front door. The satellite only serves the yard's
# own network, so open access for a day is an accepted trade. Unset the
# variable to restore normal auth.
OFFLINE_OPERATOR = {'uid': 'offline', 'email': 'offline operator', 'role': 'operator'}


def auth_disabled():
    return os.environ.get('OPERATOR_AUTH', '').strip().lower() in ('off', 'disabled', '0', 'false')


# How long a sign-in lasts before the operator must authenticate again, and how
# often a live session is re-checked against Firebase.
#
# The satellite verified the token once at sign-in and then trusted the Flask
# session for as long as the browser kept it. Mission Control re-verifies on
# every request with checkRevoked, so removing an operator there took effect at
# once - and did nothing at all here. Someone whose access was revoked kept the
# yard console, including Send, which moves a physical rover.
#
# It cannot simply copy Mission Control: this console exists to work with no
# internet, so a check that fails closed would lock an operator out of a rover
# mid-event because venue wifi dropped. The compromise is deliberate and has
# two halves.
SESSION_MAX_AGE = int(os.environ.get('OPERATOR_SESSION_MAX_AGE', 12 * 3600))
SESSION_RECHECK_EVERY = int(os.environ.get('OPERATOR_SESSION_RECHECK', 300))


def _session_expired(operator, now):
    started = operator.get('signed_in_at')
    return started is None or (now - started) > SESSION_MAX_AGE


def _still_authorised(operator, now):
    """Re-check a live session against Firebase, at most every few minutes.

    FAILS OPEN when Firebase cannot be reached. That is the offline-first
    trade: an operator standing at a rover with no internet keeps working, and
    the bound on how long a revoked session can survive is SESSION_MAX_AGE
    rather than forever.

    FAILS CLOSED when Firebase answers and says no - the account is gone,
    disabled, or no longer holds a role. That is the case that matters, since
    it is the one an admin just acted on.
    """
    if operator.get('uid') == OFFLINE_OPERATOR['uid']:
        return True

    if now - operator.get('checked_at', 0) < SESSION_RECHECK_EVERY:
        return True

    try:
        from firebase_admin import auth
        user = auth.get_user(operator['uid'], app=_init_firebase())
    except Exception:
        # Unreachable, or the credential is unavailable. Keep working.
        operator['checked_at'] = now
        session.modified = True
        return True

    if user.disabled:
        return False

    role = (user.custom_claims or {}).get('role')
    if role not in ('operator', 'admin'):
        return False

    # Pick up a promotion or demotion without needing a re-login.
    operator['role'] = role
    operator['checked_at'] = now
    session.modified = True
    return True


def current_operator():
    """The signed-in operator, or the offline stub when auth is disabled."""
    operator = session.get('operator')

    if operator:
        now = time.time()
        if _session_expired(operator, now) or not _still_authorised(operator, now):
            session.pop('operator', None)
            return OFFLINE_OPERATOR if auth_disabled() else None
        return operator

    return OFFLINE_OPERATOR if auth_disabled() else None


def require_operator(f):
    """API guard: 401 JSON unless an operator session exists (or auth is off)."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not current_operator():
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@operator_bp.route('/')
def console():
    """Kept as a redirect, not a page.

    The queue used to live here while the home page showed a read-only preview
    of the same list. Two screens rendering the same missions meant an operator
    picked one at random and the other was dead weight, so the queue moved to
    the home page and this is now just a bookmark that still works.
    """
    return redirect('/')


@operator_bp.route('/mission/<mission_id>')
def mission_page(mission_id):
    """One mission, with the controls for it - including Stop.

    Every action on a mission lives here rather than on the queue. The queue is
    for choosing what to work on; this is for doing it, and it is the screen an
    operator has open while a rover is actually moving.
    """
    operator = current_operator()
    if not operator:
        return redirect('/operator/login')
    return render_template('mission.html', operator=operator, mission_id=mission_id)


@operator_bp.route('/login')
def login_page():
    if current_operator():
        return redirect('/')
    return render_template(
        'operator_login.html',
        configured=bool(_web_api_key() and _admin_configured()),
    )


# ---------------------------------------------------------------------------
# Auth API
# ---------------------------------------------------------------------------

@operator_bp.route('/api/login', methods=['POST'])
def api_login():
    if not (_web_api_key() and _admin_configured()):
        return jsonify({'error': 'Operator console is not configured (Firebase credentials missing)'}), 503

    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip()
    password = data.get('password') or ''
    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    try:
        resp = requests.post(
            IDENTITY_TOOLKIT_SIGN_IN,
            params={'key': _web_api_key()},
            json={'email': email, 'password': password, 'returnSecureToken': True},
            timeout=LOGIN_TIMEOUT,
        )
    except requests.exceptions.RequestException:
        return jsonify({'error': 'Could not reach the sign-in service (no internet?)'}), 502

    if resp.status_code != 200:
        return jsonify({'error': 'Invalid email or password'}), 401

    try:
        claims = _verify_id_token(resp.json()['idToken'])
    except Exception:
        return jsonify({
            'error': 'Could not verify the sign-in token. Check that the satellite and '
                     'the web app use the same Firebase project (matching FIREBASE_* env).'
        }), 401

    role = claims.get('role')
    if role not in ('operator', 'admin'):
        return jsonify({'error': 'This account does not have operator access'}), 403

    now = time.time()
    session['operator'] = {
        'uid': claims.get('user_id') or claims.get('sub'),
        'email': claims.get('email') or email,
        'role': role,
        # Both are what bound the session: one caps its life, the other paces
        # the re-check against Firebase. See current_operator.
        'signed_in_at': now,
        'checked_at': now,
    }
    return jsonify({'status': 'ok', 'role': role})


@operator_bp.route('/api/logout', methods=['POST'])
def api_logout():
    session.pop('operator', None)
    return jsonify({'status': 'ok'})


# ---------------------------------------------------------------------------
# Missions API
# ---------------------------------------------------------------------------

def _mirror_row_to_dict(row):
    """Map a mission_mirror SQLite row (snake_case) to the API's camelCase
    shape - the frontend contract (home.html's queue, mission.html) predates
    the mirror and is unchanged by it.
    """
    return {
        'id': row['id'],
        'name': row.get('name'),
        'yardId': row.get('yard_id'),
        'code': row.get('code') or '',
        'blocklyState': row.get('blockly_state'),
        'status': row.get('status'),
        'submittedAt': row.get('submitted_at'),
        'startedAt': row.get('started_at'),
        'completedAt': row.get('completed_at'),
        'youtubeUrl': row.get('youtube_url'),
        'deleted': bool(row.get('deleted')),
        # Recovery flags. The home page already surfaces a needs-review banner
        # linking to each flagged mission, but the mission page could not see
        # the flag because it was not in this contract - so the banner led the
        # operator to a page offering nothing, which is worse than no banner.
        # The resolve endpoint has existed all along with no way to reach it.
        'needsReview': bool(row.get('needs_review')),
        'reviewReason': row.get('review_reason'),
    }


def _mirror_is_stale(last_synced_at):
    """Stale if we've never synced, or the last pull was over 60s ago."""
    if not last_synced_at:
        return True
    synced_time = datetime.fromisoformat(last_synced_at.replace('Z', '+00:00'))
    age = (datetime.now(timezone.utc) - synced_time).total_seconds()
    return age > 60


@operator_bp.route('/api/missions', methods=['GET'])
@require_operator
def api_missions():
    from mission_store import get_missions, outbox_count, status_counts, DEFAULT_FINISHED_PAGE
    from satellite_identity import yard_id

    # Scoped to this satellite's own yard (plan 3.3) so a second yard's
    # missions can never appear in, or be dispatched from, this console.
    # `finished` is how many completed/failed missions to include. Actionable
    # missions are always returned in full regardless of it, so paging can
    # never hide work an operator still has to do.
    try:
        finished = int(request.args.get('finished', DEFAULT_FINISHED_PAGE))
    except ValueError:
        finished = DEFAULT_FINISHED_PAGE
    finished = max(1, min(finished, MAX_FINISHED_PAGE))

    rows, last_synced, finished_total = get_missions(finished, yard_id=yard_id())

    return jsonify({
        'missions': [_mirror_row_to_dict(row) for row in rows],
        'stale': _mirror_is_stale(last_synced),
        'lastSyncedAt': last_synced,
        'pendingWrites': outbox_count(),
        'finishedShown': min(finished, finished_total),
        'finishedTotal': finished_total,
        # Counted in SQL, so the queue's filters can show a true total per
        # status rather than however many of that status happen to be on the
        # returned page.
        'counts': status_counts(yard_id=yard_id()),
    })


_acquire_lock = threading.Lock()
LEASE_TTL_SECONDS = 300  # 5 minutes


def _dispatch_to_rover(mission, mission_id=None):
    """POST a mission's Python onto the rover queue.

    Returns (True, None) on success or (False, response) where response is a
    ready-to-return (json, status) tuple. Shared by send and rerun.
    """
    params = {'code': mission.get('code') or ''}
    if mission.get('blocklyState'):
        params['blockly_state'] = mission['blocklyState']
    if mission_id:
        params['mission_id'] = mission_id

    try:
        resp = requests.post(
            f'{_rover_url()}/queue/add',
            json=[{'cmd': 'run_python', 'params': params}],
            timeout=ROVER_TIMEOUT,
        )
    except requests.exceptions.RequestException:
        return False, (jsonify({'error': 'Cannot connect to rover server'}), 503)

    if resp.status_code != 200:
        return False, (jsonify({'error': f'Rover queue rejected the mission (HTTP {resp.status_code})'}), 502)

    return True, None


@operator_bp.route('/api/missions/<mission_id>/send', methods=['POST'])
@require_operator
def api_send_to_rover(mission_id):
    """Claim the run for this mission+yard locally, then push Python to rover queue.

    Firestore is deliberately NOT touched here (plan PR 3): the request path
    runs entirely off SQLite so the console keeps working with no internet, and
    the sync worker is the only thing that talks to Firestore. The lock is
    still atomic - acquire_run uses BEGIN IMMEDIATE - so two simultaneous
    taps still produce exactly one dispatch to this yard's rover.

    Concurrency is scoped to (mission_id, yard_id): the same mission can run
    simultaneously on different yards.
    """
    from mission_store import acquire_run, release_run, get_mission
    from satellite_identity import yard_id

    now = _now_iso()
    yard = yard_id()

    # The SQLite transaction serialises across processes; this serialises the
    # rover dispatch that follows it within this process.
    with _acquire_lock:
        ok, reason, run = acquire_run(mission_id, yard, now)

    if not ok:
        messages = {
            'not-found': ('Mission not found', 404),
            'not-queued': ('Only queued missions can be sent to the rover', 400),
            'already-running': ('Mission is already running at this yard', 409),
        }
        msg, code = messages.get(reason, ('Lock failed', 500))
        return jsonify({'error': msg}), code

    mission = get_mission(mission_id)
    if not mission:
        release_run(mission_id, yard, 'queued', _now_iso())
        return jsonify({'error': 'Mission not found'}), 404

    ok, err = _dispatch_to_rover(_mirror_row_to_dict(mission), mission_id=mission_id)
    if not ok:
        # Nothing reached the rover, so put it back rather than holding the
        # run stuck in 'processing' with nothing driving it.
        release_run(mission_id, yard, 'queued', _now_iso())
        return err

    _notify_mission_control_async(mission_id, 'processing')
    return jsonify({'status': 'ok', 'missionId': mission_id})


@operator_bp.route('/api/missions/<mission_id>/rerun', methods=['POST'])
@require_operator
def api_rerun(mission_id):
    """Re-run a finished mission at this yard. Clears the run's completion
    and video so the new run starts fresh without stale data."""
    from mission_store import acquire_run, release_run, get_mission, get_run
    from satellite_identity import yard_id

    now = _now_iso()
    yard = yard_id()

    with _acquire_lock:
        existing_run = get_run(mission_id, yard)
        if existing_run and existing_run.get('status') not in ('completed', 'failed', 'cancelled'):
            return jsonify({'error': 'Run is still processing at this yard'}), 409

        # What to go back to if the rover never takes it. NOT 'queued': this
        # mission already finished once, and rolling a failed re-dispatch back
        # to 'queued' would erase that. The learner reads the mission's status
        # as Completed or Pending, so the wrong rollback tells a child their
        # finished mission is waiting again.
        previous = existing_run.get('status') if existing_run else 'queued'

        ok, reason, run = acquire_run(mission_id, yard, now, for_rerun=True)

    if not ok:
        messages = {
            'not-found': ('Mission not found', 404),
            'not-queued': ('Unable to queue run at this yard', 400),
            'already-running': ('Run is already going at this yard', 409),
        }
        msg, code = messages.get(reason, ('Could not start the run', 500))
        return jsonify({'error': msg}), code

    mission = get_mission(mission_id)
    if not mission:
        release_run(mission_id, yard, previous, _now_iso())
        return jsonify({'error': 'Mission not found'}), 404

    ok, err = _dispatch_to_rover(_mirror_row_to_dict(mission), mission_id=mission_id)
    if not ok:
        # Nothing reached the rover, so restore what was there before.
        release_run(mission_id, yard, previous, _now_iso())
        return err

    _notify_mission_control_async(mission_id, 'processing')
    return jsonify({'status': 'ok', 'missionId': mission_id})


@operator_bp.route('/api/missions/<mission_id>', methods=['GET'])
@require_operator
def api_mission(mission_id):
    """One mission, for the mission page."""
    from mission_store import get_mission

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404
    return jsonify({'mission': _mirror_row_to_dict(mission)})


@operator_bp.route('/api/missions/<mission_id>/stop', methods=['POST'])
@require_operator
def api_stop_mission(mission_id):
    """Halt the rover mid-run and put the mission back in the queue.

    The gap this fills: until now an operator standing next to a moving rover,
    in a hall full of children, had no control that stopped it. The rover has
    had an emergency stop the whole time (POST /queue/clear drops the queue and
    calls driver.stop()); nothing in the console was wired to it.

    The rover is stopped FIRST and the bookkeeping happens after. If Firestore,
    the mirror, or anything else fails, the robot has still stopped - that
    ordering is the whole point. A failed status write is a tidy-up problem; a
    rover that keeps driving because a database call raised is not.

    The mission goes back to 'queued' rather than 'failed' or 'cancelled': the
    code did not do anything wrong, somebody just needed the rover to stop, and
    it should be re-runnable with one tap. 'failed' would also reach the learner
    as a run that went wrong, which it did not.

    Deliberately works whatever state THIS mission is in. The button is on
    screen at all times, and refusing to stop a rover because the mission you
    happen to be looking at is not the one running would be indefensible - the
    rover is one machine and it may be carrying anything. When the mission is
    not the running one, the rover is still cleared and only the status write
    is skipped.
    """
    from mission_store import get_mission, get_run, release_run
    from satellite_identity import yard_id

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404

    yard = yard_id()
    run = get_run(mission_id, yard)
    was_running = run and run.get('status') == 'processing' if run else False

    try:
        resp = requests.post(f'{_rover_url()}/queue/clear', timeout=ROVER_TIMEOUT)
    except requests.exceptions.RequestException:
        return jsonify({
            'error': 'Could not reach the rover to stop it. If it is still moving, '
                     'use the power switch on the rover itself.'
        }), 503

    if resp.status_code != 200:
        return jsonify({
            'error': f'The rover refused the stop command (HTTP {resp.status_code}). '
                     'If it is still moving, use the power switch on the rover itself.'
        }), 502

    if not was_running:
        # Rover cleared, nothing to record: this mission was not the one on it.
        run_status = run.get('status') if run else 'queued'
        return jsonify({'status': 'ok', 'missionId': mission_id, 'newStatus': run_status})

    release_run(mission_id, yard, 'queued', _now_iso(), operator_decision=True)
    _notify_mission_control_async(mission_id, 'queued')
    return jsonify({'status': 'ok', 'missionId': mission_id, 'newStatus': 'queued'})


@operator_bp.route('/api/missions/<mission_id>/complete', methods=['POST'])
@require_operator
def api_mark_complete(mission_id):
    from mission_store import get_mission, get_run, release_run
    from satellite_identity import yard_id

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404

    yard = yard_id()
    run = get_run(mission_id, yard)
    if not run or run.get('status') not in ('queued', 'processing'):
        return jsonify({'error': 'Only queued or running missions can be marked complete'}), 400

    release_run(mission_id, yard, 'completed', _now_iso())
    _notify_mission_control_async(mission_id, 'completed')
    return jsonify({'status': 'ok', 'missionId': mission_id})


@operator_bp.route('/api/missions/<mission_id>/youtube', methods=['POST'])
@require_operator
def api_attach_youtube(mission_id):
    data = request.get_json(silent=True) or {}
    url = (data.get('url') or '').strip()
    if not url or not any(p.match(url) for p in YOUTUBE_URL_PATTERNS):
        return jsonify({'error': 'Use a youtube.com/watch?v=... or youtu.be/... URL'}), 400

    from mission_store import get_mission, get_run, set_run_field
    from satellite_identity import yard_id

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404

    yard = yard_id()
    run = get_run(mission_id, yard)
    if not run or run.get('status') != 'completed':
        return jsonify({'error': 'Attach the video after the mission is marked complete'}), 400

    set_run_field(mission_id, yard, {'youtube_url': url}, {'youtubeUrl': url},
                  mirror_to_mission=('youtube_url',))
    return jsonify({'status': 'ok', 'missionId': mission_id})


@operator_bp.route('/api/missions/<mission_id>/cancel', methods=['POST'])
@require_operator
def api_cancel_mission(mission_id):
    """Take a run out of the queue without executing it at this yard.

    The gap this fills: a learner submits a duplicate, or code that is never
    going to do anything, and today the only options are run it or leave it in
    the queue forever.

    Cancel rather than delete, deliberately. The mission is a child's work and
    the record of it should survive; 'cancelled' also reads as "Pending" on the
    learner's side (discoveryStatus.ts), so nobody is shown a rejection.
    """
    from mission_store import get_mission, get_run, release_run
    from satellite_identity import yard_id

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404

    yard = yard_id()
    run = get_run(mission_id, yard)
    if not run or run.get('status') not in ('queued', 'processing'):
        return jsonify({'error': 'Only queued or running missions can be cancelled'}), 400

    release_run(mission_id, yard, 'cancelled', _now_iso())
    return jsonify({'status': 'ok', 'missionId': mission_id})


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


@operator_bp.route('/api/missions/<mission_id>/delete', methods=['POST'])
@require_operator
def api_delete_mission(mission_id):
    """Remove a mission from the platform.

    Soft-delete underneath (see mission_store.delete_mission): the console
    offers no undo, so the operator is warned it is permanent, but the record
    survives for someone with database access. That asymmetry is deliberate -
    the warning has to be honest about what the OPERATOR can undo, which is
    nothing, while a mis-tap on a child's completed mission should still be
    recoverable by a human who can reach the database.

    Cancel is the reversible option and stays the default for "not going to
    run this". Delete is for a mission that should not exist at all.
    """
    from mission_store import get_mission, delete_mission

    mission = get_mission(mission_id, include_deleted=True)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404
    if mission.get('deleted'):
        return jsonify({'error': 'This mission is already deleted'}), 400

    delete_mission(mission_id, _now_iso())
    return jsonify({'status': 'ok', 'missionId': mission_id})


@operator_bp.route('/api/config/sync', methods=['GET', 'POST'])
@require_operator
def api_sync_config():
    """Read or change how often the satellite talks to Firestore.

    Worth being precise about what this controls, because it is easy to assume
    it is the console refreshing. It is not: the queue's own polling reads
    local SQLite and costs no Firestore quota at all. This is the background
    worker that reconciles the mirror with Firestore, and it is the only thing
    on the satellite billed against the daily read limit.
    """
    import json as _json
    from sync_worker import (
        sync_interval, reconcile_every, estimated_daily_reads,
        MIN_INTERVAL, MAX_INTERVAL, MIN_RECONCILE, MAX_RECONCILE,
    )
    from satellite_identity import CONFIG_FILE

    if request.method == 'GET':
        from mission_store import status_counts
        from satellite_identity import yard_id
        counts = status_counts(yard_id=yard_id())
        active = (counts.get('queued', 0) + counts.get('processing', 0))
        return jsonify({
            'interval': sync_interval(),
            'reconcileEvery': reconcile_every(),
            'activeMissions': active,
            'estimatedDailyReads': estimated_daily_reads(active_missions=active),
            'freeTierDailyReads': 50000,
            'limits': {
                'interval': [MIN_INTERVAL, MAX_INTERVAL],
                'reconcileEvery': [MIN_RECONCILE, MAX_RECONCILE],
            },
        })

    data = request.get_json(silent=True) or {}
    try:
        interval = int(data.get('interval', sync_interval()))
        reconcile = int(data.get('reconcileEvery', reconcile_every()))
    except (TypeError, ValueError):
        return jsonify({'error': 'interval and reconcileEvery must be whole numbers of seconds/cycles'}), 400

    if not MIN_INTERVAL <= interval <= MAX_INTERVAL:
        return jsonify({'error': f'Sync interval must be between {MIN_INTERVAL} and {MAX_INTERVAL} seconds'}), 400
    if not MIN_RECONCILE <= reconcile <= MAX_RECONCILE:
        return jsonify({'error': f'Reconcile every must be between {MIN_RECONCILE} and {MAX_RECONCILE} cycles'}), 400

    try:
        try:
            with open(CONFIG_FILE) as f:
                cfg = _json.load(f)
        except Exception:
            cfg = {}
        cfg['sync_interval'] = interval
        cfg['sync_reconcile_every'] = reconcile
        with open(CONFIG_FILE, 'w') as f:
            _json.dump(cfg, f, indent=2)
    except OSError as e:
        return jsonify({'error': f'Could not save the setting: {e}'}), 500

    from mission_store import status_counts
    from satellite_identity import yard_id
    counts = status_counts(yard_id=yard_id())
    active = counts.get('queued', 0) + counts.get('processing', 0)

    return jsonify({
        'status': 'ok',
        'interval': interval,
        'reconcileEvery': reconcile,
        'estimatedDailyReads': estimated_daily_reads(interval, reconcile, active),
    })


@operator_bp.route('/api/integrations', methods=['GET'])
@require_operator
def api_integrations():
    """Which integrations are configured - never their values.

    Deliberately read-only. Letting an operator paste API keys into this console
    would be a security regression: it is reachable by anyone on the venue
    network and OPERATOR_AUTH=off removes the login entirely on event days. The
    real need behind "let me configure it here" is "tell me whether it's set up",
    which this answers without putting a secret on a screen.
    """
    def state(configured, detail):
        return {'configured': bool(configured), 'detail': detail}

    yt_key = bool(_youtube_api_key())
    yt_channel = bool(_youtube_channel_id())

    return jsonify({
        'integrations': [
            {
                'id': 'firestore',
                'name': 'Firestore',
                'why': 'Syncs missions with mission-control.',
                # Says which credential is actually in use rather than
                # assuming a service account: ADC is what staging, prod and
                # local dev all use, and reporting it as a missing key sent
                # people looking for a variable that should not be set.
                **state(_admin_configured(),
                        ('Authenticated as ' + (
                            'a service account' if _clean_env('FIREBASE_CLIENT_EMAIL')
                            else 'Application Default Credentials'
                        )) if _admin_configured()
                        else 'Cannot reach Firebase. Run `gcloud auth application-default '
                             'login`, or set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY '
                             'together. The reason is in the satellite log.'),
            },
            {
                'id': 'youtube',
                'name': 'YouTube auto-link',
                'why': 'Finds uploaded videos by the MissionID in their description.',
                **state(yt_key and yt_channel,
                        'Key and channel set' if yt_key and yt_channel
                        else 'Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID (manual linking still works)'),
            },
            {
                'id': 'mission_control',
                'name': 'Mission Control',
                'why': 'Receives status changes so learners get their emails.',
                **state(True, _mission_control_url()),
            },
        ],
    })


@operator_bp.route('/api/missions/needs-review', methods=['GET'])
@require_operator
def api_needs_review():
    """Missions that were running when the satellite stopped.

    Surfaced as a distinct group rather than mixed into the queue: they are
    ambiguous, not queued, and an operator has to decide what happened.
    """
    from mission_store import get_needs_review

    return jsonify({
        'missions': [_mirror_row_to_dict(row) for row in get_needs_review()],
    })


@operator_bp.route('/api/missions/<mission_id>/resolve', methods=['POST'])
@require_operator
def api_resolve_review(mission_id):
    """Record the operator's decision about an interrupted mission.

    'completed' - they checked and the run finished.
    'requeue'   - put it back in the queue to be run again.

    Deliberately does NOT dispatch to the rover. Re-queuing makes the mission
    available for a human to send again; it never moves the robot by itself
    (plan 2.3).
    """
    from mission_store import get_mission, resolve_review

    data = request.get_json(silent=True) or {}
    outcome = (data.get('outcome') or '').strip()
    if outcome not in ('completed', 'requeue'):
        return jsonify({'error': "outcome must be 'completed' or 'requeue'"}), 400

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404
    if not mission.get('needs_review'):
        return jsonify({'error': 'This mission is not awaiting review'}), 400

    status = 'completed' if outcome == 'completed' else 'queued'
    resolve_review(mission_id, status, _now_iso())

    if status == 'completed':
        _notify_mission_control_async(mission_id, 'completed')

    return jsonify({'status': 'ok', 'missionId': mission_id, 'newStatus': status})


@operator_bp.route('/api/conflicts', methods=['GET'])
@require_operator
def api_conflicts():
    """Merges where the losing side was already terminal, so the team can see
    that reconciliation made a real decision rather than silently picking."""
    from mission_store import get_conflicts

    return jsonify({'conflicts': get_conflicts()})


@operator_bp.route('/api/health', methods=['GET'])
@require_operator
def api_rover_health():
    """Rover reachability for the console badge. Degraded queue = down."""
    result = {'rover_url': _rover_url(), 'reachable': False}
    try:
        resp = requests.get(f'{_rover_url()}/health', timeout=2.0)
        if resp.status_code == 200:
            data = resp.json()
            result['reachable'] = data.get('status') == 'ok'
            result['driver'] = data.get('driver')
            result['queue_size'] = data.get('queue_size')
    except requests.exceptions.RequestException:
        pass
    return jsonify(result)

# YouTube video fetching implementation

def _youtube_api_key():
    return os.environ.get('YOUTUBE_API_KEY')


def _youtube_channel_id():
    return os.environ.get('YOUTUBE_CHANNEL_ID')


def check_for_new_videos():
    """Poll the YouTube channel for uploads matching a completed mission's ID.

    Candidates come from the local mirror, not Firestore. The previous version
    streamed every completed mission out of Firestore on each pass: at one read
    per completed mission every five minutes, that was ~21,000 reads/day on
    this yard and rising with every child who finished a run - roughly 80% of
    the satellite's entire Firestore bill, for a list the mirror already had.

    (The old approach could not narrow that query either: a mission has no
    `youtubeUrl` field at all until one is attached, and Firestore's `== None`
    matches documents where the field is present and null, not absent. SQL has
    no such trouble.)

    Firestore is now touched only to WRITE a link that was actually found, so a
    quiet poll - which is nearly all of them - costs nothing at all.
    """
    print('[youtube-poll] Checking for new videos...')

    api_key = _youtube_api_key()
    channel_id = _youtube_channel_id()
    if not api_key or not channel_id:
        print('[youtube-poll] Missing YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID; skipping poll')
        return

    from mission_store import completed_without_video
    from satellite_identity import yard_id

    unlinked_ids = completed_without_video(yard_id=yard_id())
    if not unlinked_ids:
        # Nothing to look for, so do not spend a YouTube API call either.
        return

    # The uploads playlist id is the channel id with UC -> UU.
    uploads_playlist = channel_id.replace('UC', 'UU', 1)

    try:
        response = requests.get(
            'https://www.googleapis.com/youtube/v3/playlistItems',
            params={
                'part': 'snippet',
                'playlistId': uploads_playlist,
                'maxResults': 50,
                'key': api_key,
            },
            timeout=10.0,
        )
    except requests.exceptions.RequestException as e:
        print(f'[youtube-poll] Could not reach the YouTube API: {e}')
        return

    if response.status_code != 200:
        print(f'[youtube-poll] YouTube API error: HTTP {response.status_code}')
        return

    videos = response.json().get('items', [])

    # Built on the first actual match, not up front: constructing the client is
    # the only thing here that can fail when the yard is offline, and a poll
    # that matches nothing should not be able to log an error about Firestore.
    missions_ref = None

    # Match mission ids embedded in video descriptions.
    for mission_id in unlinked_ids:
        for video in videos:
            description = video.get('snippet', {}).get('description', '')

            if f'MissionID: {mission_id}' in description:
                video_id = video.get('snippet', {}).get('resourceId', {}).get('videoId')
                if not video_id:
                    continue
                youtube_url = f'https://www.youtube.com/watch?v={video_id}'

                # Plan 7.5: this poll writes to Firestore directly rather than
                # through the outbox (it only runs online anyway, since it needs
                # the YouTube API). Skip any mission with a pending local write,
                # or this would land between the flush's read and write and be
                # clobbered - or clobber it.
                if _has_pending_writes(mission_id):
                    print(f'[youtube-poll] Skipping {mission_id}: local writes pending')
                    break

                try:
                    if missions_ref is None:
                        missions_ref = _firestore().collection(MISSIONS_COLLECTION)
                    missions_ref.document(mission_id).update({'youtubeUrl': youtube_url})
                except Exception as e:
                    # Leave the mirror alone so this mission is still a
                    # candidate next pass; the link is not lost, just not
                    # written yet.
                    print(f'[youtube-poll] Could not link {mission_id}: {e}')
                    break

                _mirror_youtube_url(mission_id, youtube_url)
                print(f'[youtube-poll] Linked mission {mission_id} to video {video_id}')
                break


def _has_pending_writes(mission_id):
    """True if the outbox still holds an unflushed change for this mission."""
    try:
        from mission_store import mission_has_pending
        return mission_has_pending(mission_id)
    except Exception:
        # If we cannot tell, assume there are: skipping one poll cycle is
        # cheaper than racing a flush.
        return True


def _mirror_youtube_url(mission_id, url):
    """Keep the mirror in step with a direct Firestore write, so the console
    shows the link without waiting for the next pull."""
    try:
        from mission_store import set_mirror_only
        set_mirror_only(mission_id, {'youtube_url': url})
    except Exception:
        pass


def start_polling():
    """Run check_for_new_videos every 5 minutes.

    A bad poll (Firestore hiccup, YouTube API down, anything unexpected)
    must never stop the loop - the reschedule always has to run, or the
    feature silently dies until the satellite is restarted.
    """
    try:
        check_for_new_videos()
    except Exception as e:
        print(f'[youtube-poll] Unexpected error during poll: {e}')

    timer = threading.Timer(300, start_polling)
    timer.daemon = True
    timer.start()

