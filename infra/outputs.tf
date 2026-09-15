# These outputs are exactly the GitHub Actions *variables* the deploy
# workflows read (see .github/workflows/deploy-staging.yml header).
# After `terraform apply`, copy them into GitHub:
# Settings -> Secrets and variables -> Actions -> Variables.

output "GCP_WIF_PROVIDER" {
  value = module.github_wif.workload_identity_provider
}

output "GCP_DEPLOY_SA" {
  value = module.github_wif.deploy_service_account_email
}

output "GCP_TF_PLAN_SA" {
  value = module.github_wif.terraform_plan_service_account_email
}

output "GCP_PROJECT_ID" {
  value = var.project_id
}

output "GCP_REGION" {
  value = var.region
}

output "GCP_AR_REPO" {
  value = module.mission_control.artifact_registry_repo
}

output "STAGING_SERVICE" {
  value = module.mission_control.service_names["staging"]
}

output "PROD_SERVICE" {
  value = module.mission_control.service_names["prod"]
}

# Public learner URLs (load balancer), NOT the Cloud Run *.run.app URIs.
# *.run.app stays closed (no allUsers); set NEXT_PUBLIC_APP_URL from these.
output "service_urls" {
  value = module.mission_control.service_urls
}

output "lb_ip_addresses" {
  value = module.mission_control.lb_ip_addresses
}

# Not a GitHub variable. Where the weekly Firestore export lands, and the job
# to run by hand when you want a copy before doing something destructive.
output "firestore_backup" {
  value = {
    bucket          = module.firestore_backup.bucket
    scheduler_job   = module.firestore_backup.job_name
    service_account = module.firestore_backup.service_account_email
  }
}
