# Legacy upstream code

Everything under this directory is the upstream 4tronix M.A.R.S. Rover desktop
simulator and Raspberry Pi tooling that this repository was forked from. The
last upstream commit was 2026-06-13; the UCT INF4027W project (`mission-control/`
and `yard/`) started the following week and does not run any of this code.

It is kept for two reasons:

1. **Provenance.** This is where the fork came from, and some of the physical
   rover's behaviour (the differential-drive kinematics in particular) is
   still specified by reading `simulator/roversimui.py`, because nobody has
   rewritten that spec from scratch.
2. **The 4tronix vendor library.** `real-rover/` used to hold a duplicate of
   the library the physical rover imports; that library has since been moved
   into `yard/rover/vendor/` because the running system actually depends on
   it. See `yard/rover/vendor/README.md`.

## Contents

- `simulator/` - the PyQt6 desktop simulator (`roversimui.py`), its WebRTC
  window (`rtc_window.py`), the software rover model it drives
  (`roversimulator.py`, `rover_web_driver.py`), and their PyQt6 dependency
  list (`requirements.txt`). `roversimulator.py` is still imported at
  runtime as a laptop fallback, see `yard/rover/service.py` and
  `yard/rover/vendor/README.md` - do not delete it.
- `examples/` - upstream teaching scripts (`square.py`, `move-rover.py`,
  `very-simple-example.py`) written against `roversimulator.py`.
- `web_interface/` - the original Flask-based Pi web UI, superseded by
  `yard/satellite/`.
- `real-rover/` - everything from the old `real-rover/` folder except the
  4tronix `rover.py` library itself (vendored into `yard/rover/vendor/`) and
  `rover_server.py` (superseded by `yard/rover/rover_server.py`, which is
  what the satellite actually talks to over `/queue/add`, `/queue/clear`
  and `/health`).
- `tests/` - tests for `rtc_window.py` and the old web interface. Nothing in
  CI collects these; they never ran automatically even before the move.
- `AI_CAMERA_SETUP.md`, `PI_CAMERA_SETUP.md` - upstream camera setup docs.
- `pi_camera_stream.py` - the upstream camera streaming script. A different,
  still-active copy lives at `yard/satellite/camera_server.py` (async,
  websockets); this one is unrelated and unused.

None of this is imported by `mission-control/` or `yard/` except the one
fallback noted above, and none of it is exercised by CI.
