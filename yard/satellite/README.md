# yard/satellite/

The yard-facing web tier, run on a Pi beside the rover (web UI on `:3001`,
override with `SATELLITE_PORT`). It serves the tablet Blockly interface, the TV
monitor and the operator's run station, proxies API calls to the rover server,
records runs, and works with no internet at all.

It holds no cloud credential. It talks to the rover and the camera over the
local network and to nothing else. See [../docs/satellite.md](../docs/satellite.md)
for setup and [../docs/what-the-yard-no-longer-does.md](../docs/what-the-yard-no-longer-does.md)
for what the Firestore mirror used to do and why it went.

| File | Role |
|------|------|
| `web_server.py` | Flask server. Serves every page, proxies the rover queue and camera, owns the recording endpoints. |
| `operator_console.py` / `console/` | What is left of `/operator/`: camera control and the satellite's tunables. The mission queue, the login and the review flow went with the mirror. |
| `recording_control.py` | Opens and closes recordings, and answers whether one is running. Files are named `<mission>__<yard>.mp4`. |
| `mission_watcher.py` | Polls the rover and releases the camera when it reports a run finished. The only background thread. |
| `camera_server.py` / `camera_control.py` | Pi camera stream for the monitor, and starting/stopping it. |
| `satellite_identity.py` | Which yard this is. Half of what identifies a run. |
| `tunables.py` | Settings editable at `/settings` without a restart. |
| `templates/`, `static/` | The five pages: hub, run station, code, monitor, settings. |
| `tests/` | pytest. `pytest tests` from this directory. |

## Pages

| Path | For |
|------|-----|
| `/` | Station hub |
| `/run/` | The operator's station: import a mission, run it, take the video |
| `/code/` | The tablet's Blockly and Python editor |
| `/monitor/` | The TV: camera feed and instruction queue |
| `/settings` | Health, recordings, and the tunables |

```bash
# From the repo root
npm run dev:satellite     # cross-platform launcher
```

Nothing here requires a sign-in. That is deliberate: an auth gate that only
works when the venue wifi does is not protecting a box whose whole purpose is
running without it. The network boundary is the control.
