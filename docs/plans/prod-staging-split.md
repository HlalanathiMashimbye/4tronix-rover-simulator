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

1. Finish the managed Firestore export. #183 is merged (weekly Cloud Scheduler
   job calling the export API, bucket in europe-west1, 90 day lifecycle, PITR
   and delete protection). #187 is still open with the region follow-ups, and
   the apply has not run yet, so no bucket and no job exist in the project
   today. Phase 0 is not done until the first export lands.
2. Take one export and import it into a throwaway database. An untested backup
   is not a restore point, and nobody has ever run an import back on this
   project.
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
   Artifact Registry, and secrets. No load balancer: staging answers on its
   `*.run.app` URL, on request-based CPU. See "How staging should be
   configured" below.
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

The estimate we have been working off since July is the "full setup (LB + VPC
connector + DNS + builds)" scenario at $25-35/mo, so call it ~$30. We are at
$86.65, about 2.9x that. Line by line:

| Line | Estimated Jul | Actual Sep | Delta |
|---|---|---|---|
| Cloud Run, both services | 4.00 | 67.66 | +63.66 |
| Load balancer | 19.00 | 18.36 | -0.64 |
| VPC connector | 8.50 | 0.00 | -8.50 |
| Cloud DNS | 0.60 | 0.00 | -0.60 |
| Registry, secrets, Firestore | 0.50 | 0.62 | +0.12 |
| **Total** | **32.60** | **86.65** | **+54.05** |

The estimate was good. The load balancer landed within 4% of the guess, and we
never built the VPC connector or the Cloud DNS zone that were budgeted for, so
we run less infrastructure than was priced and still cost nearly three times as
much.

All of the gap is on one line. Both services run `cpu-throttling: false`, so
Cloud Run bills wall-clock instance time rather than request time. Monitoring
shows a mean of 0.68 instances up continuously per service, about 490 billed
hours out of 730. Cloud Run alone overshoots by $63.66, which is more than the
entire $54.05 gap; the infrastructure we never built is quietly refunding about
$9/mo against it.

One detail that matters for the split: the LB charge is the SKU
`Forwarding Rule Minimum Global`, one charge per project covering the first
five forwarding rules. Rules 2 to 5 are free, but a second project starts its
own $18.25 clock.

`mission-control-prod` costs $33.37/mo, 39% of the bill, to serve hello-world.
Nothing pins it up deliberately. Internet background scanning against the bare
IP arrives often enough that the idle window never closes, and the placeholder
answers all of it.

### Projections

After the split, prod is the live yard as it runs today: $53.27/mo, of which
$18.25 is the load balancer serving marsyard.sapient.rocks. Staging is the
variable.

| Scenario | Staging | Total/mo | vs today |
|---|---|---|---|
| Today | | 86.65 | |
| Option 1, config cloned into the new project | 53.16 | 106.43 | +19.79 |
| Option 1, staging keeps a custom hostname | 19.01 | 72.28 | -14.36 |
| Option 1, staging on its run.app URL | 0.76 | 54.03 | -32.61 |
| Option 2, named database in this project | 0.14 | 53.41 | -33.23 |

Hard isolation costs $0.62/mo more than soft, which is a second Artifact
Registry and a second set of secrets. There is no cost argument for Option 2.
Take Option 1; the billing-account association is the open dependency, not the
money.

### How staging should be configured

This is an open-source project. Even with people on it full time now, staging
will sit dormant most of the month, and that fact decides two settings.

Request-based CPU, not always-allocated. A dormant service on always-allocated
CPU bills for wall-clock time whether or not anyone is using it, which is how
the prod placeholder reaches $33/mo while serving nothing. At 2k requests/mo
staging costs $0.14 in compute; at ten times that it is $1.42. The billing mode
matters, the traffic does not.

No load balancer, unless someone wants a hostname enough to pay $18.25/mo for
it. Staging can answer on its default `*.run.app` URL: the folder's
`run.allowedIngress` allow-list includes `all` (verified 2026-09-10), so direct
ingress is permitted. Skipping the LB is most of the difference between the
$19.01 and $0.76 rows, and it also keeps staging off the public IP ranges that
scanners sweep. A public, idle, always-on staging is the worst of the
combinations: we would be paying to keep it warm for bots.

Worth doing on the existing project whether or not we split: put non-prod on
request-based CPU, and reject requests that do not carry a known Host header so
scanners stop holding an instance up. Those two overlap, so do not add the
savings together.

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
- David: `sapient.rocks` ownership for operator Google Sign-in. Also whether
  `marsyard.labs.ws` is retired, which the cost work now argues for: pointing
  it at staging means a load balancer in the new project at $18.25/mo, against
  $0 for the `*.run.app` URL.
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
