variable "project_id" {
  description = "GCP project holding both the Firestore database and the backup bucket"
  type        = string
}

variable "firestore_location" {
  description = "Location of the Firestore database. The export bucket has to sit here too: a managed export refuses a bucket that is not near the database."
  type        = string
}

variable "database_id" {
  description = "Firestore database to export. Mission Control uses the (default) database."
  type        = string
  default     = "(default)"
}

variable "cron_region" {
  description = "Region the Cloud Scheduler job lives in. Owned by the root cron_region, and deliberately not var.region: Cloud Scheduler is not offered in africa-south1. Nothing else in this module is regional, which is why there is no var.region here at all."
  type        = string
}

variable "schedule" {
  description = "Cron schedule for the export, in var.time_zone."
  type        = string
  default     = "0 3 * * 0"
}

variable "time_zone" {
  description = "Time zone the schedule is read in."
  type        = string
  default     = "Africa/Johannesburg"
}

variable "retention_days" {
  description = "Age at which an export is deleted. 90 days is roughly 13 weekly copies, which covers a corruption nobody noticed for a term."
  type        = number
  default     = 90
}
