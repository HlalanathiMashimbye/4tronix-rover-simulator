"""
Watcher - releases the camera when the rover says the run is over.

This used to also complete missions: the satellite mirrored Firestore, held a
'processing' row per run, and the watcher closed it out so a mission did not
sit there forever because an operator turned to the next child. That whole
half is gone with the mirror. Mission bookkeeping happens in Mission Control
now, where an operator marks the run complete against the real record.

What is left is the half that has nothing to do with Firestore and cannot move
there: the recording. The camera is on this box, the file is on this box, and
the only thing that knows a run has finished is the rover on the local
network. So this polls the rover and stops filming what it says is done.

Why this is allowed under plan 2.3 ("never move the robot without a human"):
that rule forbids automatically DISPATCHING, because a physical action cannot
be replayed. Reading an outcome the rover already reported moves nothing. This
never sends anything to the rover - it only reads /queue/status.

Left running, a recording grows at roughly 87KB/s, about 7.5GB a day on a 64GB
card, and has no moov atom until it is closed, which means every one of those
files is unplayable. That is the failure this exists to prevent.

WHICH RUN, NOT WHICH MISSION. The rover's history keeps recent attempts, so
"has m1 finished?" is already true when a re-run of m1 starts, and that re-run's
recording was stopped within one poll. The queue proxy now records the id the
rover gave each dispatch (recording_control.note_dispatch), and a recording
stops when one of its own dispatches finishes. A recording with no dispatch on
record, started by hand, still falls back to the mission id.

AND A RECORDING NOTHING WILL EVER STOP IS STOPPED ANYWAY. A rover switched off
mid-run never reports finishing at all; see MAX_RECORDING_SECONDS.
"""

import threading
import time

import requests

from recording_control import (
    dispatches_for,
    overdue_recordings,
    started_at,
    recording_key,
    recordings_at,
    stop_recording,
)

ROVER_POLL_TIMEOUT = 3.0

# How long a recording keeps going after the rover says its run is over is
# the `recordingTail` setting (tunables.py), read on every pass so a change on
# Settings applies to the next run. The rover reports a run finished the
# moment the program returns, and the camera's picture of that moment arrives
# a little later, so stopping on the report cut the end off the video.

# How often the rover is asked whether a run is over, while one is filming.
# Half a second, so the video ends within half a second of its tail after
# the run, where it used to be anything up to ten. It costs nothing when idle,
# because the rover is only asked while a recording is open.
ROVER_POLL_SECONDS = 0.5

# Uploads still waiting and recordings past the cap change over minutes, not
# seconds, so they keep the old pace on their own timer rather than following
# the rover check down to one second.
HOUSEKEEPING_SECONDS = 10
CLEANUP_SECONDS = 300

# The longest a recording may run before it is stopped whatever the rover says.
#
# A mission is capped at 120 seconds on both sides of the LAN and the station
# adds a second of lead-in, so a recording past ten minutes is not a run still
# going. It is a recording nothing is going to stop: the rover lost power
# mid-run and never reported finishing, or somebody started one by hand and
# walked away. Ten minutes rather than three leaves room for a short queue of
# runs ahead of this one.
MAX_RECORDING_SECONDS = 600


def _mission_id_of(entry):
    params = entry.get('params')
    if isinstance(params, dict):
        return params.get('mission_id')
    return None


def _this_yard(yard_id):
    if yard_id is not None:
        return yard_id
    from satellite_identity import yard_id as get_yard_id
    try:
        return get_yard_id()
    except Exception:
        return 'curiosity'


def finished_runs(rover_url):
    """[(instruction_id, mission_id, status)] for every run the rover says has ended.

    Completed and errored both count: a run the rover could not execute is
    still over. None when the rover could not be asked. Never raises: an
    unreachable rover must not stop the watcher, and "I could not tell" must
    never be read as "it finished".
    """
    try:
        resp = requests.get(f'{rover_url}/queue/status', timeout=ROVER_POLL_TIMEOUT)
        if resp.status_code != 200:
            return None
        data = resp.json() or {}
    except (requests.exceptions.RequestException, ValueError):
        return None

    runs = []
    for entry in data.get('history') or []:
        if not isinstance(entry, dict) or entry.get('status') not in ('completed', 'error'):
            continue
        mission_id = _mission_id_of(entry)
        if mission_id:
            runs.append((entry.get('id'), mission_id, entry['status']))
    return runs


# What the watcher knows about each recording, keyed (recording, yard):
#   started   when that recording started; it is what makes the entry this
#             recording's, so a re-run under the same name starts afresh
#   before    ids of the runs already over the first time the rover answered
#             after this recording started, or None until it has
#   stop_at   when to stop it, once its run is over and the tail has run
#   finished  the run that ended it, for the upload
_watched = {}


def stop_finished_recordings(rover_url, yard_id=None, on_recording_ready=None,
                             tail_seconds=0.0, now=None):
    """Stop filming every run at this yard the rover says is over. Returns them.

    A recording's run is the one the queue proxy dispatched while it was open
    (dispatches_for). One started by hand has no dispatch, and falls back to
    a run of the mission it is named after, but only a run that finished after
    the recording started. Without that, re-running a mission matched the
    previous run of it, already completed in the rover's history: the
    recording stopped in the lead-in second before the rover was sent
    anything, or, when the send failed, the page said Mission complete for a
    rover that never moved.

    With a tail, a finished run is filmed for `tail_seconds` more before it
    stops, so the video shows the rover come to rest; the watcher's loop uses
    the recordingTail setting. A run in its tail is not asked about again, so an
    unreachable rover cannot leave it filming.

    keep=True for errors as well as successes: a run the rover could not
    execute may still have filmed something worth seeing, and that judgement
    belongs to whoever watches it.

    on_recording_ready gets the rover's status for the run as well, completed
    or error, so the upload can say which: an uploaded video closes its run in
    Mission Control, and a run the rover could not execute is not closed that
    way. Only a dispatched run uploads, because the upload names the run.
    """
    yard_id = _this_yard(yard_id)
    now = time.monotonic() if now is None else now
    filming = {recording: started_at(recording, yard_id) for recording in recordings_at(yard_id)}

    # Forget any whose recording stopped some other way, or has been replaced
    # by a new recording under the same name.
    for key, state in list(_watched.items()):
        if key[1] == yard_id and filming.get(key[0]) != state['started']:
            del _watched[key]
    if not filming:
        # Nothing to stop, so nothing to ask the rover.
        return []
    for recording, started in filming.items():
        _watched.setdefault((recording, yard_id),
                            {'started': started, 'before': None, 'stop_at': None, 'finished': []})

    undecided = [recording for recording in filming if _watched[(recording, yard_id)]['stop_at'] is None]
    runs = finished_runs(rover_url) if undecided else None
    for recording in undecided if runs is not None else []:
        state = _watched[(recording, yard_id)]
        if state['before'] is None:
            state['before'] = {run[0] for run in runs}
        own = dispatches_for(recording, yard_id)
        if own:
            finished = [run for run in runs if run[0] in own]
        else:
            finished = [run for run in runs
                        if run[0] not in state['before'] and recording_key(run[1]) == recording]
        if finished:
            state['stop_at'] = now + tail_seconds
            state['finished'] = finished if own else []

    stopped = []
    for recording in filming:
        state = _watched[(recording, yard_id)]
        if state['stop_at'] is None or now < state['stop_at']:
            continue
        del _watched[(recording, yard_id)]
        finished = state['finished']
        kept, path = stop_recording(recording, yard_id, keep=True)
        stopped.append(recording)
        print(f'[watcher] Rover finished {recording}; recording saved.')
        if kept and path and finished and on_recording_ready:
            instruction_id, mission_id, status = finished[0]
            try:
                on_recording_ready(mission_id, instruction_id, yard_id, path, status)
            except Exception as error:
                print(f'[watcher] Could not start automatic upload for {recording}: {type(error).__name__}.')
    return stopped


def stop_overdue_recordings(yard_id=None, max_seconds=MAX_RECORDING_SECONDS, now=None):
    """Stop, and keep, every recording at this yard older than max_seconds."""
    yard_id = _this_yard(yard_id)
    stopped = []
    for recording in overdue_recordings(yard_id, max_seconds, now=now):
        stop_recording(recording, yard_id, keep=True)
        stopped.append(recording)
        print(f'[watcher] {recording} recorded for over {max_seconds}s with no run '
              'finishing; stopped and kept.')
    return stopped


def start_mission_watcher(rover_url_getter, interval=ROVER_POLL_SECONDS):
    """Poll the rover forever. Intended to run on a daemon thread.

    The URL is read through a getter on every pass rather than captured once,
    so a rover path edited on Settings applies without a restart.
    """
    def _loop():
        housekeeping_at = None
        cleanup_at = time.monotonic()
        while True:
            try:
                from youtube_upload import queue_upload
                import tunables
                stop_finished_recordings(rover_url_getter(), on_recording_ready=queue_upload,
                                         tail_seconds=tunables.get('recordingTail'))
            except Exception as e:      # never let one bad pass kill the thread
                print(f'[watcher] pass failed: {e}')

            now = time.monotonic()
            if housekeeping_at is None or now - housekeeping_at >= HOUSEKEEPING_SECONDS:
                housekeeping_at = now
                # Recordings still to be delivered, from this boot or one
                # before it, so a satellite that finds a connection sends them
                # without waiting for another run to finish.
                try:
                    from youtube_upload import tick as upload_tick
                    upload_tick()
                except Exception as e:
                    print(f'[watcher] upload check failed: {type(e).__name__}')

                try:
                    stop_overdue_recordings()
                except Exception as e:
                    print(f'[watcher] overdue check failed: {e}')

            if now - cleanup_at >= CLEANUP_SECONDS:
                cleanup_at = now
                try:
                    from recording_cleanup import sweep
                    deleted = sweep()
                    if deleted:
                        print(f'[watcher] Cleanup: removed {len(deleted)} recording(s).')
                except Exception as e:
                    print(f'[watcher] Cleanup failed: {e}')

            time.sleep(interval)

    _loop()


def run_watcher_thread(rover_url_getter, interval=ROVER_POLL_SECONDS):
    thread = threading.Thread(
        target=start_mission_watcher, args=(rover_url_getter,),
        kwargs={'interval': interval}, daemon=True,
    )
    thread.start()
    return thread
