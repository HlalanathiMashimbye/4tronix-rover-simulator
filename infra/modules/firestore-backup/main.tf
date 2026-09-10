# Weekly off-platform copy of Firestore: a Cloud Scheduler job that calls the
# Firestore Admin export API and writes into a bucket in this project.
#
# WHY THE MANAGED EXPORT AND NOT A BACKUP SCRIPT.
#
# The alternative on the table was a Cloud Function that walks every collection,
# writes each document as JSON, zips it and uploads the zip. It reads well and
# it loses data. A Firestore timestamp comes back as an ISO string, a
# DocumentReference as a map, and the restore side writes those straight back
# with .set(), so a restore succeeds and quietly changes the schema. It also
# holds the whole export plus the zip in the function's /tmp, which is memory
# on Cloud Run, so it OOMs at roughly half the instance size.
#
# :exportDocuments keeps native types, streams to GCS with no size ceiling,
# needs no code to review or maintain, and `gcloud firestore import` is the
# matching restore. It is already the tool this repo documents for moving data
# between projects (infra/README.md, docs/team-deploy-tasks.md).
#
# WHAT IT IS NOT. An export is a point-in-time copy taken while the database is
# live: it is not transactionally consistent across collections, and recent
# writes may be missing. Firestore PITR covers the last 7 days at second
# granularity and is enabled on the database (out of Terraform, alongside the
# rest of the Firebase provisioning). PITR is the tool for "someone deleted a
# collection an hour ago"; these exports are the tool for "the project is gone"
# or "this data was already wrong last month".

# --- Where the exports land -----------------------------------------------

resource "google_storage_bucket" "exports" {
  name = "${var.project_id}-firestore-backup"

  # NOT var.region. A managed export requires a bucket near the database, and
  # the database is immutably in europe-west1 (see the region note in
  # infra/variables.tf). This is the one bucket that does not get to follow the
  # rest of the deployment to africa-south1.
  location = var.firestore_location

  # Export and import operations reject Requester Pays and Rapid buckets, so
  # neither is set here. Standard storage, no hierarchical namespace.
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # No versioning: every export writes to its own generated timestamp prefix,
  # so nothing is ever overwritten and a second version can never exist.
  lifecycle_rule {
    condition {
      age = var.retention_days
    }
    action {
      type = "Delete"
    }
  }

  # Deliberately no Nearline/Coldline transition. The data is small enough that
  # the saving is cents, and the moment this bucket is read is the moment an
  # incident is already underway, which is the wrong time to be paying
  # retrieval fees or minimum-duration charges on a copy taken last week.

  # A stray `terraform destroy` must not be able to take the backups with it.
  force_destroy = false
}

# --- The identity that runs the export ------------------------------------
#
# Its own service account, not a default one. The org enforces
# constraints/iam.automaticIamGrantsForDefaultServiceAccounts, so the App
# Engine and compute default accounts hold no roles in this project at all and
# anything relying on their historical Editor grant fails here.
resource "google_service_account" "exporter" {
  account_id   = "firestore-backup"
  display_name = "Scheduled Firestore export: export only, no document reads"
}

# datastore.importExportAdmin can start an export or an import and cannot read
# or write a single document. The export itself runs as the Firestore service
# agent, so this identity never touches the data it is copying.
resource "google_project_iam_member" "exporter_import_export" {
  project = var.project_id
  role    = "roles/datastore.importExportAdmin"
  member  = "serviceAccount:${google_service_account.exporter.email}"
}

# Scoped to this bucket, not the project. Storage Admin is what the export
# docs require of the calling account; on one bucket that is write plus the
# bucket metadata read the API makes before it starts.
resource "google_storage_bucket_iam_member" "exporter_bucket" {
  bucket = google_storage_bucket.exports.name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.exporter.email}"
}

# The Firestore service agent is what actually writes the export files. It
# needs no grant while the bucket is in the same project as the database, which
# is why the bucket lives here rather than somewhere tidier.

# --- The schedule ----------------------------------------------------------

resource "google_cloud_scheduler_job" "export" {
  name        = "firestore-export-weekly"
  description = "Managed Firestore export to gs://${google_storage_bucket.exports.name}, retained ${var.retention_days} days."
  region      = var.region
  schedule    = var.schedule
  time_zone   = var.time_zone

  http_target {
    http_method = "POST"
    uri         = "https://firestore.googleapis.com/v1/projects/${var.project_id}/databases/${var.database_id}:exportDocuments"

    headers = {
      "Content-Type" = "application/json"
    }

    # No collectionIds: the whole database. Naming collections here would mean
    # a new collection is silently outside the backup until someone remembers
    # to add it, and forgetting is invisible until a restore.
    #
    # outputUriPrefix is the bare bucket, so Firestore generates its own
    # timestamped prefix per run and no two exports can collide.
    body = base64encode(jsonencode({
      outputUriPrefix = "gs://${google_storage_bucket.exports.name}"
    }))

    # OAuth, not OIDC. Targets on *.googleapis.com expect an access token; an
    # ID token gets a 401 here. Cloud Scheduler mints it as the exporter
    # account, which its own service agent is allowed to do for accounts in
    # this project once the Scheduler API is enabled.
    oauth_token {
      service_account_email = google_service_account.exporter.email
      scope                 = "https://www.googleapis.com/auth/datastore"
    }
  }

  # One retry. The API returns immediately with a long-running operation, so a
  # failure here is a bad request or a permissions problem, and neither is
  # fixed by trying again all night.
  retry_config {
    retry_count = 1
  }

  depends_on = [
    google_project_iam_member.exporter_import_export,
    google_storage_bucket_iam_member.exporter_bucket,
  ]
}
