# Maintainer Runbook

**Status: draft.** Started 2026-08-29 for AB#428. Sections marked *unverified*
have not been done end-to-end by the person who wrote them.

This is for someone who has inherited the platform and needs to operate it.
It is not the event-day manual — that is [`yard/MANUAL.md`](../yard/MANUAL.md),
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
more than one account logged in. **They do not have the same access** — on
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
is how the satellite spent a month talking to the retired project while
Mission Control talked to the live one. **Leave the Firebase values blank in
`yard/satellite/.env`** and let them inherit.

### The matrix

| Where | Holds | Credential |
|---|---|---|
| `mission-control/.env` | `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_PROJECT_ID` | ADC (key lines commented out) |
| `yard/satellite/.env` | `OPERATOR_SESSION_SECRET`, `YOUTUBE_*` — **Firebase blank** | inherits |
| `yard/rover/.env` | `ROVER_SERVER_PORT`, `YARD_TYPE`, `POSTHOG_*` (optional) | none needed |
| Cloud Run (staging/prod) | `FIREBASE_PROJECT_ID`, `RESEND_*` from Secret Manager | ADC via runtime service account |

`impact.tfvars` sets `firebase_credential_source = "adc"`, so **no
service-account key is mounted anywhere.** Nothing to rotate, nothing to leak.
If you find yourself pasting a private key into a `.env`, stop and use ADC.

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
already exist in Firebase Authentication — granting a role does not create
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

| Surface | Delay |
|---|---|
| Mission Control | Immediate — every request re-verifies with `checkRevoked` |
| Yard console, online | Within 5 minutes |
| Yard console, offline | Up to `OPERATOR_SESSION_MAX_AGE` (12h default) |

The satellite fails **open** when Firebase is unreachable, on purpose: a check
that failed closed would lock an operator out of a rover because venue wifi
dropped. The 12-hour cap is what bounds a revoked session instead.

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

**Symptom of a missing index:** the satellite logs
`Failed to pull from Firestore: 400 The query requires an index`, with a
console link that creates exactly the one it needs.

---

## 5. Unsticking things

### The queue shows a mission that will not move

A run stuck in `processing` means the satellite stopped mid-mission. On
restart, `recovery.py` asks the **rover** whether it finished. If the rover
confirms, the run is completed; otherwise it is flagged for review, and no
outcome is invented.

To clear it by hand, from the operator console: **complete** it if the rover
did run, **cancel** it if it did not. Rerun also works on a *flagged* run —
that is the one case where a `processing` run may be restarted, and doing so
clears the flag.

### The needs-review count is stuck

```bash
cd yard/satellite
python clear_stale_review_flags.py           # dry run
python clear_stale_review_flags.py --apply
```

Only clears flags on missions that already reached a terminal state. One still
processing is genuinely ambiguous and is left for a human.

### The satellite syncs but the queue is empty

Almost always a `YARD_ID` mismatch. The pull is yard-scoped, so a wrong value
shows up as an empty queue with nothing logged. It must be **`curiosity`** —
the rover's own mDNS name, matching `KNOWN_YARDS` in Mission Control.

---

## 6. Testing without any of this

The whole stack runs on a laptop with no hardware and no cloud project.

```bash
cd yard/rover     && ../../.venv/bin/pytest -q     # 110 tests
cd yard/satellite && ../../.venv/bin/pytest tests -q  # 234 tests
cd mission-control && npx jest --ci                   # 42 suites
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

- [ ] **Composite indexes** — `firebase deploy --only firestore:indexes`.
      Missing ones surface as a 400 on a query that used to work.
- [ ] **Security rules** — `firebase deploy --only firestore:rules`.
- [ ] **IAM roles for the runtime service account.** Firestore access does not
      imply Firebase Auth access. Operator login on staging was broken from the
      day it shipped because the Cloud Run identity had `roles/datastore.user`
      and nothing else.
- [ ] **Every `.env` in the repo**, not just the one you are looking at. Check
      for the old project id: `grep -rn "old-project-id" --include=".env*"`.
- [ ] **Operator accounts and their role claims** — they do not migrate.
- [ ] **Secret Manager values** — a `CHANGE_ME` placeholder starts the service
      and fails at the first real call.

---

## 8. Known open items

| Item | Blocked on |
|---|---|
| Operator login on **staging** | PR #96 merged, needs `terraform apply` — Werner or Gavin |
| Two dead Firestore indexes (`missions.learnerId`, `rover-configs`) | Cleanup only; `--force` deploy when someone chooses to |
| WiFi and SSH credentials in git history (AB#429) | Team decision: moving to a password manager |

---

## What this does not cover yet

*Honest gaps, so nobody assumes they are documented:*

- Restoring from backup — **there are no backups yet** (Werner's item).
- Deploying prod. It is deliberately undeployed; the promotion workflow exists
  but has never been run.
- Rebuilding the satellite Pi from a bare flash — see `yard/MANUAL.md` §3,
  which is written but *unverified* since the last reflash.
- What to do when YouTube upload quota runs out.
