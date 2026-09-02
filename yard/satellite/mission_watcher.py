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
"""

import threading
import time

import requests

from recording_control import is_recording, stop_recording

ROVER_POLL_TIMEOUT = 3.0
DEFAULT_POLL_INTERVAL = 10  # seconds


def _mission_id_of(entry):
    params = entry.get('params')
    if isinstance(params, dict):
        return params.get('mission_id')
    return None


def rover_outcomes(rover_url):
    """The mission ids the rover reports as finished, from its own history.

    Returns (completed_ids, errored) where `errored` maps mission_id -> the
    rover's own error text. Empty on any failure. Never raises: an unreachable
    rover must not stop the watcher, and "I could not tell" must never be read
    as "it finished".
    """
    try:
        resp = requests.get(f'{rover_url}/queue/status', timeout=ROVER_POLL_TIMEOUT)
        if resp.status_code != 200:
            return set(), {}
        data = resp.json() or {}
    except (requests.exceptions.RequestException, ValueError):
        return set(), {}

    done = set()
    errored = {}
    for entry in data.get('history') or []:
        if not isinstance(entry, dict):
            continue
        mission_id = _mission_id_of(entry)
        if not mission_id:
            continue
        status = entry.get('status')
        if status == 'completed':
            done.add(mission_id)
        elif status == 'error':
            errored[mission_id] = str(entry.get('error') or 'rover reported an error')
    return done, errored


def stop_finished_recordings(rover_url, yard_id=None):
    """Stop filming every run the rover says is over. Returns those ids.

    keep=True for errors as well as successes: a run the rover could not
    execute may still have filmed something worth seeing, and that judgement
    belongs to whoever watches it.

    The station names its recording after the mission id, and the dispatch
    carries that id, so the key the rover reports back is the key the
    recording is filed under. Nothing else has to agree about anything.
    """
    if yard_id is None:
        from satellite_identity import yard_id as get_yard_id
        try:
            yard_id = get_yard_id()
        except Exception:
            yard_id = 'curiosity'

    done, errored = rover_outcomes(rover_url)

    stopped = []
    for mission_id in set(done) | set(errored):
        if not is_recording(mission_id, yard_id):
            continue
        stop_recording(mission_id, yard_id, keep=True)
        stopped.append(mission_id)
        print(f'[watcher] Rover finished {mission_id}; recording saved.')
    return stopped


def start_mission_watcher(rover_url_getter, interval=DEFAULT_POLL_INTERVAL):
    """Poll the rover forever. Intended to run on a daemon thread.

    The URL is read through a getter on every pass rather than captured once,
    so a rover path edited on Settings applies without a restart.
    """
    def _loop():
        while True:
            try:
                stop_finished_recordings(rover_url_getter())
            except Exception as e:      # never let one bad pass kill the thread
                print(f'[watcher] pass failed: {e}')
            time.sleep(interval)

    _loop()


def run_watcher_thread(rover_url_getter, interval=DEFAULT_POLL_INTERVAL):
    thread = threading.Thread(
        target=start_mission_watcher, args=(rover_url_getter,),
        kwargs={'interval': interval}, daemon=True,
    )
    thread.start()
    return thread
