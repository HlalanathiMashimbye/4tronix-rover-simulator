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

variable "resend_from_email" {
  description = "From address for learner mission emails. Stays onboarding@resend.dev (Resend's shared sandbox sender) until a domain is verified; while it is, Resend rejects every recipient except the account owner."
  type        = string
  default     = "onboarding@resend.dev"
}

variable "resend_sandbox_recipient" {
  description = "Redirects ALL mission email to this one inbox, for demoing while no domain is verified. Empty means normal delivery. Must be empty in prod once a domain is verified, or no learner ever receives mail. Set out-of-band, never committed (it is a personal address)."
  type        = string
  default     = ""
}

variable "firebase_credential_source" {
  description = <<-EOT
    How the Cloud Run service authenticates to Firestore.

    "adc" (Application Default Credentials) is the better answer whenever
    Firestore lives in the same project as Cloud Run, which it does in every
    deployment we run: the runtime service account already holds
    roles/datastore.user, so there is no service-account key to store, rotate
    or leak. See src/infrastructure/persistence/firebase-admin.ts, which picks
    this path when neither FIREBASE_CLIENT_EMAIL nor FIREBASE_PRIVATE_KEY is
    set.

    "service-account" keeps the previous behaviour, mounting both from Secret
    Manager. Kept as the default so an existing deployment does not change
    identity underneath itself on the next apply.
  EOT
  type        = string
  default     = "service-account"

  validation {
    condition     = contains(["adc", "service-account"], var.firebase_credential_source)
    error_message = "firebase_credential_source must be \"adc\" or \"service-account\"."
  }
}
