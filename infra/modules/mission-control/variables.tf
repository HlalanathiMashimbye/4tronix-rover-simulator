variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "cron_region" {
  description = "Region for the Cloud Scheduler job. Not var.region: Cloud Scheduler does not exist in every Cloud Run region, africa-south1 included."
  type        = string
}

variable "environments" {
  description = "Cloud Run environments. firestore_database is the database each one reads and writes; see the root variable."
  type = map(object({
    min_instances      = number
    max_instances      = number
    firestore_database = optional(string, "(default)")
  }))
}

variable "firestore_location" {
  description = "Where a database this module creates is put. The location of the existing (default) database, so the weekly export can use the same bucket: a managed export refuses a bucket that is not near the database."
  type        = string
}

variable "deploy_service_account_email" {
  description = "CI deploy SA (from the github-wif module)"
  type        = string
}

# INITIAL VALUE ONLY. Seeds the resend-from-email secret on first apply; the
# admin settings page owns it after that.
variable "resend_from_email" {
  description = "From address for learner mission emails. Stays onboarding@resend.dev (Resend's shared sandbox sender) until a domain is verified; while it is, Resend rejects every recipient except the account owner."
  type        = string
  default     = "onboarding@resend.dev"
}

variable "domains" {
  description = "Optional public hostname per environment. Empty string / missing key = HTTP-only on the LB IP for that env."
  type        = map(string)
  default     = {}
}

variable "cron_environment" {
  description = <<-EOT
    Which environment runs the YouTube auto-link schedule, or "" for none.

    One at most. The environments now have a database each, so two schedules
    would no longer race on the same runs, but they read one YouTube channel:
    the second would only attach the yard's real videos to test missions, or
    to nothing. Defaults to none so a schedule has to be asked for.
  EOT
  type        = string
  default     = ""
}

variable "cron_schedule" {
  description = "Cron expression for the YouTube auto-link job. The app's admin-set interval floor (runtimeSettings.ts) and its code comments both assume this stays */15; cronScheduleAgreement.test.ts checks the two still agree. A poll that finds nothing is essentially free, so this is about how long a learner waits."
  type        = string
  default     = "*/15 * * * *"
}
