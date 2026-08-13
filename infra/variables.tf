variable "project_id" {
  description = "GCP project that hosts everything (Impact Academy)"
  type        = string
  default     = "bt-impact-academy"
}

variable "region" {
  description = "Region for Cloud Run + Artifact Registry. Johannesburg, to serve South African learners without a trip to Europe."
  type        = string
  default     = "africa-south1"
}

# Deliberately NOT co-located with Firestore, which lives in europe-west1.
#
# The previous note here said africa-south1 was not offered for Firestore. That
# is not true - `gcloud firestore locations list` includes it. Firestore stays
# in europe-west1 because a database's location is immutable and the prod
# database already exists there; moving it would mean deleting and recreating
# it, which was judged not worth doing (2026-08-03).
#
# The split costs less than it looks like it should: every page read in
# mission-control is client-side (see src/app/page.tsx and the mission detail
# page, which fetch nothing during SSR), so the browser talks to Firestore
# directly and Cloud Run is not in the read path at all. Only the API routes
# pay a cross-continent hop, and they are off the render path.
#
# WARNING: africa-south1 is what the Terraform state, the GitHub Actions
# variables, and the live Artifact Registry repo all use. This default was
# europe-west1 while everything else said otherwise, so an apply with default
# vars wanted to destroy and recreate the registry (location is immutable on
# that resource). Keep these three in agreement.

variable "resend_from_email" {
  description = "From address for learner mission emails."
  type        = string
  default     = "onboarding@resend.dev"
}

variable "resend_sandbox_recipient" {
  description = "Redirects ALL mission email to one inbox while no sending domain is verified. Empty means normal delivery. Set via TF_VAR_resend_sandbox_recipient, never committed."
  type        = string
  default     = ""
}

variable "github_repository" {
  description = "GitHub repo allowed to deploy via Workload Identity Federation (owner/name)"
  type        = string
  default     = "HlalanathiMashimbye/4tronix-rover-simulator"
}

variable "tfstate_bucket" {
  description = "GCS bucket holding remote state. Must match the bucket in backend.tf (backends cannot take variables, so this is kept in sync by hand)."
  type        = string
  default     = "bt-impact-academy-tfstate"
}

variable "environments" {
  description = "Cloud Run environments. min_instances = 1 during event days kills cold starts."
  type = map(object({
    min_instances = number
    max_instances = number
  }))
  default = {
    staging = { min_instances = 0, max_instances = 2 }
    prod    = { min_instances = 0, max_instances = 10 }
  }
}

variable "firebase_credential_source" {
  description = "\"adc\" to authenticate to Firestore as the runtime service account (no key stored anywhere), or \"service-account\" to mount FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY from Secret Manager. See the module variable for the full reasoning."
  type        = string
  default     = "service-account"
}

variable "domains" {
  description = "Optional public hostname per environment (e.g. staging = mission-control-staging.example.com). When set, Terraform provisions a Google-managed cert and HTTPS on the load balancer; point DNS A records at terraform output lb_ip_addresses first. When empty, that env is HTTP-only on the LB IP (fine for a short demo, not for real mail links)."
  type        = map(string)
  default     = {}
}
