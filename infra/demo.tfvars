# Personal GCP project, used to get Mission Control publicly hosted for the
# 11 Aug 2026 demo while `bt-impact-academy` is still blocked.
#
# The block there is not billing: the UCT team inherits only roles/editor, which
# has neither iam.workloadIdentityPools.create nor setIamPolicy (see README.md),
# so the WIF pool and the public `allUsers` invoker binding cannot be created.
# On a personal project the owner has both, and there is no organization above
# it to enforce a policy against public ingress.
#
# THIS IS TEMPORARY. Firestore, Auth and the learner data it holds belong in
# Impact's project, and a deployment tied to a personal Google account cannot be
# handed over. Moving back is `terraform apply` with the defaults in
# variables.tf plus a re-init against the original state bucket - no code
# change, which is the whole reason this file exists instead of edited defaults.
#
# Usage:
#   terraform init
#   terraform apply -var-file=demo.tfvars
#
# backend.tf already names this project's state bucket, because CI runs a bare
# `terraform init` and cannot be handed a -backend-config. Moving back to
# Impact means editing that one line as well as swapping this file out.

project_id = "mars-rover-cloud-platform"

# Same region as the Impact setup, so nothing about the deployment shape
# changes when it moves back.
region = "africa-south1"

# Must match the bucket passed to `terraform init -backend-config` above.
# Backends cannot read variables, so these are kept in step by hand.
tfstate_bucket = "mars-rover-cloud-platform-tfstate"
