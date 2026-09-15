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
    recording_key,
    recordings_at,
    stop_recording,
)

ROVER_POLL_TIMEOUT = 3.0
DEFAULT_POLL_INTERVAL = 10  # seconds

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
    """[(instruction_id, mission_id)] for every run the rover says has ended.

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
            runs.append((entry.get('id'), mission_id))
    return runs


def stop_finished_recordings(rover_url, yard_id=None):
    """Stop filming every run at this yard the rover says is over. Returns them.

    keep=True for errors as well as successes: a run the rover could not
    execute may still have filmed something worth seeing, and that judgement
    belongs to whoever watches it.
    """
    yard_id = _this_yard(yard_id)
    runs = finished_runs(rover_url)
    if not runs:
        return []

    stopped = []
    for recording in recordings_at(yard_id):
        own = dispatches_for(recording, yard_id)
        if own:
            over = any(instruction_id in own for instruction_id, _ in runs)
        else:
            over = any(recording_key(mission_id) == recording for _, mission_id in runs)
        if not over:
            continue
        stop_recording(recording, yard_id, keep=True)
        stopped.append(recording)
        print(f'[watcher] Rover finished {recording}; recording saved.')
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


CLEANUP_EVERY = 30  # ticks (~5 min at 10s interval)


def start_mission_watcher(rover_url_getter, interval=DEFAULT_POLL_INTERVAL):
    """Poll the rover forever. Intended to run on a daemon thread.

    The URL is read through a getter on every pass rather than captured once,
    so a rover path edited on Settings applies without a restart.
    """
    def _loop():
        tick = 0
        while True:
            try:
                stop_finished_recordings(rover_url_getter())
            except Exception as e:      # never let one bad pass kill the thread
                print(f'[watcher] pass failed: {e}')

            try:
                stop_overdue_recordings()
            except Exception as e:
                print(f'[watcher] overdue check failed: {e}')

            tick += 1
            if tick % CLEANUP_EVERY == 0:
                try:
                    from recording_cleanup import sweep
                    deleted = sweep()
                    if deleted:
                        print(f'[watcher] Cleanup: removed {len(deleted)} recording(s).')
                except Exception as e:
                    print(f'[watcher] Cleanup failed: {e}')

            time.sleep(interval)

    _loop()


def run_watcher_thread(rover_url_getter, interval=DEFAULT_POLL_INTERVAL):
    thread = threading.Thread(
        target=start_mission_watcher, args=(rover_url_getter,),
        kwargs={'interval': interval}, daemon=True,
    )
    thread.start()
    return thread
