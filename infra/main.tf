# Everything Werner's deploy guide puts in Terraform scope: APIs, Artifact
# Registry, Cloud Run (staging + prod), deploy + runtime service accounts,
# Secret Manager, and the GitHub -> GCP Workload Identity Federation.
#
# Firebase itself (Firestore database, Auth, the web app) is provisioned by
# the Firebase migration workstream (console / firebase CLI), not here.

locals {
  required_apis = [
    "run.googleapis.com",
    "cloudscheduler.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    # External HTTPS load balancer in front of Cloud Run (no allUsers invoker).
    "compute.googleapis.com",
    # Firestore itself is provisioned outside Terraform, but the scheduled
    # export calls its admin API, so the API belongs in the managed set.
    "firestore.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.required_apis)
  service            = each.value
  disable_on_destroy = false
}

module "github_wif" {
  source            = "./modules/github-wif"
  project_id        = var.project_id
  github_repository = var.github_repository
  tfstate_bucket    = var.tfstate_bucket

  depends_on = [google_project_service.apis]
}

module "mission_control" {
  source       = "./modules/mission-control"
  project_id   = var.project_id
  region       = var.region
  environments = var.environments
  domains      = var.domains

  cron_environment  = var.cron_environment
  cron_region       = var.cron_region
  resend_from_email = var.resend_from_email

  deploy_service_account_email = module.github_wif.deploy_service_account_email

  depends_on = [google_project_service.apis]
}

# Weekly Firestore export to GCS. Separate module because it is the only thing
# here that has to follow the database's region rather than the deployment's.
module "firestore_backup" {
  source             = "./modules/firestore-backup"
  project_id         = var.project_id
  region             = var.region
  cron_region        = var.cron_region
  firestore_location = var.firestore_location

  schedule       = var.firestore_backup_schedule
  retention_days = var.firestore_backup_retention_days

  depends_on = [google_project_service.apis]
}
