# Architecture

## System Overview

The Yard system consists of three devices working together:

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Tablet or laptop │     │    Satellite     │     │      Rover       │
│   (Browser)      │────▶│   (mro.local)    │────▶│  (marspi.local)  │
│                  │     │                  │     │                  │
│  /code/ editor   │     │  :3001 Web       │     │  :8523 Queue     │
│  /run/ station   │     │  :8890 Camera    │     │  Processor       │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        │                        │                        │
        │                        │                        ▼
        │                        │                 ┌──────────────────┐
        │                        │                 │   4tronix Mars   │
        │                        ▼                 │   Rover Hardware │
        │                 ┌──────────────────┐     └──────────────────┘
        │                 │   Pi AI Camera   │
        │                 │   (IMX500)       │
        └────────────────▶└──────────────────┘
              TV Monitor
              /monitor/
```

| Device | Hostname | Services |
|--------|----------|----------|
| **Rover** | marspi.local:8523 | Queue-based instruction processor |
| **Satellite** | mro.local:3001 | Web interfaces (`/`, `/run/`, `/code/`, `/monitor/`, `/settings`) and the recordings |
| **Camera** | mro.local:8890 | Pi AI camera WebSocket stream |

The satellite has no sign-in and holds no cloud credential: it talks to the
rover and the camera on this network and to nothing else. Missions reach it by
hand. An operator copies one out of Mission Control's operator console
(`/operator` there), pastes it into the **run station** here (`/run/`) and
presses Send; the station records the run and hands them the video. Marking
the mission complete and attaching the video happen in Mission Control, not
here. [what-the-yard-no-longer-does.md](what-the-yard-no-longer-does.md)
covers the Firestore mirror and the satellite's own console that this replaced.

## Rover Server Architecture (Ports & Adapters)

The rover server follows the Ports & Adapters (Hexagonal) pattern for testability:

```
┌─────────────────────────────────────────────────────────────┐
│  rover_server.py - Primary Adapter (Flask HTTP layer)       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  @app.route('/queue/add')                            │   │
│  │       → service.add_instructions(data)               │   │
│  │  @app.route('/queue/clear')                          │   │
│  │       → service.clear_queue()                        │   │
│  │  @app.route('/queue/status')                         │   │
│  │       → service.get_status()                         │   │
│  │  @app.route('/queue/events')  ← SSE stream           │   │
│  │       → service.subscribe() / get_status()           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  service.py - Application Service (business logic)          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  RoverQueuePort (abstract interface)                 │   │
│  │    - add_instructions()                              │   │
│  │    - clear_queue()                                   │   │
│  │    - get_status()                                    │   │
│  │    - get_health()                                    │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  RoverQueueService (implementation)                  │   │
│  │    - Thread-safe queue management                    │   │
│  │    - Background processor thread                     │   │
│  │    - Instruction execution                           │   │
│  │    - Interruptible waits for emergency stop          │   │
│  │    - SSE subscriber fan-out (_subscribers list)      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  drivers.py - Secondary Adapter (hardware abstraction)      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  RoverDriver (abstract interface)                    │   │
│  │    - forward(), reverse(), spin_left(), spin_right() │   │
│  │    - steer_left(), steer_right(), stop()             │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  RealRoverDriver    │  FakeRoverDriver               │   │
│  │  (Pi hardware)      │  (logging for dev/test)        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Benefits

- **Unit tests** call `RoverQueueService` directly (no HTTP overhead)
- **Integration tests** use Flask test client (full stack)
- **Fake driver** enables testing without hardware
- **Dependency injection** for time/uuid providers in tests

## Directory Structure

```
yard/
├── rover/
│   ├── rover_server.py       # Flask HTTP adapter (thin layer)
│   ├── service.py            # RoverQueueService (business logic)
│   ├── python_runner.py      # StudentCodeRunner, the learner-code sandbox
│   ├── drivers.py            # RoverDriver interface + Real/Fake implementations
│   ├── mission_validator.py  # time and speed limits, calls the rover cannot make
│   ├── telemetry.py          # Telemetry interface: PostHog, or nothing
│   ├── vendor/               # the 4tronix rover library
│   ├── test_*.py             # pytest
│   └── requirements.txt
├── satellite/
│   ├── web_server.py         # Flask server for mro.local (port 3001)
│   ├── camera_server.py      # Pi AI camera WebSocket stream (port 8890)
│   ├── camera_control.py     # starts and stops the camera server
│   ├── camera_state.py       # the one answer to "is the camera ready"
│   ├── recording_control.py  # opens and closes recordings
│   ├── recording_cleanup.py  # prunes recordings before the SD card fills
│   ├── mission_watcher.py    # stops a recording when the rover finishes the run
│   ├── operator_console.py   # facade over console/
│   ├── console/              # what is left of /operator/: camera and tunables
│   ├── satellite_identity.py # which yard this is
│   ├── tunables.py           # settings changed at /settings without a restart
│   ├── rover_discovery.py    # finds rovers answering on the LAN
│   ├── templates/
│   │   ├── home.html         # Station hub (/)
│   │   ├── run.html          # Run station (/run/)
│   │   ├── code.html         # Tablet Blockly PWA (/code/)
│   │   ├── monitor.html      # TV display, no interaction (/monitor/)
│   │   ├── settings.html     # Health, recordings, tunables (/settings)
│   │   └── _nav.html         # the shared command bar
│   ├── static/
│   │   ├── yard-base.css     # styles shared by every console page
│   │   ├── roversim/         # simulator modules compiled from mission-control
│   │   ├── manifest.json     # PWA manifest
│   │   └── service-worker.js
│   ├── tests/                # pytest
│   └── requirements.txt
├── deploy/
│   ├── rover-server.service       # systemd unit for the rover Pi
│   ├── rover-sim.service          # the same queue server, simulated
│   ├── satellite-web.service      # systemd units for the satellite Pi
│   └── satellite-camera.service
├── docs/
│   ├── architecture.md      # This file
│   ├── api.md               # API reference
│   ├── testing.md           # Testing guide
│   └── ...                  # setup, the network, and plans
├── MANUAL.md                # Operations, quick fixes, install, debugging
└── README.md
```

## Data Flow

### Instruction Lifecycle

```
1. User creates program on tablet (Blockly or Python tab)
                    │
                    ▼
2. Click "Run"
   Blockly tab → generatePythonCode() + serialise workspace
                  → params: { code, blockly_state }
   Python tab  → read Monaco editor value
                  → params: { code }
                    │
                    ▼
3. POST /api/queue/add [{cmd: 'run_python', params}] (to satellite)
                    │
                    ▼
4. Satellite proxies to rover POST /queue/add
                    │
                    ▼
5. RoverQueueService.add_instructions()
   - Assigns UUID and timestamp
   - Adds to thread-safe queue
                    │
                    ▼
6. Background processor thread picks up instruction
   - Sets status to 'executing'
   - Executes Python code (rover + time available)
   - Sets status to 'completed'
   - Moves to history
                    │
                    ▼
7. TV monitor receives queue updates via SSE push
   - EventSource('/api/queue/events') holds one persistent connection
   - Rover pushes a state snapshot whenever something changes
   - Only re-renders when data changes (no flicker)
   - Blockly-sourced instructions → read-only Blockly workspace preview
   - Python-sourced instructions → code block
   - Shows current / pending / history
   - ↻ refresh button triggers a one-off GET /api/queue/status fetch
```

### The manual loop (run station)

How a mission from Mission Control is run and recorded. It is the same queue
as above, with a recording wrapped around it and the mission id carried
through.

```
1. Operator presses Copy on the mission in Mission Control (/operator)
   Clipboard: "# Mission: <name>", "# MissionID: <id>", then the Python
                    │
                    ▼
2. Pastes it into /run/, which reads the name and id out of the header
                    │
                    ▼
3. Presses "Send to rover"
   POST /api/recording/start {name: <id>}   (refused if the camera is not ready)
   waits 1s so the first move is on camera
   POST /api/queue/add [{cmd: 'run_python', params: {code, mission_id}}]
                    │
                    ▼
4. The rover runs it; its history entry carries params.mission_id and a status
                    │
                    ▼
5. mission_watcher polls the rover's GET /queue/status every 10s
   completed or error, for a mission_id that is being recorded
   → stop_recording(keep=True)
   → recordings/<mission>__<yard>__<UTC stamp>.mp4
                    │
                    ▼
6. /run/ sees the recording drop out of /api/status and lists the file
   GET /api/recordings, then GET /api/recordings/<name> to download it
                    │
                    ▼
7. Operator uploads it to YouTube with the description /run/ writes
   ("MissionID: <id>" and "Yard: <yard>"), and marks the run complete in
   Mission Control, whose linker then attaches the video to the run
```

Stop on the run station clears the rover's queue and closes the recording
too, keeping the file. With no mission id filled in, the recording is named
after the mission instead and the dispatch carries no id, so the watcher
cannot match it and the recording runs until someone stops it.

### SSE Push Architecture

The monitor receives queue state via Server-Sent Events rather than polling. Each layer holds one persistent HTTP connection to the layer below it, and nothing polls.

```
Browser                  Satellite (Flask :3001)       Rover (Flask :8523)
   │                              │                              │
   │  GET /api/queue/events       │                              │
   │─────────────────────────────▶│                              │
   │                              │  GET /queue/events           │
   │                              │─────────────────────────────▶│
   │                              │                              │ subscribe()
   │                              │                              │ → Queue() added
   │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│◀ ─  200 streaming  ─ ─ ─ ─ ─│
   │   (both responses stay open) │                              │
```

**Rover subscriber fan-out**: `service.subscribe()` creates a `queue.Queue` and adds it to `_subscribers`. The SSE generator blocks on `q.get(timeout=30)`. When state changes, `_notify_subscribers()` serialises `get_status()` and calls `q.put_nowait()` on every subscriber, unblocking each waiting generator.

`_notify_subscribers()` is called at four points in the service:
- `add_instructions()`: after appending to the queue
- `clear_queue()`: after clearing
- `_execute_instruction()`: after setting status to `'executing'`
- `_execute_instruction()`: after setting status to `'completed'` or `'error'`

**Satellite proxy**: uses `requests.get(..., stream=True, timeout=(3.05, 45))` and `iter_content(chunk_size=None)`. It is a byte pipe: it does not parse or buffer SSE events, just forwards raw bytes as they arrive. The 45s read timeout is the zombie-detector: the rover heartbeats every 30s, so silence past 45s means the rover died without closing the socket, and the proxy ends the response and the browser reconnects.

**Heartbeat**: the rover generator catches `queue.Empty` after 30s and yields `: heartbeat\n\n`. This keeps proxies and load balancers from closing an idle connection. Browsers ignore SSE comment lines.

**Reconnection**: `EventSource` handles reconnection automatically. `onerror` fires on disconnect (badge goes grey); `onopen` fires when the connection is re-established (badge goes green). No manual reconnect logic is needed in the browser.

**On rover offline**: the satellite's `requests.get` raises `ConnectionError`, which returns HTTP 503. The browser's `EventSource` retries every 3s until the rover comes back.

**Cleanup**: when a browser tab closes, the satellite generator receives `GeneratorExit` in its `finally:` block and calls `rover_resp.close()`. The rover detects the broken pipe and `service.unsubscribe(q)` removes the queue from `_subscribers`.

### Emergency Stop

```
1. User clicks "Stop" button
                    │
                    ▼
2. POST /api/queue/clear (to satellite)
                    │
                    ▼
3. Satellite proxies to rover POST /queue/clear
                    │
                    ▼
4. RoverQueueService.clear_queue()
   - Sets stop_requested flag
   - Calls driver.stop() immediately
   - Clears pending queue
   - Interruptible wait returns early
   - Clears stop flag
```

## Tablet Client Architecture

The Blockly interface also uses Ports & Adapters:

```javascript
// Port (interface)
class RoverService {
    async addToQueue(instructions) { }
    async clearQueue() { }
    async getStatus() { }
}

// Real adapter - calls actual API
class RealRoverService extends RoverService { ... }

// Spy adapter - records and displays what would be sent
class SpyRoverService extends RoverService { ... }

// Injection via URL parameter
const service = isSpyMode
    ? new SpyRoverService(outputElement)
    : new RealRoverService('/api');
```

Spy mode: `/code/?spy=true` - works offline, shows what would be sent (`?mock=true` is a legacy alias).
