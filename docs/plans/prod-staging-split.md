# Mission Control: prod / staging split plan

Status: proposed
Owner: Werner
Raised: standup 2026-09-10 (Hlali asked for a prod push so staging could be
used for feature exploration)
Live state verified against `bt-impact-academy`: 2026-09-10

## Where we actually are

The naming is inverted. The environment called staging is production, and the
hostname that sends learner email points at a placeholder.

| Thing | Today |
|---|---|
| GCP project | one, `bt-impact-academy` |
| Firestore | one database, `(default)`, `europe-west1` (location immutable) |
| `mission-control-staging` | the live platform. Real learner missions, emails, videos. Serves `marsyard.labs.ws` |
| `mission-control-prod` | exists, but serves `us-docker.pkg.dev/cloudrun/container/hello` on `marsyard.sapient.rocks` |
| Firestore access | both services get `FIREBASE_PROJECT_ID=bt-impact-academy` and the app calls `getFirestore()` with no database id, so both front doors resolve to the same `(default)` database |
| Secrets | project-level, shared by both envs: `resend-api-key`, `resend-from-email`, `youtube-api-key`, `youtube-channel-id`, `youtube-link-interval-minutes`, `cron-secret` |
| Firebase Auth | one user pool per project, so operator accounts are shared |
| Scheduler | `cron_environment = "staging"`, so YouTube auto-link posts to `marsyard.labs.ws` |
| CD | push to `main` deploys staging. `deploy-prod.yml` promotes staging's digest, gated by a GitHub `production` environment that does not exist yet, so the first run would create it unprotected and ship with no reviewer |

## What we are not going to do

Do not migrate the live learner data. It already sits in `(default)` in the
project that is meant to be prod. Exporting it into a new prod database buys a
cutover window, a schema-fidelity risk, and re-created operator accounts, and
returns nothing.

Promote in place instead, and build the environment that does not exist yet
(staging) as the new thing.

## Decision needed first: where staging lives

### Option 1: second GCP project (recommended)

New project, e.g. `bt-impact-academy-stage`, with its own Firestore, Auth pool,
buckets, secrets, and PostHog key.

We can do most of this ourselves. Verified 2026-09-10:

- Creating a project in the academy folder is already our permission, so we do
  not have to queue behind DevOps for it.
- The `run.allowedIngress` allow-list (`internal-and-cloud-load-balancing`
  plus `all`) is set on the folder, not on the project, so a new project
  created in it inherits the exemption. The August policy fight does not
  repeat.
- Only one project exists in the folder today, `bt-impact-academy`. There is
  no pre-created stage project waiting for us.

Against it:

- Doubles the WIF / CD wiring and the Terraform targets.
- Remaining dependency: attaching the billing account. That is a separate
  permission we should confirm with Gavin rather than assume.

For it:

- A hard boundary. A student experimenting in staging cannot reach prod data.

### Option 2: named Firestore database in the same project (interim only)

Add a `staging` database and teach the app a `FIREBASE_DATABASE_ID` env var.
`getFirestore()` is hardcoded to the default database today, so this is a code
change, not just config.

- Cheaper, faster, no new project.
- The boundary is soft. Both runtime service accounts hold
  `roles/datastore.user` at project level, which covers every database in the
  project, and the Auth pool stays shared. That is a convention, not a control.

Target Option 1. Take Option 2 only if the billing association drags and the
students are blocked, and say out loud that it is not isolation.

## Phase 0: protect what is live, before touching environments

1. Land the managed Firestore export work: scheduled `gcloud firestore export`
   into a GCS bucket with a lifecycle policy. Retire the custom JSON walker; it
   loses type fidelity (timestamps become strings, references become maps) and
   writes into a personal Drive with no retention.
2. Take one manual export and import it into a throwaway database. An untested
   backup is not a restore point.
3. Create the GitHub `production` environment with required reviewers before
   any prod deploy.
4. Freeze DNS moves and `cron_environment` changes until 1 to 3 are done.

## Phase 1: make the live thing prod, with no data move

Both services already resolve to the same database, so prod can come up
alongside staging on the same data and be verified before traffic moves.

1. Promote the digest currently serving on staging to `mission-control-prod`
   via `deploy-prod.yml`, once the environment gate exists. Same bytes, already
   smoke-checked.
2. Verify `marsyard.sapient.rocks` end to end: operator sign-in, mission
   submit, email link, YouTube attach. `appUrl.ts` prefers the runtime
   `APP_URL` over the build-time `NEXT_PUBLIC_APP_URL`, and Terraform sets
   `APP_URL` per environment, so a promoted image should render prod links.
   Confirm it rather than assume it.
3. Move `cron_environment` to `prod` in `impact.tfvars`. Only one environment
   may run the YouTube schedule while they share a Firestore.
4. Tell David and the Science Centre that the live URL is
   `marsyard.sapient.rocks`. Keep `marsyard.labs.ws` answering until Phase 2
   puts a real staging behind it, or redirect it to prod for a period. David's
   call.
5. Operator Google Sign-in needs David: the GCP project does not own
   `sapient.rocks`, so the OAuth consent and domain setup sits with him.

## Phase 2: build a real staging (Option 1)

1. Create `bt-impact-academy-stage` in the academy folder. Ingress policy is
   inherited from the folder. Only the billing association may need Gavin.
2. Parameterise the Terraform for a second target: one module, two var-files
   (`impact.tfvars`, `impact-stage.tfvars`) and separate state prefixes. Do not
   copy the module.
3. Stand up its own Firestore, Auth (Email/Password plus operator accounts),
   Artifact Registry, secrets, and an LB with a staging hostname.
4. Deploy `firestore.rules` and `firestore.indexes.json` to the new database
   from the repo, not the console.
5. Point the staging CD workflow at the new project. Push to `main` deploys
   stage; prod stays a gated promotion.
6. Seed staging with synthetic missions, not a copy of learner data. If a
   realistic dataset is wanted, restore an export and scrub the email
   addresses. Children's addresses should not sit in an environment we
   experiment in.
7. Separate the outbound side: a distinct PostHog project/key, and either a
   staging Resend from-address or `RESEND_SANDBOX_RECIPIENT` set, so staging
   cannot email a real learner.

## Phase 3: make the split hold

1. Badge non-prod loudly in the UI. `APP_ENV` already exists for this.
2. Document the promotion path in `infra/README.md`: `main` to stage
   automatically, prod by approved promotion of a verified digest. Rollback is
   the same workflow against the previous digest.
3. Add a per-environment smoke check that asserts operator sign-in works. The
   old staging check asserted `/operator` returned 404, which is why broken
   sign-in went unnoticed.
4. Review project-level IAM before prod carries learner data at scale. The
   roles we hand out today are broader than they should be on a prod project
   once a real staging exists to absorb the experimenting.

## Cost

A second project does not double the baseline. We already pay for two Cloud Run
services, and one of them serves a placeholder.

Measured over the 30 days to 2026-09-10. No billing export is reachable on this
project, so this is Cloud Monitoring usage priced against the Cloud Billing
Catalog API at `africa-south1` list rates. Real usage, real prices, our
multiplication, not an invoice.

| Line | Measured | USD/mo |
|---|---|---|
| Cloud Run `mission-control-staging` | 501.4 instance-hours | 34.29 |
| Cloud Run `mission-control-prod` (placeholder) | 487.9 instance-hours | 33.37 |
| LB forwarding rules (4 global, one minimum charge) | 730 h | 18.25 |
| Secret Manager, Artifact Registry, LB data | | 0.73 |
| Firestore | 1,465 reads/day, 83 writes/day | 0.00 (free tier) |
| **Total** | | **86.65** (~R1,560) |

That is ~14x the $1-6/mo we estimated in July. Two causes:

1. We built the HTTPS load balancer that estimate assumed we would skip. It is
   $18.25/mo, and the SKU is `Forwarding Rule Minimum Global`, one charge per
   project covering the first five rules. So rules 2 to 5 are free, but a
   second project starts its own clock.
2. Both services run `cpu-throttling: false`, so Cloud Run bills wall-clock
   instance time rather than request time. Monitoring shows a mean of 0.68
   instances up continuously per service, about 490 billed hours out of 730.

`mission-control-prod` costs $33.37/mo, 39% of the bill, to serve hello-world.
Nothing pins it up deliberately. Internet background scanning against the bare
IP arrives often enough that the idle window never closes, and the placeholder
answers all of it.

Projections:

| Scenario | USD/mo | vs today |
|---|---|---|
| Today | 86.65 | |
| Option 1, config cloned into the new project | 106.44 | +19.79 |
| Option 1, staging on request-based CPU | 73.56 | -13.08 |
| Option 2, named database in this project | 54.69 | -31.95 |

Cost is not a reason to prefer Option 2. Take Option 1; the billing-account
association is the open dependency, not the money.

Worth doing whether or not we split: put non-prod on request-based CPU, and
reject requests that do not carry a known Host header so scanners stop holding
an instance up. Those two overlap, so do not add the savings together.

Assumptions worth challenging: list prices only, so any org-level committed-use
discount pulls the real figure down. Cloud Run free tier ignored, because it is
a per-billing-account allowance on a shared account and does not apply to
instance-based billing anyway. Staging traffic in the tuned scenarios assumed
at 20k requests/mo of our own use; if staging ends up publicly reachable and
scanned the way prod is, it drifts back toward the cloned-config row.

## Open questions

- Gavin: the billing association for a new project in the academy folder, plus
  the automated provisioning function he offered. Project creation and the
  ingress policy are already ours.
- David: `sapient.rocks` ownership for operator Google Sign-in, and whether
  `marsyard.labs.ws` becomes staging's hostname or is retired.
- Scope: do we need a personal sandbox each, or is one shared staging enough?

## Not a cost issue, but it fell out of the same data

The live service answers at 2,807 ms p50 and 3,385 ms p95. The placeholder
beside it answers in 5 ms, so that is the application, not the platform.
Children on school wifi are waiting nearly three seconds for every page. Worth
a ticket separate from any of this.

## Related

- `infra/README.md` for how to run Terraform against this project
- #181, which requires `-var-file=impact.tfvars` for Impact plan and apply
- #183, the weekly Firestore export that Phase 0 depends on
