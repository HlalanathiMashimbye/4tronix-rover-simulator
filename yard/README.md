# Yard

Yard is a queue-based control system designed for classroom use with the 4tronix M.A.R.S. Rover. It adds a tablet-friendly Blockly interface and a TV monitor display for group activities.

**Running a session, installing, or fixing something in the field? Start with the [Yard Manual](MANUAL.md).**

## What's in Yard?

```
yard/
├── rover/           # Queue-based instruction server (runs on the rover Pi)
│   ├── rover_server.py
│   ├── service.py
│   ├── drivers.py
│   └── test_*.py
├── satellite/       # Web interfaces (runs on a separate Pi)
│   ├── web_server.py
│   ├── camera_server.py
│   └── templates/
├── deploy/          # systemd units for all three services
└── docs/
```

**Rover** (marspi.local:8523) - Receives instructions via REST API and executes them in order. Automatically falls back to a fake driver (logs instead of moving) when not on a Pi.

**Satellite** (mro.local:3001) - Serves the operator's run station at `/run/`, the tablet Blockly interface at `/code/`, the TV monitor at `/monitor/` and settings at `/settings`, and records each run. Also streams the Pi camera at port 8890. It has no sign-in and holds no cloud credential: missions arrive by copy and paste from Mission Control's operator console.

## How It Works

1. Kids build programs using Blockly blocks on a tablet
2. Pressing "Run" sends instructions to the rover's queue
3. The rover executes instructions one at a time
4. The TV monitor shows the camera feed and queue status
5. "Stop" button triggers emergency stop and clears the queue

## Documentation

| Doc | Description |
|-----|-------------|
| [Yard Manual](MANUAL.md) | **Start here**: operations, quick fixes, installation, debugging |
| [Rover Server](docs/rover-server.md) | Setup and API for the queue server |
| [Satellite](docs/satellite.md) | Web interface and camera server |
| [Architecture](docs/architecture.md) | System design and data flow |
| [API Reference](docs/api.md) | REST endpoints and instruction format |
| [Testing](docs/testing.md) | Running and writing tests |
| [What the yard no longer does](docs/what-the-yard-no-longer-does.md) | The Firestore mirror that was removed, and the shape a way back should take |
