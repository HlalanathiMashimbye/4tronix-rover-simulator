"""Shutting the satellite down.

Thin, like the camera routes: what it does and why is satellite_power.py.

Not behind a sign-in, for the camera routes' reason: the console has none,
because the yard works without internet. This endpoint takes no body, so
before the same-origin gate (same_origin.py) any website a browser on the
yard's wifi had open in another tab could POST to it and power the box off.
That gate now refuses anything that did not come from the satellite's own
pages, so Shut down is a thing an operator does on purpose from the console,
not something another tab can do behind their back.
"""

from flask import jsonify

from console.blueprint import operator_bp


@operator_bp.route('/api/satellite/power', methods=['GET'])
def api_satellite_power():
    """Whether Shut down will work, so the button can say so before it is pressed."""
    from satellite_power import can_power_off

    allowed, why_not = can_power_off()
    return jsonify({'canPowerOff': allowed, 'detail': why_not})


@operator_bp.route('/api/satellite/shutdown', methods=['POST'])
def api_satellite_shutdown():
    from satellite_power import shut_down

    ok, detail = shut_down()
    if not ok:
        return jsonify({'error': detail}), 503
    return jsonify({'status': 'shutting-down', 'saved': detail}), 202
