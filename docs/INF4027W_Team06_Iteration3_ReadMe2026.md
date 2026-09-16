# INF4027W: Mission Control
## Iteration 3 ReadMe, 2026

**Team:** Team06
**Repository:** https://github.com/HlalanathiMashimbye/4tronix-rover-simulator
**Live system:** https://marsyard.labs.ws
**Progressive Challenges and leaderboard:** branch [`feat/challenges`](https://github.com/HlalanathiMashimbye/4tronix-rover-simulator/tree/feat/challenges)

---

## 1. What this is

Learners write a rover mission in Python or Blockly and submit it from a
browser. An operator at the venue runs it on a physical 4tronix M.A.R.S.
rover, the run is filmed, and the video is linked back to the learner's
mission page.

| Part | Runs on | Does |
|---|---|---|
| Mission Control | Google Cloud Run | Learner app, operator console (`/operator`), YouTube linking, email |
| Yard satellite | Raspberry Pi on the venue LAN | Run station, tablet editor, TV monitor, camera, recordings |
| Rover server | The rover's Raspberry Pi | Mission queue, motors and servos |

No server connects the cloud to the yard. The venue is on mobile data with no
inbound port, so the operator's browser is the bridge: it reads the yard's
status and sends the mission to the run station. The yard holds no cloud
credentials and needs no internet to run a mission.

`docs/ARCHITECTURE.md` explains the full flow and the reasons behind it.

---

## 2. Progressive Challenges (branch)

Challenges and the leaderboard live on `feat/challenges`, not `main`. The
partner organisation asked for them to stay out of the product; the branch
keeps them working and mergeable for demonstration. The branch is always
`main` plus one commit. `docs/challenges-branch.md` explains how to switch to it.

---

## 3. Running it

Needs Node.js 20+, Python 3.11+, and a Firebase project (Firestore, Email/Password
auth). No rover hardware: the rover server falls back to a fake driver.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r yard/satellite/requirements-test.txt -r yard/rover/requirements.txt
npm install
npm run dev
```

| Service | URL |
|---|---|
| Mission Control | http://localhost:3000 |
| Yard satellite | http://localhost:3001 |
| Rover server | http://localhost:8523 |

**Configuration.** Copy `mission-control/.env.example` to `mission-control/.env`
and fill in your Firebase values. The real `.env` is not submitted because it
holds live credentials. Server-side Firebase uses Application Default
Credentials (`gcloud auth application-default login`), so no key file is needed.
The hosted site at https://marsyard.labs.ws skips all of this.

---

## 4. Tests

| Suite | Command | Tests |
|---|---|---|
| Mission Control (Jest) | `cd mission-control && npx jest` | 828 passing, 7 todo |
| Yard satellite (pytest) | `cd yard/satellite && python -m pytest tests -q` | 296 |
| Rover server (pytest) | `python -m pytest yard/rover -q` | 298 |

Counts are for `main`. On `feat/challenges` the Jest suite is 916 passing and
7 todo; the Python suites are the same on both branches.

CI (`.github/workflows/ci.yml`) runs five checks on every push: Mission Control
lint, build and tests; rover; satellite; browser tests (Playwright); and
Firestore rules against the emulator.

---

## 5. Repository layout

```
mission-control/src/
  core/domain/            entities, repository interfaces, safety rules
  core/application/       services and DTOs built on the domain
  infrastructure/         Firestore, Firebase Auth, Resend, YouTube
  app/  components/       routes, API handlers, React UI

yard/satellite/           Flask: run station, camera, recordings
yard/rover/               rover_server.py, service.py (queue, watchdog), drivers.py
infra/                    Terraform: Cloud Run, Secret Manager, IAM, Scheduler
docs/                     architecture, runbook, threat model
legacy/                   the original upstream simulator, kept for reference
```

---

## 6. Deployment

- **Cloud.** A push to `main` runs CI, then builds an image tagged with the git
  SHA and deploys it to staging (https://marsyard.labs.ws). Production reuses
  the exact image digest serving on staging. GitHub signs in to Google Cloud
  through Workload Identity Federation, so no service account key exists. All
  infrastructure is Terraform in `infra/`, in the partner's GCP project.
- **Venue.** Both Pis run a git checkout with systemd units from
  `yard/deploy/`. Updates are `git pull` and a service restart. CI cannot reach
  a Pi on a private network, so this step is manual.

---

## 7. Notes for the marker

**Response to iteration 2 feedback.**
- *Separation of concerns.* `core` never imports `infrastructure`.
  `mission-control/src/__tests__/unit/architecture.test.ts` fails CI if it does.
- *OO concepts.* The mission repository is split by caller into
  `IMissionReader`, `IMissionWriter` and `IMissionBookkeeping`. The rover's
  `RoverDriver` has a real and a fake implementation, held to one contract by
  `yard/rover/test_driver_contract.py`.
- *Validation.* The 0-100 speed range and the time limit are enforced in
  TypeScript and in Python, with a test that checks both sides agree.
- *Hardcoded rover path.* The 4tronix library is vendored into
  `yard/rover/vendor/`, and the code finds it through `ROVER_LIB_PATH`.
  `/home/mars` now appears only in the Pi's systemd units.
- *Code clarity.* Unused upstream code moved to `legacy/`. `AGENTS.md` sets
  the rules every change is checked against.

**Data protection.** Mission documents are world-readable, so they store
SHA-256 hashes of the learner id and email instead of the values. Emails live
only on the learner record, which cannot be listed.

**Learner code safety.** Learner Python runs with restricted builtins, under a
wall-clock watchdog, and the operator's stop button interrupts it mid-loop.

**Operator access.** Firebase sign-in with an `operator` or `admin` custom
claim, checked on the server and in `firestore.rules`. Admins grant and remove
operator access in the app. The yard satellite has no sign-in: it holds no
learner data and is only reachable on the venue LAN.

---

## 8. Iteration 3 scope

- Operator console moved into Mission Control: live queue per yard, and
  **Send to Rover** stays locked until the camera, rover and recording checks pass
- Missions sent straight to the run station, recorded, and linked to YouTube
  automatically
- Yard satellite simplified: the Firestore mirror removed, the run station and
  settings rebuilt to fit one screen
- Operator console usable on a phone
- Code quality work answering the iteration 2 marksheet (section 7)
- Progressive Challenges and leaderboard, on `feat/challenges`
