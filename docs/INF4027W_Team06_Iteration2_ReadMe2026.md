# INF4027W — Mission Control
## Iteration 2 ReadMe, 2026

**Team:** Team06 
**Repository:** https://github.com/HlalanathiMashimbye/4tronix-rover-simulator
**Live system:** https://mission-control-staging-cp4cyuy7ga-bq.a.run.app

---

## 1. What this is

Mission Control is an educational robotics platform. Learners write a rover
mission in Python or in Blockly blocks, submit it from a web browser, and an
operator at a science centre runs it on a physical 4tronix M.A.R.S. rover. The
run is filmed, and the recording is linked back to the mission so the learner
can watch their own code drive a real robot.

The system spans three environments, split along network boundaries:

| Band | Where it runs | What it does |
|---|---|---|
| **A. Cloud** | Google Cloud Run | Learner-facing web app, mission storage, email |
| **B. Venue LAN** | Raspberry Pi (`mro.local`) | Operator console, local mission queue, offline operation |
| **C. Rover** | Raspberry Pi Zero (`marspi.local`) | Mission execution, motor and servo control |

The defining constraint is that **the venue is frequently offline**. Band B
therefore keeps its own SQLite copy of everything it needs and reconciles with
the cloud later, so a dropped internet connection delays synchronisation but
never stops an operator running the rover.

---

## 2. Running the system

### Prerequisites

- Node.js 20 or later, and npm
- Python 3.11 or later
- A Firebase project (Firestore in Native mode, Email/Password auth enabled)

No rover hardware is required. The rover service falls back to a fake driver
automatically when it cannot find the hardware libraries, and the whole stack
runs on one laptop.

### Quick start

```bash
npm install          # first time only; also installs mission-control/
npm run dev          # starts all three services and opens the browser
```

| Service | URL | Purpose |
|---|---|---|
| Mission Control hub | http://localhost:3000 | Learner web app |
| Yard satellite | http://localhost:3001 | Operator console, tablet editor, TV monitor |
| Rover server | http://localhost:8523 | Mission execution API |

Individual services: `npm run dev:control`, `npm run dev:satellite`,
`npm run dev:yard`.

### Python environment

Only needed to run the Python test suites, or to start the yard services by
hand. `npm run dev` installs the satellite's Python dependencies on first run
by itself.

```bash
python3 -m venv .venv
source .venv/bin/activate                 # macOS and Linux
# .venv\Scripts\activate                  # Windows PowerShell

pip install -r yard/satellite/requirements-test.txt -r yard/rover/requirements.txt
```

Activating puts `(.venv)` in your prompt, after which plain `python` works.
The root `requirements.txt` belongs to the original desktop simulator (PyQt6,
OpenCV) and is **not** needed for Mission Control.

### Configuration

The hub reads `mission-control/.env`. **That file is excluded from this
submission because it contains live credentials.** To run the system you will
need to create it with your own Firebase project values(you can use the hosted site to skip the hassle):

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

FIREBASE_PROJECT_ID=...          # credentials come from
                                 # `gcloud auth application-default login`

RESEND_API_KEY=...               # learner status emails
RESEND_SANDBOX_RECIPIENT=...     # redirects ALL mail to one inbox while testing
```

The yard satellite takes `ROVER_URL` (default `http://marspi.local:8523`) and
`SATELLITE_PORT` (default `3001`). The rover URL is also editable at runtime
from the satellite's Settings page, which persists it across restarts.

---

## 3. Running the tests

| Suite | Command | Count |
|---|---|---|
| Hub (Jest) | `npm test --prefix mission-control` | 233 |
| Yard satellite (pytest) | `cd yard/satellite && python -m pytest tests -q` | 205 |
| Rover service (pytest) | `cd yard/rover && python -m pytest -q` | 103 |

Python dependencies for the test suites come from
`yard/satellite/requirements-test.txt` and `yard/rover/requirements.txt`.

Two satellite test files drive a real browser through Playwright and are
skipped automatically when Playwright is not installed, so `pytest tests` runs
everything it can on any machine and says plainly what it left out.

All three suites also run in CI on every push (`.github/workflows/ci.yml`).

---

## 4. Repository layout

```
mission-control/          Next.js 16 / React 19 learner-facing app (Band A)
  src/app/                Routes and API endpoints
  src/core/               Domain entities, services and ports (no framework code)
  src/infrastructure/     Firestore, Firebase Admin, Resend, validation
  src/components/         UI, Blockly editor, Monaco editor, 2D simulator

yard/satellite/           Flask operator console and local mirror (Band B)
  operator_console.py     Operator actions: dispatch, complete, cancel, video
  mission_store.py        SQLite mirror, outbox, mission leases
  sync_worker.py          The only component that talks to Firestore
  mission_watcher.py      Confirms completion against the rover
  recovery.py             Repairs runs interrupted by a restart

yard/rover/               Rover execution service (Band C)
  rover_server.py         HTTP and SSE API
  service.py              FIFO queue, sandboxed execution, watchdog
  drivers.py              RoverDriver abstraction: fake and real

infra/                    Terraform: Cloud Run, Artifact Registry, Secret
                          Manager, IAM, Workload Identity Federation
docs/architecture/        Architecture, network and deployment documentation
```

---

## 5. Deployment

The cloud application is deployed to Google Cloud Run and is publicly
accessible at the URL at the top of this document.

**Automated path.** A push to `main` triggers CI (lint, type-check, tests). On
success the image is built and tagged with the git SHA, pushed to Artifact
Registry, and deployed to Cloud Run staging. Promotion to production reads the
digest currently serving on staging and deploys those exact bytes, so both
environments run byte-identical artefacts and rollback is the same action
aimed at an older digest. GitHub authenticates to Google Cloud through
Workload Identity Federation, so no long-lived service account key exists.

**Manual path.** `scripts/deploy-demo.sh` builds and deploys directly, for
getting a URL up without waiting on CI.

**Venue path.** The two Raspberry Pis are provisioned once by cloning the
repository and installing systemd units from `yard/deploy/`. Updates are
`git pull` and a service restart over SSH on the venue network. There is no
build artefact for the venue and no removable media involved: CI cannot reach
a Pi on a private network, so venue deployment is deliberately manual and
verified step by step.

---

## 6. Notes for the marker

**Data protection.** Mission documents are world-readable, so they never carry
a learner's identity. They store two SHA-256 hashes instead: one of the learner
id and one of the email address. Actual email addresses live only on the
learner record, which can be fetched by exact id but never listed. The hash of
a learner id is genuine pseudonymisation (a 21-character nanoid cannot be
brute-forced); the email hash is deliberately weaker and documented as such,
since an address is low entropy and a guess can be confirmed. What it prevents
is bulk harvesting, which was the real exposure.

**Learner code safety.** Learner Python runs on the rover inside a restricted
namespace with a reduced builtins set, under a wall-clock watchdog, with a
trace hook that allows the operator's stop button to interrupt an infinite
loop. A mission that never terminates cannot occupy the rover indefinitely.

**Operator authentication.** The operator console uses Firebase sign-in with
custom claims. An `OPERATOR_AUTH=off` environment flag disables the login for
event days. This is a deliberate, documented exception rather than an
oversight: the console runs on a private venue network behind physical access
control, and a login failure in front of a queue of children is a worse outcome
than an unauthenticated console.

**Current hosting.** The live deployment runs in a personal Google Cloud
project. The intended host is the partner organisation's project, where the
account currently lacks the IAM permissions needed to create the deployment
identity. The Terraform is unchanged between the two: moving across is a
variable file and a re-initialisation, not a rewrite.

**Known limitations.**
- Learner status emails are redirected to a single test inbox while the
  sending domain is unverified, so no learner currently receives mail.
- Production traffic on the partner project is pending an infrastructure
  permission change outside the team's control.
- The rover physics module in `yard/rover/rover_physics.py` is retained for
  reference only; the simulation shown to learners runs in TypeScript.

---

## 7. Iteration 2 scope

Delivered in this iteration:

- Offline-first venue operation: local SQLite mirror, outbox, mission leases
  and restart recovery, so the yard runs with no internet connection
- Operator console rebuilt around the mission queue, with a mission execution
  view, a stop control, and live line-by-line progress during a run
- Firestore read cost reduced to roughly a tenth of the previous figure, well
  inside the free tier
- Cloud deployment through Terraform and GitHub Actions with no stored
  credentials, and the platform publicly hosted
- Architecture, network and deployment documentation with generated diagrams
  (`docs/architecture/`)
