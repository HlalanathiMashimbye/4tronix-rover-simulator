"""
The operator console, split by concern.

operator_console.py was 1266 lines carrying seven unrelated jobs behind one
Flask blueprint: authentication, the mission queue, camera control, sync
configuration, the review flow, health, and Firebase access. This package is
that file taken apart along those seams.

Modules here depend downward on `deps` and never on each other's routes, and
nothing here imports operator_console. That direction is the point: the old
shape made every collaborator reachable only by monkeypatching the whole
console, which is why its tests patched seven private names on one module.
"""

# Importing the route modules is what registers their routes on the shared
# blueprint. operator_console imports this package, so pulling them in here
# keeps registration in one place rather than scattered across the facade.
from console.blueprint import operator_bp  # noqa: E402,F401
from console import auth, camera, config, health, missions, review  # noqa: E402,F401
