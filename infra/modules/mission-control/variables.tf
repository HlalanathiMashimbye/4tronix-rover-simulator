variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environments" {
  type = map(object({
    min_instances = number
    max_instances = number
  }))
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

    Only one may: staging and prod share a project and therefore a Firestore,
    so two schedulers would race on the same runs. Defaults to none so the
    unsafe state has to be asked for rather than arrived at.
  EOT
  type        = string
  default     = ""
}

variable "cron_schedule" {
  description = "Cron expression for the YouTube auto-link job. A poll that finds nothing is essentially free, so this is about how long a learner waits."
  type        = string
  default     = "*/15 * * * *"
}
