"""
The mission queue: what the operator actually does all day.

Listing the queue, dispatching a mission to the rover, re-running it,
stopping it, and recording the outcome (complete, cancel, delete, attach a
video). This is the console's real job, and in the old single-module shape it
was interleaved with camera control, sync settings and the review flow.

Everything here reads and writes the local SQLite mirror rather than
Firestore, which is what lets an operator keep working with no internet; the
sync worker reconciles later. The one exception is the YouTube link, which is
attached to the run and mirrored.
"""

import threading

import requests
from flask import current_app, jsonify, request

import youtube_links
from console import deps, mirror, notify
from console.auth import require_operator
from console.blueprint import operator_bp

ROVER_TIMEOUT = 5.0
MISSIONS_COLLECTION = 'missions'

# The console never renders more than this many finished missions in one
# page, however many the client asks for.
MAX_FINISHED_PAGE = 200

# Accepted shapes for a manually attached link, from the module that owns
# what a YouTube URL means.
YOUTUBE_URL_PATTERNS = youtube_links.YOUTUBE_URL_PATTERNS



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
        'missions': [mirror.mirror_row_to_dict(row) for row in rows],
        'stale': mirror.mirror_is_stale(last_synced),
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
        set_run_recording_state(mission_id, yard, 'recording', path=detail, started_at=mirror.now_iso())
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

    now = mirror.now_iso()
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
        release_run(mission_id, yard, 'queued', mirror.now_iso())
        return jsonify({'error': 'Mission not found'}), 404

    ok, err = _dispatch_to_rover(mirror.mirror_row_to_dict(mission), mission_id=mission_id)
    if not ok:
        # Nothing reached the rover, so put it back rather than holding the
        # run stuck in 'processing' with nothing driving it.
        release_run(mission_id, yard, 'queued', mirror.now_iso())
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

    now = mirror.now_iso()
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
        release_run(mission_id, yard, previous, mirror.now_iso())
        return jsonify({'error': 'Mission not found'}), 404

    ok, err = _dispatch_to_rover(mirror.mirror_row_to_dict(mission), mission_id=mission_id)
    if not ok:
        # Nothing reached the rover, so restore what was there before.
        release_run(mission_id, yard, previous, mirror.now_iso())
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
    return jsonify({'mission': mirror.mirror_row_to_dict(mission)})


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

    release_run(mission_id, yard, 'cancelled', mirror.now_iso(), operator_decision=True)
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

    release_run(mission_id, yard, 'completed', mirror.now_iso())
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
    release_run(mission_id, yard, 'cancelled', mirror.now_iso())
    if was_running:
        stop_recording(mission_id, yard, keep=False)
    return jsonify({'status': 'ok', 'missionId': mission_id})



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

    delete_mission(mission_id, mirror.now_iso())
    return jsonify({'status': 'ok', 'missionId': mission_id})
