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
