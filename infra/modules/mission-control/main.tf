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
resource "google_secret_manager_secret_version" "seed" {
  for_each = {
    resend_api_key = google_secret_manager_secret.resend_api_key.id
  }
  secret      = each.value
  secret_data = "CHANGE_ME-set-real-value-via-gcloud-secrets-versions-add"
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
  secrets = {
    RESEND_API_KEY = google_secret_manager_secret.resend_api_key
  }

  # Non-secret runtime config. RESEND_SANDBOX_RECIPIENT is only emitted when
  # set: while it has a value, every mission email is redirected to that one
  # inbox and no learner receives mail, so it must stay unset in prod once a
  # sending domain is verified.
  plain_env = merge(
    {
      FIREBASE_PROJECT_ID = var.project_id
      RESEND_FROM_EMAIL   = var.resend_from_email
    },
    var.resend_sandbox_recipient == "" ? {} : {
      RESEND_SANDBOX_RECIPIENT = var.resend_sandbox_recipient
    },
  )
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
