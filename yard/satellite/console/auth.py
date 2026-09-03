"""
Who is signed in, and whether they may act.

Authentication, the session lifetime rules, the sign-in and sign-out routes,
and the three page shells behind them. Pulled out of the console because it
is the concern every other route depends on and none of them should contain:
require_operator guards nearly all twenty-three routes, and it used to be
defined a hundred lines above the queue endpoints it protects.
"""

import os
import time
from functools import wraps

import requests
from flask import jsonify, redirect, render_template, request, session

from console import deps
from console.blueprint import operator_bp
import tunables

IDENTITY_TOOLKIT_SIGN_IN = (
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword'
)

# Sign-in goes over the venue's wifi, which is the connection this whole
# console is built to tolerate being bad.
LOGIN_TIMEOUT = 10.0

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
# Functions, not constants: these are Settings-page tunables now, and a value
# captured at import would need a restart of a box nobody restarts on purpose.
# tunables keeps the old env vars as the defaults.
def session_max_age():
    return tunables.get('sessionMaxAge')


def session_recheck_every():
    return tunables.get('sessionRecheck')


def session_expired(operator, now):
    started = operator.get('signed_in_at')
    return started is None or (now - started) > session_max_age()


def still_authorised(operator, now):
    """Re-check a live session against Firebase, at most every few minutes.

    FAILS OPEN when Firebase cannot be reached. That is the offline-first
    trade: an operator standing at a rover with no internet keeps working, and
    the bound on how long a revoked session can survive is session_max_age()
    rather than forever.

    FAILS CLOSED when Firebase answers and says no - the account is gone,
    disabled, or no longer holds a role. That is the case that matters, since
    it is the one an admin just acted on.
    """
    if operator.get('uid') == OFFLINE_OPERATOR['uid']:
        return True

    if now - operator.get('checked_at', 0) < session_recheck_every():
        return True

    try:
        from firebase_admin import auth
        user = auth.get_user(operator['uid'], app=deps.init_firebase())
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
        if session_expired(operator, now) or not still_authorised(operator, now):
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
        configured=bool(deps.web_api_key() and deps.admin_configured()),
    )


# ---------------------------------------------------------------------------
# Auth API
# ---------------------------------------------------------------------------

@operator_bp.route('/api/login', methods=['POST'])
def api_login():
    if not (deps.web_api_key() and deps.admin_configured()):
        return jsonify({'error': 'Operator console is not configured (Firebase credentials missing)'}), 503

    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip()
    password = data.get('password') or ''
    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400

    try:
        resp = requests.post(
            IDENTITY_TOOLKIT_SIGN_IN,
            params={'key': deps.web_api_key()},
            json={'email': email, 'password': password, 'returnSecureToken': True},
            timeout=LOGIN_TIMEOUT,
        )
    except requests.exceptions.RequestException:
        return jsonify({'error': 'Could not reach the sign-in service (no internet?)'}), 502

    if resp.status_code != 200:
        return jsonify({'error': 'Invalid email or password'}), 401

    try:
        claims = deps.verify_id_token(resp.json()['idToken'])
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
