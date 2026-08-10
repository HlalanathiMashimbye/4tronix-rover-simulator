# Deployment Diagram

Companion writeup for `Mission Control: Deployment Path` (August 2026).

Two halves of this system ship on completely different clocks, so they get
completely different paths. The diagram splits them because trying to force one
pipeline over both would compromise each.

## A. Cloud path: Mission Control Hub

Fully automated, no human in the loop until production. A push to a feature
branch triggers GitHub Actions: install, lint, test, build the container image.
On green `main`, the image goes to Artifact Registry tagged with the git SHA,
which makes it an immutable artifact rather than a moving tag. Cloud Run staging
deploys that exact digest and health-checks the new revision.

Promotion to production is a separate manual step. It reads the digest
**currently serving on staging** and deploys those same bytes, with no rebuild.
Staging and production therefore run byte-identical artifacts, and rollback is
the same action aimed at an older digest. There is no build step between
"verified" and "live" that could introduce drift.

Two supporting boxes hang off this path rather than sitting in it:

- **Workload Identity Federation** authenticates GitHub to Google Cloud over
  OIDC, so no long-lived JSON service account key exists in the repo or in
  Actions secrets. The only credential CI ever holds is a short-lived token.
- **Secret Manager** injects admin credentials and runtime config as environment
  variables at deploy time, so nothing sensitive is baked into the image and
  rotating a secret does not require a rebuild.

Cloud Logging, Error Reporting and uptime checks watch the deployed revisions.

## B. Venue path: yard satellite and rover

Manual, and that is a decision rather than a shortfall. GitHub Actions cannot
reach a Raspberry Pi on a private venue network, so the venue path runs over SSH
on the venue LAN. The row is split because provisioning and updating are
genuinely different operations.

### B1, once per Pi

Image the SD card, clone the repo to `/home/mars/4tronix-rover-simulator`, build
a virtualenv with `--system-site-packages` (required, because `picamera2` comes
from apt and not pip), then install the systemd units from `yard/deploy/` and
enable them. From that point the services start on boot and restart after a
crash with no operator present, which matters at a venue where nobody is
watching a terminal. Configuration lands last: the rover URL is set per venue
and persisted to `satellite_config.json`, so a field fix survives reboots.

### B2, every release

SSH in, `git pull`, restart the two satellite services, then verify before
moving on. `curl http://localhost:3001/api/health` must return `status: ok`,
with `rover_status: connected` once the rover is up. Only then does the rover
get the same pull and restart, and only after its queue is confirmed to accept a
mission is the system called operational. The order is deliberate: verify the
satellite before touching the rover, so a failure has one obvious cause.

The fallback annotation is there because it has been needed. If mDNS fails, SSH
by IP. If the network is unusable, an HDMI monitor and keyboard plugged directly
into the Pi. Neither is the intended path, but neither requires the internet.

Once operational, the venue is offline-first: missions execute against the local
SQLite mirror with no connectivity at all, and `sync_worker.py` reconciles with
Firestore whenever the internet returns.

## Reading the lines

Solid arrows are automatic and online. Dashed arrows are manual steps over the
venue LAN. The blue dashed lines are identity and trust relationships rather
than deployment steps, which is why they enter the flow from below instead of
sitting in it.

## Why it is shaped like this

A bad cloud deploy is recoverable in a minute by promoting an older digest. A
bad venue deploy leaves children standing around a dead rover with no remote
rollback and, quite possibly, no internet. So the cloud path optimises for speed
and automation, and the venue path optimises for verification: every step is
checked before the next, and every step works with the internet down.

## Known caveats

- **Production is not serving traffic yet.** External ingress is blocked at the
  org policy level, waiting on elevated privileges. The pipeline is built and
  green through staging; the production box is proven mechanically but has not
  carried live traffic.
- **There is no venue build artifact.** The cloud path builds a container image;
  the venue path clones a repo and installs in place. Any diagram or writeup
  that shows a package being carried to the venue is wrong.
