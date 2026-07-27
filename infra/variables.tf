variable "project_id" {
  description = "GCP project that hosts everything (Impact Academy)"
  type        = string
  default     = "bt-impact-academy"
}

variable "region" {
  description = "Region for Cloud Run + Artifact Registry (Johannesburg)"
  type        = string
  default     = "africa-south1"
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
