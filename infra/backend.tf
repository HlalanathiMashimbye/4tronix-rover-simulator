# Remote state in GCS. The bucket is the ONE resource created by hand
# (chicken-and-egg: state cannot store itself). See README.md, step 2.
#
# Points at the project currently hosting the deployment. A backend block
# cannot read variables, so this is the one value that has to change by hand
# when the deployment moves - locally you can override it without editing:
#
#   terraform init -reconfigure -backend-config="bucket=<other>-tfstate"
#
# CI cannot, because the Terraform plan workflow runs a bare `terraform init`.
# So whichever bucket holds the live state has to be the one written here, or
# the plan check fails on every PR. Keep it in step with var.tfstate_bucket,
# which grants the read-only plan identity access to this same bucket.
#
# Never commit .tfstate.
terraform {
  backend "gcs" {
    bucket = "mars-rover-cloud-platform-tfstate"
    prefix = "mission-control"
  }
}
