INF4027W: Mission Control
Iteration 4 ReadMe, 2026

Team: Team06
Repository: https://github.com/HlalanathiMashimbye/4tronix-rover-simulator
Live system (production): https://marsyard.sapient.rocks
Staging: https://marsyard.labs.ws
Progressive Challenges and leaderboard: branch feat/challenges (https://github.com/HlalanathiMashimbye/4tronix-rover-simulator/tree/feat/challenges)

1. What this is
---------------

Learners write a rover mission in Python or Blockly and submit it from a
browser. An operator at the venue sends it to a physical 4tronix M.A.R.S.
rover with one press, the run is filmed, and the video is uploaded to YouTube
and linked back to the learner's mission page without anyone handling the
file.

    Part              Runs on                         Does
    Mission Control   Google Cloud Run                Learner app, operator console (/operator), YouTube linking, email
    Yard satellite    Raspberry Pi on the venue LAN   Run station, tablet editor, TV monitor, camera, recordings, uploads
    Rover server      The rover's Raspberry Pi        Mission queue, motors and servos

No server connects the cloud to the yard. The venue has no inbound port, so
the operator's browser is the bridge: it reads the yard's status and opens the
run station with the mission. Mission Control signs that handoff, and the
satellite checks the signature before it moves the rover, so a link from
anywhere else waits for someone to press Send. The yard needs no internet to
run a mission; finished videos upload when it has one.

docs/ARCHITECTURE.md explains the full flow and the reasons behind it.

2. Progressive Challenges
-------------------------

The submitted zip is main with the Progressive Challenges and leaderboard
merged in, as in iteration 3. On GitHub they stay on feat/challenges, because
the partner organisation asked for them to stay out of the live product.
docs/challenges-branch.md explains how to switch.

3. Running it
-------------

Needs Node.js 20+, Python 3.11+, and a Firebase project (Firestore, Email/Password
auth). No rover hardware: the rover server falls back to a fake driver, and
the satellite's Settings page can switch to the simulator.

    python3 -m venv .venv && source .venv/bin/activate
    pip install -r yard/satellite/requirements-test.txt -r yard/rover/requirements.txt
    python -m playwright install chromium        # only for the browser tests
    npm install
    npm run dev

    Service           URL
    Mission Control   http://localhost:3000
    Yard satellite    http://localhost:3001
    Rover server      http://localhost:8523

Configuration. Copy mission-control/.env.example to mission-control/.env
and fill in your Firebase values (yard/satellite/.env.example and
yard/rover/.env.example list the yard's optional settings). The real .env
files are not submitted because they hold live credentials. Server-side
Firebase uses Application Default Credentials (gcloud auth
application-default login), so no key file is needed. The hosted sites skip
all of this.

4. Tests
--------

    Suite                     Command                                          Tests
    Mission Control (Jest)    cd mission-control && npx jest                   {JEST}
    Yard satellite (pytest)   python -m pytest yard/satellite/tests -q         {SAT}
    Rover server (pytest)     python -m pytest yard/rover -q                   {ROVER}

Counts are for this zip. The satellite count includes browser tests that
drive the real pages in Chromium.

CI (.github/workflows/ci.yml) runs five checks on every pull request and
push to main: Mission Control lint, build and tests; rover; satellite; browser
tests (Playwright); and Firestore rules against the emulator. All five must
pass before anything merges.

5. Repository layout
--------------------

    mission-control/src/
      core/domain/            entities (Mission, MissionState, YouTubeVideoId), repository interfaces, safety rules
      core/application/       use cases: operator commands, video linking, handoff signing, notifications
      infrastructure/         Firestore, Firebase Auth, Resend, YouTube; container.server.ts and container.browser.ts wire them
      app/  components/       routes, API handlers, React UI

    yard/satellite/           Flask app factory and blueprints; pages in templates/, their scripts in static/pages/
    yard/rover/               rover_server.py, service.py (queue, watchdog), drivers.py (real and fake)
    infra/                    Terraform: Cloud Run, load balancer, Secret Manager, IAM, Scheduler, backups
    docs/                     architecture, runbook, threat model, test cases
    legacy/                   the original upstream simulator, kept for reference

CONTRIBUTING.md sets the rules every change is held to, and
mission-control/src/__tests__/unit/architecture.test.ts enforces the
structural ones.

6. Deployment
-------------

- Cloud. A merge to main runs CI, then builds an image tagged with the git
  SHA and deploys it to staging. Production went live on 23 October 2026 and
  is promoted by hand: the "Deploy prod" workflow copies the exact image
  digest serving on staging, after a named reviewer approves. GitHub signs in
  to Google Cloud through Workload Identity Federation, so no service account
  key exists. All infrastructure is Terraform in infra/, in the partner's GCP
  project.
- Venue. Both Pis run a git checkout with systemd units from yard/deploy/.
  Updates are git pull and a service restart, which the satellite's operator
  account may run without a password for exactly those services. CI cannot
  reach a Pi on a private network, so this step is manual. yard/docs/ covers
  the hardware and the network.

7. Notes for the marker
-----------------------

Response to the iteration 2 and 3 feedback, and to our own review against
the coding marksheet.

- OO concepts. Mission is a class: it holds its record and runs privately and
  decides every operator action (complete, cancel, log another run, attach or
  remove a video, feedback, resolve a review); Mission.submit is the one place
  a new mission gets its first status. MissionState and YouTubeVideoId are
  value objects. On the yard, RoverDriver is an abstract class with a real and
  a fake implementation held to one contract (yard/rover/test_driver_contract.py).
- Separation of concerns. core never imports infrastructure, routes and
  components reach Firestore and the Admin SDK only through the two
  containers, collection names live in one file, and a mission's status is set
  only by the Mission entity.
  architecture.test.ts fails CI on any of these. The satellite is an app
  factory with blueprints, and its pages keep their scripts in static/pages/.
- Validation and security. API routes parse their bodies with zod. The
  public routes are rate limited. The satellite and the rover accept a state
  change only from the yard's own pages, the camera stream plays only on them,
  and a mission starts by itself only with Mission Control's signature. Speeds
  and the 120 second limit are enforced in TypeScript and Python, with a test
  that checks both sides agree.
- APIs and fallbacks. An email that fails never fails the action that sent
  it; an upload that cannot reach Mission Control waits for a connection; an
  unsigned handoff falls back to a press of Send; the rate limiter fails open
  rather than block a class.
- Code clarity. Dead code was removed, there is no `any` in production code,
  and comments say why rather than cite tickets.

Data protection. Mission documents are world-readable, so they store SHA-256
hashes of the learner id and email instead of the values. Emails live only on
the learner record, in a subcollection no browser can read.

Learner code safety. Learner Python is checked against an allowlist in
Mission Control and again on the rover, runs with restricted builtins under a
wall-clock watchdog, and the operator's stop button interrupts it mid-loop.
Known limit: it runs inside the rover server's process. Moving it into an
isolated, unprivileged process is designed (yard/docs/learner-code-isolation.md)
and needs testing on the real rover before it ships.

Operator access. Firebase sign-in with an operator or admin custom claim,
checked on the server and in firestore.rules. Admins grant and remove operator
access in the app, and every admin hears when one of them grants a request.
The yard satellite has no sign-in: it holds no learner data and is only
reachable on the venue network.

8. Iteration 4 scope
--------------------

- One press from Mission Control runs a mission on the real rover, filmed
  from a second before it moves to a set time after it stops (a Settings
  slider)
- Videos upload to YouTube from the satellite and attach to the right run,
  including re-runs, with no file handling by the operator
- Run station, monitor and settings rebuilt for tablets and phones; a clear
  Mission complete notice, added after user acceptance testing
- User acceptance testing and operator training at the Science Centre; the
  yard runs on its own router (mars-relay-network)
- Production launched on its own database, with Firestore backups in Terraform
- Security hardening: same-origin gates, signed handoff, rate limits, camera
  origin check
- Code quality: the Mission entity, the satellite app factory, ports for every
  Firebase use, and the page scripts moved out of the templates
- Progressive Challenges: learner profiles with avatars, recovery codes,
  parent sign-in links and the leaderboard (in this zip; on feat/challenges on
  GitHub)
