"""
Telling mission-control that a mission's status changed.

One job, and a job with a rule attached: it must never be able to break the
thing that called it. A learner missing a status email is far cheaper than an
operator unable to run the rover because mission-control happens to be down,
so every failure here is swallowed and logged.
"""

import threading

import requests
from flask import current_app

from console import deps

NOTIFY_TIMEOUT = 10.0


def notify_mission_control(mission_id, status):
    """Best-effort status-email trigger, called after Firestore is already
    updated. Must never raise - a learner missing an email is far cheaper
    than an operator unable to run the rover because mission-control happens
    to be down.
    """
    try:
        requests.post(
            f'{deps.mission_control_url()}/api/missions/{mission_id}/notify',
            json={'status': status},
            timeout=NOTIFY_TIMEOUT,
        )
    except requests.exceptions.RequestException:
        current_app.logger.warning(
            'Failed to notify mission-control of status change (mission=%s, status=%s)',
            mission_id, status,
        )


def notify_mission_control_async(mission_id, status):
    """Fire notify_mission_control on a background thread so a slow or
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
            notify_mission_control(mission_id, status)

    threading.Thread(target=run, daemon=True).start()
