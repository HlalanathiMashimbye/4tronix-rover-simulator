output "workload_identity_provider" {
  description = "Full provider resource name for google-github-actions/auth"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deploy_service_account_email" {
  value = google_service_account.deploy.email
}

output "terraform_plan_service_account_email" {
  description = "Read-only identity used by the terraform-plan PR workflow"
  value       = google_service_account.terraform_plan.email
}
