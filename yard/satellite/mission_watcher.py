"""
Mission watcher - closes the loop the operator currently closes by hand.

Today a mission sits in 'processing' until someone taps "Mark complete". The
rover already knows it finished: RoverService sets status='completed' on the
instruction and keeps it in its history, and since PR 1 the dispatch carries
mission_id. Nothing ever asks.

On a busy event day that gap is the whole problem - an operator turns to the
next child, forgets, and the mission is stuck in 'processing' forever. Worse,
it holds the lease, so nothing else can reclaim it either.

This polls the rover and completes the missions the rover CONFIRMS it ran.

Why this is allowed under plan 2.3 ("never move the robot without a human"):
that rule forbids automatically DISPATCHING, because a physical action cannot
be replayed. Recording an outcome the rover already reported moves nothing. The
watcher never sends anything to the rover - it only reads /queue/status.

It is deliberately one-directional: it can complete a mission, never fail one.
An error on the rover leaves the mission alone for a human to look at, because
"the code raised" is not the same as "the run was a failure", and a learner must
never be shown a failed mission (see mission-control's discoveryStatus.ts).
"""

import threading

import requests

from mission_store import (
    flag_for_review,
    get_mission,
    get_run,
    mission_has_pending,
    release_mission,
    release_run,
    run_has_pending,
)

ROVER_POLL_TIMEOUT = 3.0
DEFAULT_POLL_INTERVAL = 10  # seconds

# The rover's error text goes on a mission document and into the operator's
# banner; a runaway traceback should not do either.
REVIEW_REASON_MAX = 300


def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _mission_id_of(entry):
    params = entry.get('params')
    if isinstance(params, dict):
        return params.get('mission_id')
    return None


def rover_outcomes(rover_url):
    """What the rover says happened, from its own history.

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
            # The rover already knows exactly what went wrong - a SyntaxError,
            # a speed the hardware rejected - and records it on the
            # instruction. Nothing read it, so a mission whose code could not
            # run sat in 'processing' forever and the operator was given no
            # reason at all. Surface it instead of discarding it.
            errored[mission_id] = str(entry.get('error') or 'rover reported an error')
    return done, errored


def completed_mission_ids(rover_url):
    """Backwards-compatible view of rover_outcomes for callers that only
    care about completions (recovery.py asks a narrower question)."""
    done, _ = rover_outcomes(rover_url)
    return done


def autocomplete_finished_missions(rover_url, notify=None, yard_id=None):
    """Complete any 'processing' run the rover says it finished.

    `notify` is the mission-control status callback, injected so this module
    does not import the Flask blueprint (which would be a circular import and
    would drag an app context into a background thread).

    Returns the list of mission ids completed.

    If yard_id is not provided, it is imported from satellite_identity.
    """
    from satellite_identity import yard_id as get_yard_id
    if yard_id is None:
        try:
            yard_id = get_yard_id()
        except Exception:
            yard_id = 'curiosity'

    completed = []
    done, errored = rover_outcomes(rover_url)

    # A run the rover could not execute is flagged, never marked failed. The
    # rule in this module has always been that it may not assert an outcome
    # nobody established - and 'failed' reaches the learner as a run that went
    # wrong, when the truth is the code never ran. Flagging puts it in front of
    # an operator with the rover's own reason attached.
    for mission_id, reason in errored.items():
        mission = get_mission(mission_id)
        if mission is None:
            continue
        run = get_run(mission_id, yard_id)
        if run is None or run.get('status') != 'processing':
            continue
        if run.get('needs_review'):
            continue
        if run_has_pending(mission_id, yard_id):
            continue

        # Flag the run for review
        release_run(mission_id, yard_id, 'processing', _now_iso(),
                   review_reason=f'rover could not run it: {reason}'[:REVIEW_REASON_MAX])
        print(f'[watcher] Rover reported an error for {mission_id}: {reason}')

    for mission_id in done:
        mission = get_mission(mission_id)
        if mission is None:
            continue
        run = get_run(mission_id, yard_id)
        if run is None or run.get('status') != 'processing':
            continue
        # A run awaiting a human decision is theirs to resolve, not ours.
        if run.get('needs_review'):
            continue
        # Do not race a flush that is already carrying a change for this run.
        if run_has_pending(mission_id, yard_id):
            continue

        release_run(mission_id, yard_id, 'completed', _now_iso())
        completed.append(mission_id)
        print(f'[watcher] Rover confirmed {mission_id}; marked complete')

        if notify:
            try:
                notify(mission_id, 'completed')
            except Exception as e:
                print(f'[watcher] Notify failed for {mission_id}: {e}')

    return completed


def start_mission_watcher(rover_url_getter, notify=None, interval=DEFAULT_POLL_INTERVAL):
    """Poll on a background timer.

    Takes a getter for the rover URL because it is editable at runtime from the
    /status page, so capturing the value once would leave the watcher polling a
    stale address after an operator corrects it.
    """
    def _loop():
        try:
            url = rover_url_getter() if callable(rover_url_getter) else rover_url_getter
            if url:
                autocomplete_finished_missions(url, notify=notify)
        except Exception as e:
            print(f'[watcher] Unexpected error: {e}')

        timer = threading.Timer(interval, _loop)
        timer.daemon = True
        timer.start()

    _loop()
