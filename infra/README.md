# Infra: Mission Control on bt-impact-academy

Terraform for everything in Werner's deploy guide: Artifact Registry, Cloud
Run (staging + prod), deploy and runtime service accounts, Secret Manager,
and GitHub Workload Identity Federation. Firebase provisioning (Firestore
database, Auth, web app) happens alongside this, out of Terraform, see the
migration checklist below.

**This is NOT a from-zero apply.** A partial apply ran on 2026-07-17 and
stopped part way. Part A below resumes it. State re-verified against the live
project on 2026-08-03.

**Who runs this:** an owner on `bt-impact-academy` (Gavin, mfouche or Werner).
The UCT team inherits `roles/editor` through
`group:access.impact-academy-user@impact.com`, which does not include
`iam.workloadIdentityPools.create` or `setIamPolicy`, so they cannot finish
this apply themselves. Verified with `testIamPermissions`, not assumed from
role names.

## Part A: finish the Terraform bootstrap (one person, ~20 min)

### Already done, do not redo

- State bucket `gs://bt-impact-academy-tfstate` exists (in `africa-south1`;
  deliberate, state access has nothing to do with request latency).
- All 7 required APIs are enabled.
- 15 resources are already in state and healthy: the 7 APIs, the
  `mission-control-deploy` service account, the Artifact Registry repo, both
  Secret Manager secrets with their `CHANGE_ME` seed versions, and both
  runtime service accounts (staging + prod).

Skipping straight to `terraform apply` is correct. Running the old bucket
create or `gcloud services enable` will just error as already-existing.

### What is left

Not yet created: the Workload Identity pool, its provider and the
impersonation binding (the previous apply stopped right here), both Cloud Run
services, and every IAM binding.

That last one is easy to under-read. The three service accounts exist but hold
**zero project roles** - confirmed by reading the project IAM policy, and by
the absence of any `google_project_iam_member` in state. So fixing only the
WIF pool would not be enough: CI would authenticate and then fail on the first
push to Artifact Registry, because the deploy SA cannot write to it yet. This
is also why every `Deploy staging` run so far dies at the auth step with
`invalid_target` - the pool it names does not exist.

```bash
gcloud auth login
gcloud config set project bt-impact-academy

cd infra
terraform init
terraform plan
terraform apply
```

**Expected plan: `22 to add, 0 to change, 0 to destroy`.**

If you see a **destroy**, stop and ask. It means `var.region` has drifted from
`africa-south1` again: `location` is a force-new attribute on the Artifact
Registry repo, so a region mismatch silently proposes destroying and
recreating the registry that CI pushes to. This bit us once already - the
default said `europe-west1` while the state, the GitHub Actions variables and
the live repo all said `africa-south1`, and the plan came back
`23 to add, 0 to change, 1 to destroy`. Fixed in the same PR as this doc.

There is no soft-deleted `github` Workload Identity pool, so the undelete +
import caveat in the Notes below does not apply.

### After the apply

```bash
# Copy outputs into GitHub repo variables
terraform output
# Settings -> Secrets and variables -> Actions -> Variables:
#   GCP_WIF_PROVIDER, GCP_DEPLOY_SA, GCP_PROJECT_ID, GCP_REGION,
#   GCP_AR_REPO, STAGING_SERVICE, PROD_SERVICE
# plus the NEXT_PUBLIC_FIREBASE_* values from the NEW Firebase web app
# (Part B). The deploy workflow reads all of these; it will fail without the
# NEXT_PUBLIC_FIREBASE_* set, so they gate the first deploy, not the apply.
#
# Also set NEXT_PUBLIC_APP_URL to the service's own URL (get it from
# `terraform output service_urls`). It is inlined at `next build` time, so it
# has to be a GitHub *variable* read by the build - a Cloud Run runtime env
# var is too late.
```

**`NEXT_PUBLIC_APP_URL` is not set today** (13 variables are; this is not one
of them). It is worth being precise about what that breaks, because the code
looks like it has a safe fallback and does not:

```ts
`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/history`
```

The workflow passes `--build-arg NEXT_PUBLIC_APP_URL='${{ vars.… }}'`, so an
unset variable arrives as an **empty string**, not as undefined. `??` does not
catch empty strings, so the localhost fallback never fires and mission emails
render their link as a bare `/history`, which no mail client can resolve.

Next's own docs are explicit that `NEXT_PUBLIC_` values are frozen at build
time, so this cannot be corrected afterwards with a Cloud Run env var - it
needs a rebuild. Set the variable before the first deploy that sends real
mail. Chicken-and-egg: the URL only exists after the first apply, so this may
take two passes (apply, read `terraform output service_urls`, set the
variable, re-run CI).

### Not the apply operator's job: the real secret values

Both secrets still hold only the `CHANGE_ME` seed (version 1, 2026-07-17).
The real values come from the Firebase Admin SDK key generated in Part B
step 5, so whoever holds that key runs these, not whoever runs the apply:

```bash
echo -n 'firebase-adminsdk-...@bt-impact-academy.iam.gserviceaccount.com' | \
  gcloud secrets versions add firebase-client-email --data-file=-
# private key: paste the PEM (real newlines) into a temp file, then:
gcloud secrets versions add firebase-private-key --data-file=key.pem && rm key.pem
# Resend API key (from the Resend dashboard):
echo -n 're_...' | gcloud secrets versions add resend-api-key --data-file=-
```

All three secrets are seeded with `CHANGE_ME` by the apply so the first Cloud
Run revision can start. Until the real values are added, Firestore access and
mission emails both fail at runtime.

After that, a push to main auto-deploys staging via
`.github/workflows/deploy-staging.yml`; prod is a manual, approval-gated
promotion via `deploy-prod.yml`.

### Email sending while no domain is verified

`RESEND_FROM_EMAIL` defaults to `onboarding@resend.dev`, Resend's shared
sandbox sender. While that is the from address, Resend rejects every recipient
except the address that owns the API key, so **no learner receives mail**.

To demo end to end before a domain is verified, set the redirect variable
out-of-band (it is a personal address, so it is not committed):

```bash
export TF_VAR_resend_sandbox_recipient='owner@example.com'
terraform apply
```

Every mission email then goes to that one inbox with the intended recipient
prefixed into the subject. Unset it and re-apply once `sapient.rocks` is
verified and `RESEND_FROM_EMAIL` points at it, or learners silently get
nothing.

GitHub settings to flip once (repo Settings):
- Branches -> main -> required status checks: both CI jobs
- Environments -> `production` -> required reviewers: Werner / Gavin

  **Do this BEFORE the first prod run, not after.** `deploy-prod.yml` declares
  `environment: production`, but no GitHub environment exists yet. GitHub
  auto-creates a missing environment on first use, **unprotected**, so the
  approval gate the workflow appears to have would not exist and the first
  promotion would ship straight to prod with no reviewer.

- Decide what `var.github_repository` should be. It currently defaults to
  `HlalanathiMashimbye/4tronix-rover-simulator`, a personal fork. Applying as
  is grants that repo permission to deploy into `bt-impact-academy`. That is
  fine for the pilot and wrong for the long run; an org-owned repo is the
  usual answer. Change it before the apply - it is part of the WIF provider's
  trust condition, so switching later means re-applying the provider.

## Part B: Firebase migration (old project -> bt-impact-academy)

The app moves to Impact's Firebase world. In the Firebase console
(https://console.firebase.google.com), "Add project" -> select the EXISTING
`bt-impact-academy` GCP project, then:

1. **Firestore**: DONE - Werner created the database in `europe-west1`.
   Location is permanent (see the region note below; `africa-south1` IS
   available for Firestore, contrary to what this doc used to say, but an
   existing database cannot be moved). Confirm it is the `(default)` database,
   not a named one: the app passes no database id anywhere, so a named
   database would need code changes.
2. **Authentication**: enable the Email/Password provider (operators only;
   learners never sign in).
3. **Web app**: add one, copy its config. These are the new
   `NEXT_PUBLIC_FIREBASE_*` values for GitHub variables and local `.env`.
4. **Security rules + indexes**: export from the OLD project
   (`firebase firestore:rules:get`, or console copy-paste) and deploy to the
   new one. Commit `firestore.rules` + `firestore.indexes.json` to the repo
   while at it, so rules stop being console-only state.
5. **Admin credentials**: Project settings -> Service accounts -> generate a
   key for the Admin SDK. Its client_email and private_key are what goes into
   Secret Manager (Part A step 5) and into the yard satellite's env.
6. **Operator accounts**: create the operator users in the new project's
   Auth, then grant roles with
   `python yard/satellite/set_operator_claims.py <email> operator`
   (run with the NEW project's env).
7. **Data**: decide migrate vs fresh start. To migrate the missions and
   learners collections: `gcloud firestore export` on the old project to a
   GCS bucket, grant the new project access, `gcloud firestore import`.
   A fresh start is also defensible; the old feed content is the only loss.
8. **Repoint everything**: mission-control `.env`, the yard satellite env,
   and GitHub variables all switch to the new project's values. Nothing else
   changes: the app never hardcodes project identity.

## Notes

- **Regions are deliberately split.** Cloud Run and Artifact Registry are in
  `africa-south1` (Johannesburg); Firestore is in `europe-west1`.

  An earlier version of this note said `africa-south1` is not offered for
  Firestore. That is **false** - `gcloud firestore locations list` includes
  it. The real constraint is that a Firestore database's location is
  immutable, and the prod database already exists in `europe-west1`. Moving it
  would mean deleting and recreating it, which was considered on 2026-08-03
  (the database is still empty, so it would have been nearly free) and
  declined as not worth the churn.

  The split costs less than it sounds like it should, because Cloud Run is not
  in the read path: every page read in mission-control is client-side, so
  browsers reach Firestore directly. Only the API routes pay a cross-continent
  hop, and they are off the render path. Cloud Run being in Johannesburg is
  what learners actually feel, on every page load.

  Changing `var.region` after the first apply is painful (registry and
  services are regional, and location is force-new), so settle it first.
- Terraform deliberately does NOT manage the serving image (lifecycle
  ignore_changes): CD owns which digest runs, Terraform owns everything else.
- Naming: current names are simple (`mission-control-staging` etc.). Werner
  confirmed conventions can be refactored later; `terraform state mv` +
  rename is the path when Impact's conventions arrive.
- Werner's guide item 5 (Terraform plan on PRs touching infra/) needs WIF to
  exist first; add that workflow after Part A proves out.
- GCS bucket names are globally unique: if `bt-impact-academy-tfstate` is
  taken, pick another and change it in both the create command and
  `backend.tf`.
- Deleted Workload Identity pools soft-delete for 30 days. If an apply says
  the pool id `github` already exists in a deleted state, restore it
  (`gcloud iam workload-identity-pools undelete github --location=global`)
  and `terraform import` it rather than renaming.
