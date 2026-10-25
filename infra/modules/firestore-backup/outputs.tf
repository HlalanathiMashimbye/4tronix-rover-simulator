output "bucket" {
  description = "Bucket the exports are written to. Restore reads from here."
  value       = google_storage_bucket.exports.name
}

output "service_account_email" {
  description = "Identity Cloud Scheduler presents when it starts the export."
  value       = google_service_account.exporter.email
}

output "job_names" {
  description = "Cloud Scheduler job per database. Run one by hand with: gcloud scheduler jobs run <name> --location=<region>"
  value       = { for database, job in google_cloud_scheduler_job.export : database => job.name }
}
