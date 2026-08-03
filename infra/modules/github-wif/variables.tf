variable "project_id" {
  type = string
}

variable "github_repository" {
  description = "owner/name of the repo allowed to deploy"
  type        = string
}

variable "tfstate_bucket" {
  description = "GCS bucket holding remote state (hand-made, see README step 2). The plan identity needs access to it."
  type        = string
}
