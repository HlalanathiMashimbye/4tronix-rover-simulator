# Mission Control hosting: Artifact Registry, Secret Manager, per-environment
# runtime service accounts and Cloud Run services, and least-privilege IAM.
#
# Terraform owns the SHAPE of the services; the deploy workflow owns WHICH
# image digest is serving (lifecycle.ignore_changes on the image), so a
# terraform apply never fights CD.

# --- Image registry -------------------------------------------------------

resource "google_artifact_registry_repository" "mission_control" {
  repository_id = "mission-control"
  format        = "DOCKER"
  location      = var.region
  description   = "Mission Control images, one tag per git SHA"
}

# --- Server secrets (values set out-of-band, never in Terraform) ----------

# Resend sends the learner mission-status emails. Without this the app throws
# on every status change (visible as `[mission-email] FAILED` in the logs).
resource "google_secret_manager_secret" "resend_api_key" {
  secret_id = "resend-api-key"
  replication {
    auto {}
  }
}

# Bootstrap seed: Cloud Run mounts these at version "latest", and a secret
# with zero versions makes the very first revision fail to start. The seed
# lets the initial apply succeed; the REAL values are added out-of-band
# afterwards (README step 5) and become the new "latest". The placeholder
# hello image never reads them.
# The YouTube channel the auto-linker reads. Real values are added
# out-of-band like Resend's; a poll with either unset simply does not link.
resource "google_secret_manager_secret" "resend_from_email" {
  secret_id = "resend-from-email"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "youtube_link_interval" {
  secret_id = "youtube-link-interval-minutes"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "youtube_api_key" {
  secret_id = "youtube-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "youtube_channel_id" {
  secret_id = "youtube-channel-id"
  replication {
    auto {}
  }
}

# The shared secret Cloud Scheduler presents to /api/cron/youtube-link.
#
# GENERATED, not seeded with a placeholder. Both sides of this are Terraform's
# to write, so there is nobody to hand a real value to afterwards, and a
# CHANGE_ME here would not be a config gap: it would be a working password
# that is the same string in every repo that copied this file. Rotate by
# tainting this resource.
resource "random_password" "cron_secret" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "cron_secret" {
  secret_id = "cron-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "cron_secret" {
  secret      = google_secret_manager_secret.cron_secret.id
  secret_data = random_password.cron_secret.result
}

resource "google_secret_manager_secret_version" "seed" {
  # Empty, not CHANGE_ME. readSetting treats an empty version as unset, which
  # is what the settings page then shows as "Not set" and what the code's own
  # not-configured paths already handle. A CHANGE_ME string would instead be a
  # live, wrong value: an API key that fails every call and a from-address
  # that bounces every email.
  # ONLY THE ONES WITH A REAL VALUE. Secret Manager refuses an empty payload
  # ("3 INVALID_ARGUMENT: Secret Payload cannot be empty"), so an unset
  # setting is a secret with no versions at all, which readSetting already
  # reads as null. Seeding these empty would have failed the apply itself.
  #
  # resend_from_email carries the address that is live today, so moving
  # Resend's config to the settings page does not silently stop email. After
  # this first version the page owns it: Terraform writes another only if the
  # tfvar changes.
  for_each = {
    resend_from_email     = { id = google_secret_manager_secret.resend_from_email.id, data = var.resend_from_email }
    youtube_link_interval = { id = google_secret_manager_secret.youtube_link_interval.id, data = "15" }
  }
  secret      = each.value.id
  secret_data = each.value.data
}

locals {
  # No Firebase credential is mounted at all. The service runs as its own
  # runtime service account, which already holds roles/datastore.user in the
  # project Firestore lives in, so there is nothing to store or rotate.
  #
  # firebase-admin.ts now REFUSES to start when FIREBASE_CLIENT_EMAIL or
  # FIREBASE_PRIVATE_KEY is set, so mounting either would break the revision
  # rather than change its identity. That is why the secrets are gone from
  # here entirely instead of being left mounted and unused: the CHANGE_ME seed
  # they carried would have been a junk key the app then rejected on boot.
  #
  # Resend is unrelated to how Firestore is authenticated: a third-party API
  # key with no ADC equivalent, so it stays.
  # ONLY CRON_SECRET IS MOUNTED. The rest are read from Secret Manager at
  # request time so the admin settings page can change them without a deploy.
  #
  # Mounting them would defeat that twice over: Cloud Run resolves a secret env
  # var when an INSTANCE STARTS, so a new version reaches new instances and not
  # running ones, and runtimeSettingsStore prefers the environment when it is
  # set, so a mounted value would win over the live read forever.
  #
  # CRON_SECRET stays because Terraform generates it and no human edits it.
  secrets = {
    CRON_SECRET = google_secret_manager_secret.cron_secret
  }

  # Read at request time, written by the settings page. Listed separately so
  # the runtime account still gets accessor and adder on each of them.
  editable_secrets = {
    resend_api_key        = google_secret_manager_secret.resend_api_key
    resend_from_email     = google_secret_manager_secret.resend_from_email
    youtube_api_key       = google_secret_manager_secret.youtube_api_key
    youtube_channel_id    = google_secret_manager_secret.youtube_channel_id
    youtube_link_interval = google_secret_manager_secret.youtube_link_interval
  }

  # Non-secret runtime config. RESEND_SANDBOX_RECIPIENT is only emitted when
  # set: while it has a value, every mission email is redirected to that one
  # inbox and no learner receives mail, so it must stay unset in prod once a
  # sending domain is verified.
  # RESEND_FROM_EMAIL and RESEND_SANDBOX_RECIPIENT moved out of here: they are
  # settings-page values now, so a tfvar setting them would silently win over
  # anything an admin changed.
  plain_env = {
    FIREBASE_PROJECT_ID = var.project_id
  }
}

# --- Per-environment runtime identity + service ---------------------------

resource "google_service_account" "runtime" {
  for_each     = var.environments
  account_id   = "mission-control-${each.key}"
  display_name = "Mission Control runtime (${each.key}): Firestore, secrets, operator auth"
}

resource "google_project_iam_member" "runtime_firestore" {
  for_each = var.environments
  project  = var.project_id
  role     = "roles/datastore.user"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

# --- Operator authentication ---------------------------------------------
#
# This identity was "Firestore + secrets only", which was accurate when it was
# written. Operator sign-in shipped afterwards (AB#341/342) and needs the
# Firebase Auth admin API, which was never granted, so operator login has
# never worked on a deployed environment. It failed as a bare 401 from
# /api/auth/session: the token is valid, and the server cannot look up the
# account to finish checking it.
#
# It went unnoticed because the staging smoke check asserted that /operator
# returned 404, so nothing ever exercised sign-in there until that check was
# corrected.
#
# This matters here rather than only locally because there is no mounted key
# any more: the Admin SDK authenticates as THIS service account, so its roles
# are what decide whether verifyIdToken can complete.
#
# WHY THE PREDEFINED ROLE AND NOT A NARROWER CUSTOM ONE.
#
# A custom role with just users.get, users.createSession and users.update
# would be tighter, and it was the first thing written here. It is the wrong
# trade for this project. The failure mode of a hand-listed permission set is
# that some later Admin SDK call needs a permission nobody predicted, and it
# surfaces as an unexplained 401 on login - which is exactly the bug this
# commit exists to fix, and it took a token-by-token comparison against a
# working environment to find. Getting that list right was already close: the
# separate users.createSession permission is easy to miss, and missing it
# breaks sign-in one step later than the obvious read.
#
# It also cuts against how this project is meant to be handed over. Werner and
# David have both been clear about preferring stock configuration, Werner's
# team reviews this Terraform, and a predefined role is one they can recognise
# without reading a permission list. Creating a project custom role also needs
# iam.roles.create, which the apply operator may not hold.
#
# The privilege this concedes is that the service could delete an account
# rather than only read and update one. It is already trusted to mint session
# cookies and set the role claim, so that is a small step, and it is worth
# paying for a configuration that fails loudly and reads plainly.
resource "google_project_iam_member" "runtime_firebase_auth" {
  for_each = var.environments
  project  = var.project_id
  role     = "roles/firebaseauth.admin"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_secret_access" {
  for_each = {
    for pair in setproduct(keys(var.environments), keys(local.secrets)) :
    "${pair[0]}-${pair[1]}" => { env = pair[0], secret = pair[1] }
  }
  secret_id = local.secrets[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.env].email}"
}

# The settings-page values: read on every request, so accessor...
resource "google_secret_manager_secret_iam_member" "runtime_editable_access" {
  for_each = {
    for pair in setproduct(keys(var.environments), keys(local.editable_secrets)) :
    "${pair[0]}-${pair[1]}" => { env = pair[0], secret = pair[1] }
  }
  secret_id = local.editable_secrets[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.env].email}"
}

# ...and adder, so an admin saving one creates a new version.
#
# secretVersionAdder, NOT secretmanager.admin. The service may supersede a
# value and may not destroy a secret, disable a version, or change who can
# read it. Rolling back a bad change stays a deliberate act with a real
# identity behind it, and an app compromise cannot delete the credentials.
resource "google_secret_manager_secret_iam_member" "runtime_editable_write" {
  for_each = {
    for pair in setproduct(keys(var.environments), keys(local.editable_secrets)) :
    "${pair[0]}-${pair[1]}" => { env = pair[0], secret = pair[1] }
  }
  secret_id = local.editable_secrets[each.value.secret].id
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${google_service_account.runtime[each.value.env].email}"
}

resource "google_cloud_run_v2_service" "mission_control" {
  for_each = var.environments

  name     = "mission-control-${each.key}"
  location = var.region
  # Only the load balancer may reach the service. Requires the folder
  # run.allowedIngress allow-list to include internal-and-cloud-load-balancing
  # (Gavin's folder currently allows only `all` — ask him to add this value).
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  # Domain-restricted sharing blocks allUsers, and the Application LB service
  # agent (gcp-sa-l7xlb) is not minted in this project. Google's documented
  # escape hatch: disable the invoker IAM check and rely on ingress to keep
  # *.run.app closed. See cloud.google.com/run/docs/securing/managing-access
  # ("Disable the Cloud Run Invoker IAM check").
  invoker_iam_disabled = true

  template {
    service_account = google_service_account.runtime[each.key].email

    scaling {
      min_instance_count = each.value.min_instances
      max_instance_count = each.value.max_instances
    }

    containers {
      # Placeholder until the first CD deploy; ignore_changes below hands
      # image ownership to the deploy workflow after that.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      dynamic "env" {
        # APP_ENV names the environment ("staging" / "prod") so the app can
        # badge anything that is not production. An operator signing in to
        # dispatch a real rover must never be unsure which environment they are
        # looking at. Runtime rather than NEXT_PUBLIC_ for the same reason as
        # APP_URL: prod promotes the image built during the staging deploy, so
        # a build-time value would label prod as staging.
        for_each = merge(local.plain_env, {
          APP_URL = local.app_urls[each.key]
          APP_ENV = each.key
        })
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  # Prod cannot be deleted by a stray destroy; staging can be torn down.
  deletion_protection = each.key == "prod"

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.runtime_secret_access,
    google_secret_manager_secret_version.seed,
  ]
}

# --- Deploy service account powers (push image, roll services) ------------
# Scoped to exactly our registry repo and our two services, nothing wider
# (Werner's principle 5: least privilege).

resource "google_artifact_registry_repository_iam_member" "deploy_ar_writer" {
  repository = google_artifact_registry_repository.mission_control.name
  location   = var.region
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${var.deploy_service_account_email}"
}

resource "google_cloud_run_v2_service_iam_member" "deploy_run_developer" {
  for_each = var.environments
  name     = google_cloud_run_v2_service.mission_control[each.key].name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${var.deploy_service_account_email}"
}

# Deploying a revision requires acting as the service's runtime identity.
resource "google_service_account_iam_member" "deploy_acts_as_runtime" {
  for_each           = var.environments
  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deploy_service_account_email}"
}

# --- YouTube auto-link schedule -------------------------------------------
#
# EXACTLY ONE ENVIRONMENT MAY RUN THIS. Staging and prod are both pointed at
# the same project, so they share one Firestore: two schedulers would race to
# attach the same video to the same run and double every write for nothing.
# var.cron_environment names the one that does, and defaults to none, so the
# unsafe state is the one you have to ask for.
resource "google_cloud_scheduler_job" "youtube_link" {
  for_each = var.cron_environment == "" ? {} : { (var.cron_environment) = true }

  name        = "youtube-link-${each.key}"
  description = "Attach uploaded videos to the runs they show, by MissionID in the description."
  region      = var.region
  schedule    = var.cron_schedule
  time_zone   = "Africa/Johannesburg"

  # A poll that finds nothing costs one YouTube quota unit and no Firestore
  # reads, so frequency is about how long a child waits, not about cost.
  http_target {
    http_method = "POST"
    uri         = "${local.app_urls[each.key]}/api/cron/youtube-link"

    headers = {
      "Content-Type"  = "application/json"
      "x-cron-secret" = random_password.cron_secret.result
    }
  }

  retry_config {
    retry_count = 1
  }

  depends_on = [google_cloud_run_v2_service.mission_control]
}
