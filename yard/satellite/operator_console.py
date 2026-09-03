"""
Facade kept for one reason: web_server.py and the templates reach the console
through this name.

It used to front a whole operator console. What is behind it now is the camera
and the satellite's tunables; everything else went with the Firestore mirror.

The package is named `console` and this file `operator_console` because
neither may shadow Python's stdlib `operator` module.
"""

from console import camera, config  # noqa: F401
from console.blueprint import operator_bp  # noqa: F401
