# yard/satellite/

The classroom-facing web tier, typically run on a separate Pi
(`mro.local`, web UI on `:3001`, override with `SATELLITE_PORT`). It serves the
tablet Blockly interface and the TV monitor, proxies API calls to the rover
server, and keeps working when the venue network drops. See
[../docs/satellite.md](../docs/satellite.md) and
[../docs/offline-sync-plan.md](../docs/offline-sync-plan.md).

| File | Role |
|------|------|
| `web_server.py` | Flask server: serves the Blockly UI and TV monitor, proxies to the rover server. |
| `operator_console.py` | Operator actions (send, complete, requeue, etc.) with lease-based locking. |
| `mission_store.py` | Local SQLite store — the source of truth the request handlers read/write. |
| `sync_worker.py` | Background thread that reconciles local SQLite with Firestore (outbox-before-pull). The only component that talks to Firestore. |
| `mission_watcher.py` | Watches for new missions to run. |
| `camera_server.py` / `camera_control.py` | Pi camera stream for the TV monitor. |
| `recovery.py` | Recovers state after a crash or power loss. |
| `satellite_identity.py` | Stable per-satellite identity (used for lock ownership). |
| _(removed)_ | Granting the operator role now lives in `mission-control/scripts/set-operator-role.mjs`. The old Python script wrote only the custom claim and replaced the whole claims object; the Node one writes the claim and the `users/{uid}` ledger, merges rather than clobbers, revokes refresh tokens on revoke, and is dry-run by default. |
| `tests/` | pytest suites for the store, sync worker, console, proxying, and recovery. |

```bash
# From the repo root
npm run dev:satellite     # cross-platform launcher
```

The Flask handlers only ever touch local SQLite; `sync_worker.py` is what makes
the console keep working with no internet instead of failing at the door.
