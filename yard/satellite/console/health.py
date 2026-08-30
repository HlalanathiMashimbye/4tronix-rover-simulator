"""
Rover reachability, for the console's status badge.
"""

import requests
from flask import jsonify

from console import deps
from console.auth import require_operator
from console.blueprint import operator_bp

ROVER_TIMEOUT = 5.0

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
