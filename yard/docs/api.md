# API Reference

## Rover Server (marspi.local:8523)

### POST /queue/add

Add instruction(s) to the queue.

**Request:**
```bash
curl -X POST http://marspi.local:8523/queue/add \
  -H "Content-Type: application/json" \
  -d '[{"cmd": "forward", "params": {"speed": 60, "seconds": 1}}]'
```

**Request Body:**
```json
[
  {
    "cmd": "forward",
    "params": {"speed": 60, "seconds": 1}
  }
]
```

**Response:**
```json
{
  "status": "ok",
  "added": 1,
  "instructions": [
    {
      "id": "uuid-here",
      "cmd": "forward",
      "params": {"speed": 60, "seconds": 1},
      "timestamp": "2024-01-15T12:00:00Z",
      "status": "pending"
    }
  ]
}
```

### POST /queue/clear

Clear queue and emergency stop.

**Request:**
```bash
curl -X POST http://marspi.local:8523/queue/clear
```

**Response:**
```json
{
  "status": "ok",
  "cleared": 3,
  "message": "Queue cleared and rover stopped"
}
```

### GET /queue/status

Get current queue status.

**Request:**
```bash
curl http://marspi.local:8523/queue/status
```

**Response:**
```json
{
  "current": {
    "id": "uuid",
    "cmd": "forward",
    "params": {"speed": 60, "seconds": 1},
    "status": "executing",
    "timestamp": "2024-01-15T12:00:00Z"
  },
  "pending": [...],
  "pending_count": 5,
  "history": [...],
  "history_count": 10
}
```

### GET /health

Health check endpoint.

**Request:**
```bash
curl http://marspi.local:8523/health
```

**Response:**
```json
{
  "status": "ok",
  "processor_alive": true,
  "driver": "FakeRoverDriver",
  "hardware": false,
  "queue_size": 0
}
```

`status` is `"ok"` while the queue processor thread is alive, `"degraded"` if
it isn't running — a degraded rover accepts instructions but never executes
them, so treat it as down.

## Satellite Server (mro.local:3001)

The satellite proxies all `/api/*` calls to the rover.

| Satellite Endpoint | Proxies To |
|-------------------|------------|
| `POST /api/queue/add` | `POST http://marspi.local:8523/queue/add` |
| `POST /api/queue/clear` | `POST http://marspi.local:8523/queue/clear` |
| `GET /api/queue/status` | `GET http://marspi.local:8523/queue/status` |

### GET /api/health

Health check with rover connectivity status.

**Response:**
```json
{
  "status": "ok",
  "rover_url": "http://marspi.local:8523",
  "rover_status": "connected"
}
```

Possible `rover_status` values: `connected`, `disconnected`, `timeout`, `error`

### POST /api/config/rover_url

Change the rover URL the satellite proxies to, at runtime. Used by the edit
button on the `/status` page. The value is persisted to
`satellite_config.json` and takes precedence over the `ROVER_URL` environment
variable on the next start.

**Request:**
```json
{ "url": "http://curiosity.local:8523" }
```

**Response:**
```json
{ "status": "ok", "rover_url": "http://curiosity.local:8523", "persisted": true }
```

Returns 400 if the URL doesn't start with `http://` or `https://`.
`persisted: false` means the change applied in memory but the config file
could not be written (it will reset on restart).

### Web Routes

None of these require a sign-in. The satellite has none.

| Route | Description |
|-------|-------------|
| `GET /` | Station hub |
| `GET /run/` | The operator's station: import a mission, run it, take the video away |
| `GET /code/` | Tablet Blockly and Python editor |
| `GET /monitor/` | TV display: camera feed and instruction queue |
| `GET /settings` | Health, recordings and tunables (`/status` redirects here) |

### Recording

| Endpoint | Description |
|----------|-------------|
| `POST /api/recording/start` | `{name}` begin filming. Refused with 503 unless the camera is producing frames |
| `POST /api/recording/stop` | `{name, keep}` stop filming, keeping or deleting the file |
| `GET /api/recordings` | The files on this satellite, newest first |
| `GET /api/recordings/<name>` | Download one, as an attachment |
| `GET /api/camera/ready` | Whether frames are actually arriving, as opposed to the port being open |

Recordings are named `<mission>__<yard>.mp4`. That pair is what identifies a
run, and it is the shape Mission Control matches an upload against.

### What is left of /operator/

There is no login. The mission queue, the sign-in, the review flow and the
Firestore sync were removed from the satellite - see
[what-the-yard-no-longer-does.md](what-the-yard-no-longer-does.md). Two groups
of endpoints kept the prefix, because the pages already call them there:

| Endpoint | Description |
|----------|-------------|
| `POST /operator/api/camera/start` | Start (or restart) the camera server. Optional `{cameraIndex}` |
| `POST /operator/api/camera/stop` | Stop it |
| `GET /operator/api/camera` | Whether the camera is up, and which backend is serving it |
| `GET /operator/api/config/tunables` | Current values and their bounds |
| `POST /operator/api/config/tunables` | Change one without a restart |

## Camera Server (mro.local:8890)

WebSocket server streaming JPEG frames.

### Connect

```javascript
const ws = new WebSocket('ws://mro.local:8890');
```

### Messages

**Frame message:**
```json
{
  "type": "frame",
  "data": "<base64-encoded-jpeg>"
}
```

## Instruction Format

### Commands

| Command | Parameters | Description |
|---------|------------|-------------|
| `forward` | `speed`, `seconds` | Move forward |
| `backward` | `speed`, `seconds` | Move backward |
| `spin_left` | `speed`, `seconds` | Spin left in place |
| `spin_right` | `speed`, `seconds` | Spin right in place |
| `steer_left` | `degrees`, `speed`, `seconds` | Steer left while moving |
| `steer_right` | `degrees`, `speed`, `seconds` | Steer right while moving |
| `stop` | (none) | Stop immediately |
| `wait` | `seconds` | Wait without moving |
| `run_python` | `code`, `blockly_state` (optional) | Execute a Python script on the rover |

### run_python

Submits a Python script for the rover to execute. Sent by both the Blockly tab and the Python tab in `/code/`.

```json
{
  "cmd": "run_python",
  "params": {
    "code": "rover.forward(60)\ntime.sleep(1)\nrover.stop()\n",
    "blockly_state": "{\"blocks\":{...}}"
  }
}
```

- `code` — the generated or hand-written Python to run. The rover environment has `rover` and `time` pre-imported.
- `blockly_state` — optional. Present when submitted from the Blockly tab. Contains the serialised Blockly workspace JSON. Used by the monitor to display the original blocks instead of the generated code.

Student code is supervised line-by-line with a trace hook: the Stop button
interrupts it immediately (even a `while True: pass` loop), and any script
running longer than 120 seconds (configurable via the service's
`run_python_timeout`) is terminated with an error. Calls that block inside
C code (e.g. a long hardware operation) can't be interrupted mid-call.

### Parameter Defaults

| Parameter | Default | Range |
|-----------|---------|-------|
| `speed` | 60 | 0-100 |
| `seconds` | 1.0 | 0.1-10 |
| `degrees` | 20 | 5-45 |

### Instruction Status

| Status | Description |
|--------|-------------|
| `pending` | Queued, waiting to execute |
| `executing` | Currently running |
| `completed` | Finished successfully |
| `error` | Failed with error |

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Description of the error"
}
```

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad request (invalid JSON, empty data) |
| 503 | Cannot connect to rover server |
| 504 | Rover server timeout |
| 500 | Internal server error |
