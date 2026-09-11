# Maintainer Runbook

**Status: draft.** Started 2026-08-29 for AB#428. Sections marked *unverified*
have not been done end-to-end by the person who wrote them.

This is for someone who has inherited the platform and needs to operate it.
It is not the event-day manual: that is [`yard/MANUAL.md`](../yard/MANUAL.md),
which covers power-on order, running a session, and fixing a rover that will
not move. Read that one on the day. Read this one when something needs
changing, granting, or migrating.

---

## 1. Who can do what

This is first because it cost a full afternoon to work out, and none of it is
guessable. **There are three separate identities and they do not overlap.**

| To do this | You need | Notes |
|---|---|---|
| Read/write Firestore, read Firebase Auth | `gcloud auth application-default login` | Any team member with project access |
| Deploy Firestore **rules and indexes** | Firebase CLI, signed in as the account that holds Firestore admin | Often *not* the one that is active. See below. |
| Grant an IAM role, run Terraform, read Cloud Run logs | Werner or Gavin | Nobody on the student team holds these |

### The Firebase CLI account trap

`firebase` has its own auth, separate from `gcloud`, and it is common to have
more than one account logged in. **They do not have the same access**: on
this project the UCT account can deploy rules and indexes and the personal one
cannot. Check which is active before assuming a permissions problem is real:

```bash
firebase login:list          # who is available, and who is active
firebase login:use <account> # switch to the one with Firestore admin
```

Symptom when it is wrong: `HTTP Error: 403, The caller does not have
permission` from any `firestore:indexes` or `deploy` command.

### Checking what you actually hold

Rather than guessing, ask:

```bash
curl -s -X POST "https://cloudresourcemanager.googleapis.com/v1/projects/bt-impact-academy:testIamPermissions" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" -d '{"permissions":["datastore.indexes.create","resourcemanager.projects.setIamPolicy"]}'
```

An empty `{}` means you hold none of them.

---

## 2. Environment variables: what is set where

**One project: `bt-impact-academy`.** The old `mars-rover-cloud-platform` is
retired, billing off. If you see that name anywhere outside a comment
explaining the migration, it is a bug.

### Loading order, and the trap in it

The dev launcher layers env files. **Later wins:**

```
mission-control/.env  <  yard/satellite/.env  <  real environment
```

So anything set in `yard/satellite/.env` **overrides** the shared config. That
is how the satellite once spent a month talking to the retired project while
Mission Control talked to the live one. The satellite reads no Firebase config
at all now, so **keep Firebase values out of `yard/satellite/.env`**: it needs
`YARD_ID` and little else.

### The matrix

| Where | Holds | Credential |
|---|---|---|
| `mission-control/.env` | `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID`; optionally `RESEND_*`, `YOUTUBE_*`, `CRON_SECRET` | ADC |
| `yard/satellite/.env` | `YARD_ID`, and the ports if they differ; the rest lives on `/settings` | none: the satellite holds no cloud credential |
| `yard/rover/.env` | `ROVER_SERVER_PORT`, `YARD_TYPE`, `POSTHOG_*` (optional) | none needed |
| Cloud Run (staging/prod) | `FIREBASE_PROJECT_ID`; `CRON_SECRET` mounted; Resend and YouTube settings read from Secret Manager per request, edited on `/operator/settings` | ADC via runtime service account |

**No service-account key is mounted anywhere.** Cloud Run runs as its own
runtime service account, and `firebase-admin.ts` refuses to start if
`FIREBASE_CLIENT_EMAIL` or `FIREBASE_PRIVATE_KEY` is set. Nothing to rotate,
nothing to leak. If you find yourself pasting a private key into a `.env`,
stop and use ADC.

### Local setup from scratch

```bash
gcloud auth application-default login
npm install
.venv/bin/pip install -r yard/rover/requirements.txt -r yard/satellite/requirements.txt
npm run dev
```

**`npm run dev` must be run from the repository root.** From inside
`mission-control/` it starts only Next.js. Ports are 3000 Mission Control,
3001 satellite, 8523 rover.

---

## 3. Granting and removing operator access

### The normal way

An admin signs in to Mission Control and opens **`/operator` → Manage
access**. Grant by email, promote, step down, or remove. The account must
already exist in Firebase Authentication: granting a role does not create
one.

### The first admin on a fresh project

`/operator/team` needs an admin to already exist, so the very first one has to
come from the script:

```bash
cd mission-control
set -a && source .env && set +a
node scripts/set-operator-role.mjs --email someone@example.com --role admin --apply
```

This is the only thing that script is still for.

### What the page will not let you do

- **Remove the last admin**, by revoking or demoting. There would be no way
  back in except the script above.
- **Remove your own access.** Ask another admin.

### How quickly removal takes effect

Immediately. Every request to an operator page or route re-verifies the
session with `checkRevoked`. There is nothing to revoke at the yard: the
satellite has no sign-in, and anyone on the venue LAN can use it. That is
deliberate, because an auth gate that only works when the venue wifi does
protects nothing on a box that has to run without it.

---

## 4. Deploying rules and indexes

Both live in the repo (`firestore.rules`, `firestore.indexes.json`) and are
**not** deployed by CI. Someone has to run this after changing either:

```bash
firebase login:use your email
firebase deploy --only firestore --project bt-impact-academy
```

Without `--force` it will create missing indexes and refuse to delete ones not
in the repo, telling you how many it skipped. Read that number before reaching
for `--force`.

**Symptom of a missing index:** a query that used to work fails with
`The query requires an index`, and the error carries a console link that
creates exactly the one it needs. Queries the browser makes (the feed, the
operator queue) report it in the browser console; server-side ones in the
Cloud Run logs.

---

## 5. Unsticking things

### A run is stuck in `processing`

Nothing at the yard writes run status any more: the satellite does not talk to
Firestore, and runs are settled by an operator in Mission Control. From
`/operator`, **complete** the run if the rover did run it, **cancel** it if it
did not. Cancel is allowed on a running mission for exactly this case, and
records an outcome without reaching the rover.

### The needs-review count is stuck

Review flags were raised by the satellite's crash recovery, which went with the
Firestore mirror, so nothing raises new ones. Clear any left over with
**Resolve** on the run in `/operator`; completing or cancelling the run
settles the flag too.

### A video will not attach to its run

Work down this list:

- **Is the run complete?** The linker only attaches a video to a completed
  run. It tries again on each later check, as long as the upload is still
  among the channel's 50 most recent.
- **Does the description carry the `MissionID:` and `Yard:` lines** the run
  station writes? Uploading the file under its own name is not enough: the
  satellite puts a timestamp in every recording's name, and the linker's
  title match expects `<mission>__<yard>` alone.
- **Does the satellite's `YARD_ID` match the yard in Mission Control?** It
  must be **`curiosity`**, the rover's own mDNS name. The `Yard:` line comes
  from it, and a video naming a yard with no run there is skipped.
- **Is auto-linking set up at all?** It needs a YouTube key and channel on
  `/operator/settings`, and Terraform creates the scheduler job only in the
  environment `cron_environment` names.

An operator can always attach the link by hand in `/operator`.

---

## 6. Testing without any of this

The whole stack runs on a laptop with no hardware and no cloud project.

```bash
cd yard/rover     && ../../.venv/bin/pytest -q     # 202 tests
cd yard/satellite && ../../.venv/bin/pytest tests -q  # 243 tests
cd mission-control && npx jest --ci                   # 76 suites
```

`create_driver()` returns `FakeRoverDriver` automatically when there is no
`/dev/i2c-1`, so nothing needs a rover attached.

**Firestore rules** run against the emulator (`firebase.json` configures it on
port 8080):

```bash
firebase emulators:exec --project demo-rules-test --only firestore "node scripts/firestore-rules-test.mjs"
```

---

## 7. If you ever migrate projects again

Read this before starting. The 2026 move to Impact's Firebase carried the
**documents** and not the **configuration**, and each missing piece surfaced
separately, weeks apart, as an unrelated-looking bug.

What has to move, beyond the data:

- [ ] **Composite indexes**: `firebase deploy --only firestore:indexes`.
      Missing ones surface as a 400 on a query that used to work.
- [ ] **Security rules**: `firebase deploy --only firestore:rules`.
- [ ] **IAM roles for the runtime service account.** Firestore access does not
      imply Firebase Auth access. Operator login on staging was broken from the
      day it shipped because the Cloud Run identity had `roles/datastore.user`
      and nothing else.
- [ ] **Every `.env` in the repo**, not just the one you are looking at. Check
      for the old project id: `grep -rn "old-project-id" --include=".env*"`.
- [ ] **Operator accounts and their role claims**: they do not migrate.
- [ ] **Secret Manager values**: a `CHANGE_ME` placeholder starts the service
      and fails at the first real call.

---

## 8. Backups and restore

*Restore is **unverified**: the export side runs, the import side has not been
done end-to-end on this project.*

Three separate things protect the data, and they cover different accidents:

| Mechanism | Covers | Window |
|---|---|---|
| Point-in-time recovery | "someone deleted a collection an hour ago" | last 7 days, second granularity |
| Weekly managed export to GCS | "the project is gone", "this was already wrong last month" | 90 days of weekly copies |
| Delete protection on the database | someone runs a delete on the wrong project | permanent, until deliberately lifted |

The export is a Cloud Scheduler job calling the Firestore admin API, defined in
[`infra/modules/firestore-backup`](../infra/modules/firestore-backup). It runs
Sunday 03:00 SAST and writes to `gs://bt-impact-academy-firestore-backup`,
which is in `europe-west1` because a managed export will not write to a bucket
away from its database. PITR and delete protection are set on the database
itself, which is provisioned outside Terraform like the rest of Firebase.

An export is a copy of a live database. It is not transactionally consistent
across collections and may miss writes from the seconds around it. That is
fine for what it is for and is why PITR exists alongside it.

### Take a copy before doing something destructive

```bash
gcloud scheduler jobs run firestore-export-weekly --location=africa-south1
```

Or directly, if you want your own prefix:

```bash
gcloud firestore export gs://bt-impact-academy-firestore-backup/pre-migration-$(date +%F)
```

Both return immediately with a long-running operation. Watch it with
`gcloud firestore operations list`.

### Restore

Import **merges**: a document in the export overwrites the one at the same
path, and anything created since the export is left alone. There is no "reset
to this point" mode, so a restore does not undo creates.

Restore into a scratch database first and look at it, rather than importing
straight over live data:

```bash
gcloud firestore databases create --database=restore-check --location=europe-west1
gcloud firestore import gs://bt-impact-academy-firestore-backup/<PREFIX> \
    --database=restore-check
```

`<PREFIX>` is the timestamped folder Firestore generated for that run, and the
import path is the folder that holds the `.overall_export_metadata` file. When
it looks right:

```bash
gcloud firestore import gs://bt-impact-academy-firestore-backup/<PREFIX>
```

### Recovering to a point in time inside the last 7 days

PITR is read-only history, so recovery is an export of the past followed by an
import:

```bash
gcloud firestore export gs://bt-impact-academy-firestore-backup/pitr-recovery \
    --snapshot-time=2026-09-10T08:00:00Z
gcloud firestore import gs://bt-impact-academy-firestore-backup/pitr-recovery
```

Snapshot times are limited to whole minutes within the retention window.

### Who can do this

Owner (Werner or Gavin), or `roles/datastore.importExportAdmin` plus write on
the bucket. Nobody on the student team holds either, deliberately: an import
is the one operation here that can overwrite every document in the project.

---

## 9. Known open items

| Item | Blocked on |
|---|---|
| Operator login on **staging** | PR #96 merged, needs `terraform apply` by Werner or Gavin |
| Two dead Firestore indexes (`missions.learnerId`, `rover-configs`) | Cleanup only; `--force` deploy when someone chooses to |
| WiFi and SSH credentials in git history (AB#429) | Team decision: moving to a password manager |

---

## What this does not cover yet

*Honest gaps, so nobody assumes they are documented:*

- Restoring from backup: the procedure is written up in §8, but the import
  half has never been run on this project.
- Deploying prod. It is deliberately undeployed; the promotion workflow exists
  but has never been run.
- Rebuilding the satellite Pi from a bare flash: see `yard/MANUAL.md` §3,
  which is written but *unverified* since the last reflash.
- What to do when YouTube upload quota runs out.
