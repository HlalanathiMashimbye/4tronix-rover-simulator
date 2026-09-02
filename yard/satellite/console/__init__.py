"""
What is left of the operator console: the endpoints the station calls.

This package was the console proper - authentication, the mission queue, the
review flow, sync configuration and Firebase access - split across six modules
behind one blueprint. All of that went with the Firestore mirror. Mission
bookkeeping happens in Mission Control now.

Two things stayed, because they are about this box and nothing else: the
camera, and the satellite's own tunables. They keep the /operator prefix
because the station's pages already call them there, and moving the URL to
match a package layout is not worth a broken bookmark on a yard tablet.
"""

# Importing the route modules is what registers their routes on the blueprint.
from console.blueprint import operator_bp  # noqa: E402,F401
from console import camera, config  # noqa: E402,F401
