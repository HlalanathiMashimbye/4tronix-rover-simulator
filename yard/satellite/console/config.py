"""
Sync configuration, and what the satellite is wired up to.

Settings-page concerns rather than queue concerns, and interleaved with
mission dispatch in the old console: the sync worker's interval, the operator
tunables that used to be environment variables, and a report of which
integrations are actually configured.
"""

import os

import tunables
import youtube_poll
from flask import jsonify, request

from console import deps
from console.auth import require_operator
from console.blueprint import operator_bp

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


@operator_bp.route('/api/config/tunables', methods=['GET', 'POST'])
@require_operator
def api_tunables():
    """Settings that used to mean editing a .env on a Pi and restarting it.

    Gated like the rover URL is: shortening the session lifetime or repointing
    the camera host are control actions, and anyone on the venue network could
    otherwise do them. Costs nothing on event days, when OPERATOR_AUTH=off
    makes require_operator a pass-through.
    """
    if request.method == 'GET':
        return jsonify({'values': tunables.all_values(), 'limits': tunables.limits()})

    data = request.get_json(silent=True) or {}
    unknown = [k for k in data if k not in tunables.TUNABLES]
    if unknown:
        return jsonify({'error': f'Unknown setting: {", ".join(sorted(unknown))}'}), 400

    try:
        values = tunables.save(data)
    except (TypeError, ValueError):
        return jsonify({'error': 'Every value must be a number, except the camera host'}), 400

    return jsonify({'status': 'ok', 'values': values, 'limits': tunables.limits()})


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
                # One credential mode now, so this no longer has to guess
                # which one is in use. The failure hint names the one command
                # that fixes it: pointing people at FIREBASE_CLIENT_EMAIL and
                # FIREBASE_PRIVATE_KEY sent them looking for variables that
                # are now refused outright.
                **state(deps.admin_configured(),
                        'Authenticated with Application Default Credentials'
                        if deps.admin_configured()
                        else 'Cannot reach Firebase. Run `gcloud auth application-default '
                             'login` on this satellite. The reason is in the satellite log.'),
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
