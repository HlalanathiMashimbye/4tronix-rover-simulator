"""
The satellite's own tunables.

This module also held the Firestore sync configuration and an integrations
panel. Both went with the mirror: there is no sync to configure, and the only
integration left to report on is the rover, which the status page already
covers from the machine's own point of view.

Settings that used to mean editing a .env on a Pi and restarting it. Ungated,
like everything else the station touches: require_operator meant a Firebase
sign-in, so internet, on a box built to work without it, and every value here
is a field-tuning knob.
"""

from flask import jsonify, request

import tunables
from console.blueprint import operator_bp


@operator_bp.route('/api/config/tunables', methods=['GET', 'POST'])
def api_tunables():
    if request.method == 'GET':
        return jsonify({'values': tunables.operator_values(),
                        'limits': tunables.limits(),
                        'options': tunables.options()})

    data = request.get_json(silent=True) or {}
    # A hidden setting is refused here as firmly as an invented one. It is not
    # on the page, so a request carrying it did not come from the page, and the
    # endpoint should not be a side door onto settings the page deliberately
    # does not offer.
    unknown = [k for k in data if k not in tunables.TUNABLES or k in tunables.HIDDEN]
    if unknown:
        return jsonify({'error': f'Unknown setting: {", ".join(sorted(unknown))}'}), 400

    try:
        tunables.save(data)
    except (TypeError, ValueError):
        return jsonify({'error': 'Every value must be a number, except the camera host, the '
                                 'closing time, which is a time of day like 16:30, and the '
                                 'Mission Control address, which is a web address like '
                                 'marsyard.sapient.rocks'}), 400

    return jsonify({'status': 'ok', 'values': tunables.operator_values(),
                    'limits': tunables.limits(), 'options': tunables.options()})


@operator_bp.route('/api/config/upload-secret', methods=['GET', 'POST'])
def api_upload_secret():
    """The automatic-upload secret: set, replaced or removed, never read back.

    Not a tunable, because tunables are served back to the page whole, and
    this page has no sign-in: whatever it can GET, anyone on the yard's wifi
    can. So this answers only whether a secret is set and which Mission
    Control it is for (youtube_upload.save_secret has why that matters).
    """
    import youtube_upload

    if request.method == 'GET':
        return jsonify(youtube_upload.secret_status())

    data = request.get_json(silent=True) or {}
    try:
        status = youtube_upload.save_secret(data.get('secret', ''))
    except ValueError:
        return jsonify({'error': 'That is not the upload secret: it is a long string with no '
                                 'spaces, from whoever set up automatic upload.'}), 400
    return jsonify(status)
