# Testing Guide

## Test Suites

The rover server has two test suites:

| Suite | File | Tests | What it tests |
|-------|------|-------|---------------|
| Unit | `test_service.py` | 26 | Queue logic, instruction execution, threading |
| Integration | `test_integration.py` | 26 | Flask endpoints, HTTP layer, end-to-end flow |

## Running Tests

```bash
cd yard/rover
source ../venv/bin/activate

# Run all tests
python -m pytest -v

# Run unit tests only (faster)
python -m pytest test_service.py -v

# Run integration tests only
python -m pytest test_integration.py -v

# Run with coverage
python -m pytest --cov=. --cov-report=html
```

## Unit Tests (test_service.py)

Unit tests call `RoverQueueService` directly without HTTP:

```python
def test_add_single_instruction(self):
    result = self.service.add_instructions([
        {'cmd': 'forward', 'params': {'speed': 60, 'seconds': 1}}
    ])

    assert result['status'] == 'ok'
    assert result['added'] == 1
```

### Test Categories

- **TestRoverQueueService**: add_instructions, get_status, clear_queue, get_health
- **TestQueueProcessor**: execution order, history updates, interrupt handling
- **TestInstructionExecution**: each command type calls correct driver methods

### Dependency Injection for Tests

Tests inject fixed time and UUID providers for deterministic results:

```python
self.service = RoverQueueService(
    driver=FakeRoverDriver(),
    time_provider=lambda: datetime(2024, 1, 15, 12, 0, 0),
    uuid_provider=lambda: f"test-uuid-{counter}"
)
```

## Integration Tests (test_integration.py)

Integration tests use Flask's test client:

```python
@pytest.fixture
def client():
    driver = FakeRoverDriver()
    service = RoverQueueService(driver=driver)
    create_app(service)

    with app.test_client() as client:
        yield client

def test_add_returns_200(self, client):
    response = client.post('/queue/add', json=[
        {'cmd': 'forward', 'params': {'speed': 60}}
    ])
    assert response.status_code == 200
```

### Test Categories

- **TestHealthEndpoint**: /health responses
- **TestQueueAddEndpoint**: /queue/add validation and responses
- **TestQueueStatusEndpoint**: /queue/status responses
- **TestQueueClearEndpoint**: /queue/clear behavior
- **TestEndToEndFlow**: full instruction lifecycle with processor

## Manual Testing

### Test Rover Server (Fake Driver)

On any machine (not Pi), the server auto-detects and uses FakeRoverDriver:

```bash
cd yard/rover
python rover_server.py
# Output: "Using FakeRoverDriver (not on Pi)"

# Test with curl
curl -X POST http://localhost:8523/queue/add \
  -H "Content-Type: application/json" \
  -d '[{"cmd": "forward", "params": {"speed": 60, "seconds": 1}}]'

# Watch server logs for fake-driver commands:
# [FAKE] Forward at speed 60
# [FAKE] Stop
```

### Test Tablet Client (Spy Mode)

```
http://localhost:3001/code/?spy=true
```

In spy mode:
- Shows spy output panel below Blockly workspace
- Displays exactly what instructions would be sent
- No network calls - works completely offline

### End-to-End Test

1. Start rover server: `cd yard/rover && python rover_server.py`
2. Start satellite: `cd yard/satellite && ROVER_URL=http://localhost:8523 python web_server.py`
3. Open `/code/` in browser
4. Create program: Forward 1s, Spin Left 0.5s, Forward 1s
5. Click Run
6. Verify queue status updates
7. Click Stop mid-execution
8. Verify immediate stop and queue clear

### Satellite: Mission Recording (camera readiness, STOP, review flow)

Covers BACKLOG 334/335/336/338 - the camera readiness check before dispatch,
recording tied to a run's lifecycle, and the guarantee that a stopped or
rover-rejected run never looks like a successful one.

**Automated tests** (no camera or browser needed):
```bash
cd yard/satellite
pip install -r requirements.txt -r requirements-test.txt
pytest tests/test_recording_control.py tests/test_operator_console.py tests/test_mission_watcher.py tests/test_mission_store.py -v
```
`test_recording_control.py` fakes the camera's WebSocket frame broadcast
entirely, so it exercises the real encode/write/delete code paths without
any hardware. It's skipped automatically (see `conftest.py`) if
`opencv-python` isn't installed.

**Manual walkthrough**, useful for seeing the operator-console UI actually
react (badge, toasts, review card). Needs `npm run dev:yard` and
`npm run dev:satellite` running, with the satellite's Settings page pointed
at `http://localhost:8523` (its default `ROVER_URL` points at a real Pi
hostname, `marspi.local`, which won't resolve locally).

If this machine has no working camera, "Send to rover" will always be
refused by the readiness check - which is itself worth seeing once, but it
also means a mission can never reach `processing` through the UI. Seed one
directly instead, always with a fresh mission id (reusing one leaves
`local_dirty=1`/an existing run row behind from the previous test, which
silently blocks the next reset):

```bash
cd yard/satellite
mkdir -p recordings && echo "pretend video bytes" > recordings/test-3__curiosity.mp4
python3 - <<'EOF'
import mission_store
mission_store.upsert_missions([{"id": "test-3", "yardId": "curiosity", "status": "processing", "submittedAt": "2026-08-29T08:00:00Z"}], "2026-08-29T08:00:00Z")
mission_store.backfill_missions_to_runs()
mission_store.set_run_recording_state("test-3", "curiosity", "recording", path="recordings/test-3__curiosity.mp4", started_at="2026-08-29T09:00:00Z")
EOF
```

1. Check the starting state: `python3 -c "import mission_store; print(mission_store.get_run('test-3', 'curiosity'))"` - expect `status: processing`, `recording_status: recording`.
2. Open `/operator/mission/test-3` - confirm the **Recording** badge shows next to the status pill.
3. Click **STOP**.
4. Re-run the same `get_run` check - expect `status: cancelled`, `recording_status: discarded`, `recording_stopped_at` now populated.
5. Confirm the file itself is gone: `test -f recordings/test-3__curiosity.mp4 && echo still there || echo deleted`.

The same seeding approach (`mission_store.flag_for_review('<id>', '<reason>')` on a `processing` run) exercises the "needs review" card and its three outcomes - Mark complete keeps the recording, Put back in queue and Cancel both discard it.

## Fake Driver

The `FakeRoverDriver` logs all commands instead of controlling hardware:

```python
class FakeRoverDriver(RoverDriver):
    def forward(self, speed):
        print(f"[FAKE] Forward at speed {speed}")

    def stop(self):
        print(f"[FAKE] Stop")
```

Auto-detection logic in `create_driver()`:
- Checks for `/dev/i2c-1` (Pi I2C bus)
- If found: returns `RealRoverDriver`
- If not found: returns `FakeRoverDriver`

## Writing New Tests

### Unit Test Template

```python
def test_new_feature(self):
    # Arrange
    self.service.add_instructions([...])

    # Act
    result = self.service.some_method()

    # Assert
    assert result['status'] == 'ok'
```

### Integration Test Template

```python
def test_new_endpoint(self, client):
    # Act
    response = client.post('/new/endpoint', json={...})

    # Assert
    assert response.status_code == 200
    data = response.get_json()
    assert data['field'] == 'expected'
```

### Testing Async Behavior

For tests involving the queue processor:

```python
def test_processor_completes(self, client_with_processor):
    # Add instruction
    client_with_processor.post('/queue/add', json=[
        {'cmd': 'forward', 'params': {'seconds': 0.1}}
    ])

    # Wait for execution
    time.sleep(0.3)

    # Check completion
    response = client_with_processor.get('/queue/status')
    data = response.get_json()
    assert data['history_count'] >= 1
```
