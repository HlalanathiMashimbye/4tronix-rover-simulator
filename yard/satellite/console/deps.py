"""
Firebase and environment access for the operator console.

Everything the console needs to answer "who are we, and can we talk to
Firebase" lives here, in one module with no dependency on any route. That
matters because these are the collaborators tests replace: with them in a
1399-line module beside twenty-three routes, a test could only reach them by
monkeypatching the whole console.

Names lost their leading underscore in the move. They were file-private in a
single-module console; they are a module boundary now, and the underscore
would say the opposite of what is true.
"""

import os
import threading

from flask import current_app

# Lazily initialised firebase_admin handles. Kept behind functions so tests
# can replace firestore_client / verify_id_token without firebase-admin or
# real credentials.
_firebase_app = None
# start_polling and start_sync_worker are both spawned as daemon threads at
# server startup (web_server.py) and each call into init_firebase() as their
# very first action - without this lock, both can pass the `is not None`
# check before either finishes building credentials, and the second
# firebase_admin.initialize_app() call raises "app already exists".
_firebase_lock = threading.Lock()


def web_api_key():
    return (
        os.environ.get('FIREBASE_WEB_API_KEY')
        or os.environ.get('NEXT_PUBLIC_FIREBASE_API_KEY')
    )


# Remembered so the login page and the status page do not each retry a broken
# credential, and so the reason is printed once rather than per request.
_admin_config_error = None


def admin_configured():
    """Whether this satellite can actually authenticate, not whether some
    variables happen to be set.

    This used to require GOOGLE_APPLICATION_CREDENTIALS or all three
    FIREBASE_* key variables, which meant it reported "not configured" for a
    satellite running on Application Default Credentials - now the only mode
    there is. Sign-in was refused while the credential underneath it worked
    perfectly.

    Asking the real question instead: try to build the Firebase app, and say
    yes if it built. init_firebase memoises, so this costs one attempt and
    then nothing.
    """
    global _admin_config_error
    try:
        init_firebase()
        _admin_config_error = None
        return True
    except Exception as error:
        message = str(error)
        if message != _admin_config_error:
            _admin_config_error = message
            print(f'[operator] Firebase credentials unavailable: {message}')
        return False


def clean_env(name):
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


def init_firebase():
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

        # Application Default Credentials, and only that, matching
        # mission-control's firebase-admin.ts. The two have to agree: they used
        # to disagree, and the satellite quietly talked to a different Firebase
        # project for weeks.
        #
        # The service-account branch that used to sit here is gone. Firestore
        # lives in the same project as everything that reads it, so the branch
        # authenticated nothing and existed only as a documented reason to keep
        # a private key in a .env on a Pi that sits on a venue's wifi.
        #
        # A leftover key is refused rather than ignored: somebody with these
        # set believes they are running as that service account, and silently
        # using ADC instead would run as a different identity.
        leftover = [
            name for name in ('FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY')
            if clean_env(name)
        ]
        if leftover:
            raise RuntimeError(
                f'{" and ".join(leftover)} set, but the service-account credential '
                f'path has been removed. Authentication is Application Default '
                f'Credentials only: run `gcloud auth application-default login`, '
                f'clear these from .env, and delete the key in the Google Cloud '
                f'console, since a key that still exists is still a way in.'
            )

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
        project_id = clean_env('FIREBASE_PROJECT_ID')
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


def firestore_client():
    from firebase_admin import firestore
    return firestore.client(app=init_firebase())


def verify_id_token(id_token):
    from firebase_admin import auth
    return auth.verify_id_token(id_token, app=init_firebase())



def rover_url():
    """Where the rover server is, per request.

    The getter in app config wins so the settings page can repoint a running
    satellite at a different rover without a restart.
    """
    getter = current_app.config.get('ROVER_URL_GETTER')
    return getter() if getter else os.environ.get('ROVER_URL', 'http://marspi.local:8523')


DEFAULT_MISSION_CONTROL_URL = 'http://localhost:3000'


def mission_control_is_configured():
    """Whether anything actually pointed this satellite at a Mission Control.

    Worth asking separately from mission_control_url(), which always returns
    something. The default is right on a laptop and wrong on every yard Pi,
    where it means the status-change POST goes to a port with nothing behind
    it: the learner's email is then silently never sent, because notify
    swallows the failure by design.
    """
    if current_app.config.get('MISSION_CONTROL_URL_GETTER'):
        return True
    return bool((os.environ.get('MISSION_CONTROL_URL') or '').strip())


def mission_control_url():
    getter = current_app.config.get('MISSION_CONTROL_URL_GETTER')
    return getter() if getter else os.environ.get('MISSION_CONTROL_URL', DEFAULT_MISSION_CONTROL_URL)
