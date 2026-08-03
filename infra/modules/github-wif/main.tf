# GitHub Actions -> GCP without long-lived keys: an OIDC Workload Identity
# pool restricted to this one repository, impersonating a deploy service
# account whose only powers are push-image and update-Cloud-Run.

resource "google_service_account" "deploy" {
  account_id   = "mission-control-deploy"
  display_name = "Mission Control CI deploy (GitHub Actions via WIF)"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  # Only workflows from OUR repo can assume the deploy identity.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_impersonation" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# --- Terraform plan identity (read-only) ----------------------------------
# Werner's deploy guide item 5: run `terraform plan` on PRs touching infra/.
#
# This is deliberately a SECOND service account. The deploy SA above holds
# only push-image and update-Cloud-Run, which is nowhere near enough to
# refresh state across every resource in this config, and widening it would
# hand CD permissions it has no business having. Planning is read-only work,
# so it gets a read-only identity.

resource "google_service_account" "terraform_plan" {
  account_id   = "terraform-plan"
  display_name = "Terraform plan on PRs (GitHub Actions via WIF): read-only"
}

resource "google_project_iam_member" "terraform_plan_viewer" {
  project = var.project_id
  role    = "roles/viewer"
  member  = "serviceAccount:${google_service_account.terraform_plan.email}"
}

# roles/viewer does not cover getIamPolicy on every resource type, and a
# refresh reads the IAM bindings this config manages. securityReviewer is
# read-only and closes that gap without granting any mutation.
resource "google_project_iam_member" "terraform_plan_iam_reader" {
  project = var.project_id
  role    = "roles/iam.securityReviewer"
  member  = "serviceAccount:${google_service_account.terraform_plan.email}"
}

# Remote state lives in a hand-made bucket (README step 2), so it is
# referenced by name rather than managed here.
#
# objectAdmin rather than objectViewer is deliberate: Terraform takes a state
# LOCK during plan, which writes and then deletes a .tflock object. Running
# with -lock=false would allow objectViewer, but an unlocked plan can read
# torn state while someone else is mid-apply, and reporting a wrong plan on a
# PR is worse than the narrow write. Scope stays one bucket.
resource "google_storage_bucket_iam_member" "terraform_plan_state" {
  bucket = var.tfstate_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.terraform_plan.email}"
}

resource "google_service_account_iam_member" "github_impersonation_plan" {
  service_account_id = google_service_account.terraform_plan.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
