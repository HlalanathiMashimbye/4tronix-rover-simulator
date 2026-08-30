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

import youtube_poll
from console import auth, deps, notify
# Re-exported, not re-implemented: web_server.py and the templates reach the
# console through this module, and these are the names they use. The bodies
# live in the console package.
from console.auth import current_operator, require_operator  # noqa: F401

# operator_bp and the auth layer now live in the console package.
from console.blueprint import operator_bp

# Timeouts (seconds)
ROVER_TIMEOUT = 5.0
NOTIFY_TIMEOUT = 10.0

MISSIONS_COLLECTION = 'missions'
# Upper bound on a single page of finished missions. Not a cap on what the
# console can reach - the client pages through - just a guard so a stray
# ?finished=999999 cannot make the satellite render the whole archive at once.
MAX_FINISHED_PAGE = 200

# Accepts standard watch URLs and short youtu.be links (mirrors what the
# learner-facing mission page can embed). Defined in youtube_poll, which owns
# what a YouTube URL means; re-exported here for the attach route below.
YOUTUBE_URL_PATTERNS = youtube_poll.YOUTUBE_URL_PATTERNS




def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')



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
        # BACKLOG 335/336/338. recording_path/timestamps stay run-internal -
        # a filesystem path on the satellite isn't operator-facing information.
        'recordingStatus': row.get('recording_status') or 'none',
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
            f'{deps.rover_url()}/queue/add',
            json=[{'cmd': 'run_python', 'params': params}],
            timeout=ROVER_TIMEOUT,
        )
    except requests.exceptions.RequestException:
        return False, (jsonify({'error': 'Cannot connect to rover server'}), 503)

    if resp.status_code != 200:
        return False, (jsonify({'error': f'Rover queue rejected the mission (HTTP {resp.status_code})'}), 502)

    return True, None


def _begin_recording(mission_id, yard):
    """Start recording right after a successful dispatch (BACKLOG 335).

    Best-effort and never surfaced as a request failure: by the time this
    runs the rover has already been dispatched, which is irreversible, so a
    camera hiccup here is a warning to log, not a reason to fail the response.
    Returns whether recording actually started, for the caller to pass on to
    the operator as a soft signal.
    """
    from recording_control import start_recording
    from mission_store import set_run_recording_state

    ok, detail = start_recording(mission_id, yard)
    if ok:
        set_run_recording_state(mission_id, yard, 'recording', path=detail, started_at=_now_iso())
    else:
        current_app.logger.warning('Recording did not start for %s/%s: %s', mission_id, yard, detail)
    return ok


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

    A camera readiness check (BACKLOG 334) runs before the lock is even
    touched: readiness has nothing to do with which mission is being sent, so
    there is no claim to roll back on failure. Refusing here, rather than
    after dispatch, is the whole point - a mission with no camera up produces
    a run nobody will ever have video of.
    """
    from mission_store import acquire_run, release_run, get_mission
    from recording_control import is_ready
    from satellite_identity import yard_id

    ready, detail = is_ready()
    if not ready:
        return jsonify({
            'error': f'Camera is not ready ({detail}). Fix the camera feed before '
                     'sending a mission - a run with no video cannot be reviewed later.',
        }), 503

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

    recording_started = _begin_recording(mission_id, yard)
    notify.notify_mission_control_async(mission_id, 'processing')
    return jsonify({'status': 'ok', 'missionId': mission_id, 'recordingStarted': recording_started})


@operator_bp.route('/api/missions/<mission_id>/rerun', methods=['POST'])
@require_operator
def api_rerun(mission_id):
    """Re-run a finished mission at this yard. Clears the run's completion
    and video so the new run starts fresh without stale data.

    Gets the same camera readiness check and recording start as Send (BACKLOG
    334/335): a rerun is a real dispatch to the rover, so a rerun with no
    video would defeat the point exactly as much as a first run would.
    """
    from mission_store import acquire_run, release_run, get_mission, get_run
    from recording_control import is_ready
    from satellite_identity import yard_id

    ready, detail = is_ready()
    if not ready:
        return jsonify({
            'error': f'Camera is not ready ({detail}). Fix the camera feed before '
                     'rerunning a mission - a run with no video cannot be reviewed later.',
        }), 503

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

    recording_started = _begin_recording(mission_id, yard)
    notify.notify_mission_control_async(mission_id, 'processing')
    return jsonify({'status': 'ok', 'missionId': mission_id, 'recordingStarted': recording_started})


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
    """Halt the rover mid-run and cancel the run.

    The gap this fills: until now an operator standing next to a moving rover,
    in a hall full of children, had no control that stopped it. The rover has
    had an emergency stop the whole time (POST /queue/clear drops the queue and
    calls driver.stop()); nothing in the console was wired to it.

    The rover is stopped FIRST and the bookkeeping happens after. If Firestore,
    the mirror, or anything else fails, the robot has still stopped - that
    ordering is the whole point. A failed status write is a tidy-up problem; a
    rover that keeps driving because a database call raised is not.

    The run goes to 'cancelled' rather than 'failed': the code did not do
    anything wrong, somebody just needed the rover to stop, and 'failed' would
    reach the learner as a run that went wrong, which it did not. 'cancelled'
    is what api_cancel_mission already uses for exactly that property - reads
    as "Pending" to the learner, nobody is shown a rejection - and it is still
    one tap away from running again via rerun. Its recording (BACKLOG 338) is
    discarded in the same request: an operator stopping the rover in real time
    has already made the call, unlike a rover-reported error, which waits for
    a review decision instead (see mission_watcher.flag_for_review).

    Deliberately works whatever state THIS mission is in. The button is on
    screen at all times, and refusing to stop a rover because the mission you
    happen to be looking at is not the one running would be indefensible - the
    rover is one machine and it may be carrying anything. When the mission is
    not the running one, the rover is still cleared and only the status write
    is skipped.
    """
    from mission_store import get_mission, get_run, release_run
    from recording_control import stop_recording
    from satellite_identity import yard_id

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404

    yard = yard_id()
    run = get_run(mission_id, yard)
    was_running = run and run.get('status') == 'processing' if run else False

    try:
        resp = requests.post(f'{deps.rover_url()}/queue/clear', timeout=ROVER_TIMEOUT)
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

    release_run(mission_id, yard, 'cancelled', _now_iso(), operator_decision=True)
    stop_recording(mission_id, yard, keep=False)
    notify.notify_mission_control_async(mission_id, 'cancelled')
    return jsonify({
        'status': 'ok', 'missionId': mission_id, 'newStatus': 'cancelled', 'recordingDiscarded': True,
    })


@operator_bp.route('/api/missions/<mission_id>/complete', methods=['POST'])
@require_operator
def api_mark_complete(mission_id):
    from mission_store import get_mission, get_run, release_run
    from recording_control import stop_recording
    from satellite_identity import yard_id

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404

    yard = yard_id()
    run = get_run(mission_id, yard)
    if not run or run.get('status') not in ('queued', 'processing'):
        return jsonify({'error': 'Only queued or running missions can be marked complete'}), 400

    release_run(mission_id, yard, 'completed', _now_iso())
    stop_recording(mission_id, yard, keep=True)
    notify.notify_mission_control_async(mission_id, 'completed')
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

    A 'processing' run being cancelled here still gets its recording discarded
    (BACKLOG 338), for the same reason STOP does: a run that ends up
    'cancelled' should never carry a video a future upload step could mistake
    for a successful run - however the cancellation happened to reach it. This
    route does not itself stop the rover; that gap is pre-existing and
    unrelated to recording.
    """
    from mission_store import get_mission, get_run, release_run
    from recording_control import stop_recording
    from satellite_identity import yard_id

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404

    yard = yard_id()
    run = get_run(mission_id, yard)
    if not run or run.get('status') not in ('queued', 'processing'):
        return jsonify({'error': 'Only queued or running missions can be cancelled'}), 400

    was_running = run.get('status') == 'processing'
    release_run(mission_id, yard, 'cancelled', _now_iso())
    if was_running:
        stop_recording(mission_id, yard, keep=False)
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

    yt_key = bool(youtube_poll.api_key())
    yt_channel = bool(youtube_poll.channel_id())

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
                **state(deps.admin_configured(),
                        ('Authenticated as ' + (
                            'a service account' if deps.clean_env('FIREBASE_CLIENT_EMAIL')
                            else 'Application Default Credentials'
                        )) if deps.admin_configured()
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
                **state(True, deps.mission_control_url()),
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

    'completed' - they checked and the run finished. Its recording (already
                  'kept' by mission_watcher.flag_for_review, BACKLOG 338) is
                  left untouched - it is exactly the video this run produced.
    'requeue'   - put it back in the queue to be run again. The old recording
                  is discarded: a fresh one is made when it actually reruns,
                  and a stale video should not follow a mission back into the
                  ordinary queue as if nothing had happened.
    'cancelled' - the operator decided the interrupted run should not count
                  (BACKLOG 338). Its recording is discarded - the whole point
                  of this outcome is that it must never be mistaken for a
                  successful run's video.

    Deliberately does NOT dispatch to the rover. Re-queuing makes the mission
    available for a human to send again; it never moves the robot by itself
    (plan 2.3).
    """
    from mission_store import get_mission, resolve_review
    from recording_control import stop_recording
    from satellite_identity import yard_id

    data = request.get_json(silent=True) or {}
    outcome = (data.get('outcome') or '').strip()
    if outcome not in ('completed', 'requeue', 'cancelled'):
        return jsonify({'error': "outcome must be 'completed', 'requeue', or 'cancelled'"}), 400

    mission = get_mission(mission_id)
    if mission is None:
        return jsonify({'error': 'Mission not found'}), 404
    if not mission.get('needs_review'):
        return jsonify({'error': 'This mission is not awaiting review'}), 400

    status = {'completed': 'completed', 'requeue': 'queued', 'cancelled': 'cancelled'}[outcome]
    resolve_review(mission_id, status, _now_iso())

    if status != 'completed':
        # 'queued' (fresh rerun ahead) and 'cancelled' (must never look
        # successful) both discard the recording left over from the
        # interrupted run; only 'completed' keeps it.
        stop_recording(mission_id, yard_id(), keep=False)

    if status == 'completed':
        notify.notify_mission_control_async(mission_id, 'completed')

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
    result = {'rover_url': deps.rover_url(), 'reachable': False}
    try:
        resp = requests.get(f'{deps.rover_url()}/health', timeout=2.0)
        if resp.status_code == 200:
            data = resp.json()
            result['reachable'] = data.get('status') == 'ok'
            result['driver'] = data.get('driver')
            result['queue_size'] = data.get('queue_size')
    except requests.exceptions.RequestException:
        pass
    return jsonify(result)

# YouTube auto-linking lives in youtube_poll.py. These two wrappers stay so
# the console remains the one place that knows how to reach Firebase, and so
# the names web_server.py and the tests already use keep working.

def check_for_new_videos():
    """Run one YouTube poll, using this module's Firestore accessor."""
    return youtube_poll.check_for_new_videos(deps.firestore_client, MISSIONS_COLLECTION)


def start_polling():
    """Start the five-minute YouTube poll loop."""
    youtube_poll.poll_forever(check_for_new_videos)
