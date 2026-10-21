# Going live on marsyard.sapient.rocks

Mission Control's live site moves from `marsyard.labs.ws` (the service called
staging, which has been serving learners) to `marsyard.sapient.rocks` (the
service called prod, which has served Google's placeholder page since August).

Prod starts **clean, on a database of its own**. David's call on 12 October
2026: nothing carries over except missions he picks. Staging keeps the
`(default)` database, with every mission since the pilot, test runs included,
and becomes what its name says.

Why a second database and not a second project: a project needs a billing
association (Gavin), its own load balancer ($18.25/mo), a certificate, a DNS
change at GoDaddy (David) and every operator account made again. A database
in the same project needs none of them. Operator roles are custom claims on
Firebase Auth users, and Auth belongs to the project, so every operator can
sign in to prod on day one. The objection to one project, that both services
can reach every database in it (docs/plans/prod-staging-split.md on #186), is
answered by an IAM condition: prod's service account may reach only `prod`.

## What only Werner can do

Three things, all from a laptop:

1. **Review and approve the PR.** Terraform is not merged without his approval.
2. **Run `terraform apply`.** It creates the `prod` database, which the team's
   accounts cannot (`datastore.databases.create`), and changes IAM, which they
   cannot either (`secretmanager.secrets.setIamPolicy`).
3. **Approve the "Deploy prod" run** in GitHub, as a reviewer on the
   `production` environment.

Everything else the team's accounts can already do, checked on 22 October:
deploy rules and indexes, write documents, update Cloud Run and the schedules.
`marsyard.sapient.rocks` is already on Firebase Auth's authorized domains, so
operator sign-in needs nothing from David.

## Before the sitting

- [ ] **David** sends the ids of the missions to keep. The id is the last part
      of a mission's address: `.../missions/zippy-peak-scanner-rc6LJe` is
      mission `rc6LJehZ3ehLDfM6Fh5MU`; the operator console shows the full id.
      Prod can go live with none and have them copied in later.
- [ ] **Hlali** creates the GitHub `production` environment (Settings,
      Environments, New environment), with required reviewers Hlali and
      Werner and deployments limited to `main`. `deploy-prod.yml` waits on it;
      without it the first run would create it unprotected.
- [ ] **Werner** reads the `terraform-plan` comment on the PR. It should match
      the summary below.

## What the apply changes

From a read-only plan against the live project on 22 October 2026:
**3 to import, 33 to add, 5 to change, 2 to destroy.**

| What | Why |
|---|---|
| New Firestore database `prod`, europe-west1, Standard, point-in-time recovery and delete protection on | Prod's clean start. Same location as `(default)`, so it shares the export bucket |
| A weekly export of `prod` into the same bucket, under `prod/` | Backed up from the apply that creates it. The `(default)` job keeps its name; only its description changes |
| Both services: `cpu_idle = true`, `startup_cpu_boost = true` | PR #240: always-on CPU was a provider default nobody chose, about $63/mo of the $87 |
| Both services: `FIREBASE_DATABASE_ID` (`prod`, `(default)`) | The app reads its database at runtime, because prod runs the image built for staging |
| Prod's `roles/datastore.user` replaced by the same role on `prod` only | Staging cannot be reached from prod's identity. Created before the old one is removed |
| Port 80 redirects to HTTPS on both domains | It served the whole app over plain HTTP, learner email addresses included |
| YouTube auto-link schedule moves from staging to prod | One channel, one schedule |
| Six YouTube upload secrets and their IAM, three of them imported | From #304/#319, merged but never applied. Three were made by hand on 11 Oct; `infra/imports.tf` takes them into state so the apply does not fail on "already exists". Automatic upload stays off: two of its settings have no value yet |

Nothing is destroyed that holds data. The two destroys are staging's YouTube
schedule (recreated as prod's) and prod's unconditioned Firestore grant
(replaced by the conditioned one).

## The sitting, in order

About 45 minutes. **The order matters at step 3**: `firebase deploy` creates a
missing named database by itself, even with `--dry-run`, with none of
Terraform's settings, and the apply then fails on "already exists".
`scripts/deploy-firestore.sh` refuses to run until the database exists.

1. **Werner approves the PR; Hlali merges it.** Staging redeploys with the
   new image, still on `(default)`. Wait for "Deploy staging" to go green.

2. **Werner applies**, from `infra/` on `main`:

   ```bash
   gcloud auth application-default login
   terraform init -reconfigure \
     -backend-config="bucket=bt-impact-academy-tfstate" \
     -backend-config="prefix=mission-control"
   terraform plan -var-file=impact.tfvars
   terraform apply -var-file=impact.tfvars
   ```

   Always `-var-file=impact.tfvars`: without it the plan destroys both
   certificates and the HTTPS listeners. Check the plan says 3 / 33 / 5 / 2
   before typing `yes`.

3. **Hlali deploys rules and indexes** to both databases:

   ```bash
   scripts/deploy-firestore.sh
   ```

4. **Hlali copies what prod starts with**: David's missions, the yard record
   and the operator profiles. Learner records and email addresses are not
   copied.

   ```bash
   cd mission-control
   gcloud auth application-default login
   export FIREBASE_PROJECT_ID=bt-impact-academy
   node scripts/copy-to-database.mjs --missions <ids from David>          # dry run
   node scripts/copy-to-database.mjs --missions <ids from David> --apply
   ```

   With no missions picked, run it with `--missions ""` so the yard and the
   operators still go across.

5. **Hlali runs "Deploy prod"** (Actions, Deploy prod, Run workflow) and
   **Werner approves it.** It refuses to promote unless prod's service names
   its own database, then promotes the digest serving on staging, and its
   smoke check fails unless the pages point the browser at `prod`.

6. **Check prod by hand** on <https://marsyard.sapient.rocks>:
   - [ ] No staging banner, and the feed shows only David's missions.
   - [ ] `http://marsyard.sapient.rocks` lands on `https://`.
   - [ ] An operator signs in (Google and email) and the queue loads. This is
         the server reading `prod` through the new IAM condition; nothing
         anonymous exercises it.
   - [ ] A mission sent from prod's console reaches the yard.

7. **Point the yard at prod.** On the satellite, `git pull` and restart
   `satellite-web` (yard/docs/satellite.md). Its Settings page, the link
   button beside the power button, now says `marsyard.sapient.rocks`. The
   address is a setting there from now on, not a file.

8. **Tell David and the Science Centre** the live address.

## If it goes wrong

Learners are on `marsyard.labs.ws` until step 8, so nothing in steps 1 to 7
is in front of them.

- **The apply fails part-way.** Fix and re-run it; every resource is
  idempotent. A half-made database is not possible: creation is one call.
- **Prod's queue will not load (step 6).** Most likely the IAM condition. Its
  logs say `PERMISSION_DENIED`. Werner can remove the `condition` block for
  prod in `infra/modules/mission-control/main.tf` and apply; that restores the
  project-wide grant prod had before.
- **YouTube videos stop linking on staging.** Expected: the schedule moved to
  prod. Set `cron_environment = "staging"` and apply to move it back.

## After go-live

Not needed to go live, and each is its own change:

- **Limit staging's service account to `(default)`**, the same condition prod
  got. Left out of this change because staging is the live site until step 8,
  and a mistake in the expression would take the yard down mid-apply. Prod
  proves the expression first.
- **Staging still holds real learners' email addresses**, in `(default)`, and
  can still send them mail. Redact them, or give staging a sandbox recipient,
  before anyone experiments there (docs/plans/prod-staging-split.md, Phase 2.6).
- **Test a restore of prod's first export**, after its first Sunday:
  `gcloud firestore import --database=<scratch> gs://bt-impact-academy-firestore-backup/prod/<export>`.
  Werner's Phase 0.2, moved to the database that now matters.
- **Delete `infra/imports.tf`**; after one apply it does nothing.
- **A `Strict-Transport-Security` header**, now that port 80 only redirects.
- **A PostHog project per environment**, so prod's numbers are not mixed with
  staging's.
- **The four `secretAccessor` bindings** removed from state in August still
  exist in GCP and grant access to secrets nothing mounts. Werner can delete
  them.

## What it costs

A named database gets no free tier: only one database per project does, and
`(default)` has it. At prod's current traffic, about 1,500 reads and 80 writes
a day, that is a few cents a month. Point-in-time recovery and the weekly
export are billed per GB stored, also cents at this size. The CPU change
should take the bill from about $87 to about $20 a month; Cloud Monitoring
shows the real figure within a few days of the apply.
