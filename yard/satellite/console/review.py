"""
The needs-review flow, and the conflict log.

A mission that was running when the satellite stopped cannot be assumed
finished or failed, so it is flagged for a human. These routes are how the
operator sees and clears those flags.
"""

from flask import jsonify, request

from console import notify
from console.auth import require_operator
from console.blueprint import operator_bp
from console.mirror import mirror_row_to_dict, now_iso
from mission_store import get_conflicts, get_needs_review, resolve_review

@operator_bp.route('/api/missions/needs-review', methods=['GET'])
@require_operator
def api_needs_review():
    """Missions that were running when the satellite stopped.

    Surfaced as a distinct group rather than mixed into the queue: they are
    ambiguous, not queued, and an operator has to decide what happened.
    """
    from mission_store import get_needs_review

    return jsonify({
        'missions': [mirror_row_to_dict(row) for row in get_needs_review()],
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
    resolve_review(mission_id, status, now_iso())

    if status != 'completed':
        # 'queued' (fresh rerun ahead) and 'cancelled' (must never look
        # successful) both discard the recording left over from the
        # interrupted run; only 'completed' keeps it.
        stop_recording(mission_id, yard_id(), keep=False)

    if status == 'completed':
        notify.notify_mission_control_async(mission_id, 'completed')

    return jsonify({'status': 'ok', 'missionId': mission_id, 'newStatus': status})


@operator_bp.route('/api/conflicts', methods=['GET'])
def api_conflicts():
    """Merges where the losing side was already terminal, so the team can see
    that reconciliation made a real decision rather than silently picking.

    Ungated, which is what the sentence above needs to be true. Settings polls
    this and the panel hides itself when the list is empty, so behind a login
    the record was invisible on exactly the yard that cannot log in - the
    silent picking this exists to prevent. It also meant a login-free page
    polling a gated endpoint, which filled the browser console with 401s.
    """
    return jsonify({'conflicts': get_conflicts()})
