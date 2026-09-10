# Impact's environment (bt-impact-academy).
#
#   terraform init -reconfigure \
#     -backend-config="bucket=bt-impact-academy-tfstate" \
#     -backend-config="prefix=mission-control"
#   terraform apply -var-file=impact.tfvars
#
# project_id and region already default to these in variables.tf; they are
# repeated here so the file states the target rather than relying on defaults.
project_id = "bt-impact-academy"
region     = "africa-south1"

# HTTPS. Without these, each environment is HTTP on a bare load-balancer IP,
# and learner email addresses would cross the network in clear text. Setting a
# hostname makes Terraform provision a Google-managed certificate and an HTTPS
# forwarding rule. These domains are live; omitting them on apply proposes
# destroying the certs and HTTPS listeners.
#
# ORDER MATTERS. Point the DNS A records at the LB IPs BEFORE applying:
#
#   marsyard.sapient.rocks  A    136.68.161.27    (prod)
#   marsyard.labs.ws        A    136.68.166.17    (staging)
#
# Google validates domain ownership by resolving the name to the load
# balancer. Apply first and the certificate sits in PROVISIONING until DNS
# catches up, which looks like a broken deploy for as long as it takes.
#
# The IPs are reserved global addresses, so they do not change on re-apply.
# Confirm them with: terraform output lb_ip_addresses
#
# Domains provided by David Campey (2026-08-14): marsyard.sapient.rocks for
# email + prod, marsyard.labs.ws for staging.
domains = {
  prod    = "marsyard.sapient.rocks"
  staging = "marsyard.labs.ws"
}

# Which environment runs the YouTube auto-link schedule. Exactly one may:
# both environments point at this project and therefore share one Firestore,
# so two schedulers would race to attach the same video to the same run.
#
# staging, because that is the environment actually serving learners; prod is
# deliberately not deployed. Move this the day prod comes up, do not add to it.
cron_environment = "staging"

# Email. The domain marsyard.sapient.rocks is verified in Resend (DKIM + SPF
# MX/TXT + DMARC live in GoDaddy), so mail can now go to any learner address
# and no longer has to come from Resend's shared onboarding@resend.dev sender.
#
# The sandbox redirect is gone: it sent EVERY mission email to one inbox, and
# only ever existed for the months before this domain was verified. It is an
# environment variable for local testing now, and not a Terraform value or a
# settings field, so it cannot be armed against a live yard by accident.
#
# Seeds the resend-from-email secret on first apply; the admin settings page
# owns it afterwards.
resend_from_email = "missions@marsyard.sapient.rocks"

# Firestore auth is ADC via the Cloud Run runtime service account (no mounted
# key, no firebase_credential_source var). That SA already holds
# roles/datastore.user in this project.
