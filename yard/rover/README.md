# yard/rover/

The queue-based instruction server that runs on the rover's Raspberry Pi
(`marspi.local:8523`). It receives instructions over a REST API and executes
them in order. See [../docs/rover-server.md](../docs/rover-server.md) for setup
and [../docs/api.md](../docs/api.md) for the endpoint reference.

Built with the Ports & Adapters (Hexagonal) pattern, so the HTTP layer, the
business logic, and the hardware are cleanly separated and independently
testable.

| File | Role |
|------|------|
| `rover_server.py` | Thin Flask HTTP adapter. Translates requests into service calls; no business logic. |
| `service.py` | `RoverQueueService` + `RoverQueuePort` — the application core (queue semantics, execution). |
| `drivers.py` | `RoverDriver` abstract base + `FakeRoverDriver` / `RealRoverDriver`, chosen by `create_driver()`. Falls back to the fake driver when not on a Pi. |
| `rover_physics.py` | Reference physics model (kept for parity; the live simulation now runs in TypeScript). |
| `test_*.py` | pytest suites for the service, drivers, physics, integration, and SSE. |

```bash
# From the repo root
npm run dev:yard          # cross-platform launcher
# or directly
python3 yard/rover/rover_server.py
```

With no I2C hardware present the server auto-selects `FakeRoverDriver`, so it
runs on any laptop.
