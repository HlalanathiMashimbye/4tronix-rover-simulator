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
# which is what it is today - and the app collects learner email addresses, so
# those cross the network in clear text. Setting a hostname makes Terraform
# provision a Google-managed certificate and an HTTPS forwarding rule.
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
# resend_sandbox_recipient is deliberately NOT set here. While it has a value,
# EVERY mission email is redirected to that one inbox and no learner receives
# mail. It defaults to "" and must stay empty now that the domain is verified.
resend_from_email = "missions@marsyard.sapient.rocks"

# Authenticate to Firestore as the Cloud Run runtime service account rather
# than a mounted key. Firestore lives in this same project and the runtime SA
# already holds roles/datastore.user, so no key needs to exist: nothing to
# store in Secret Manager, nothing to rotate, nothing to leak.
#
# The module default is still "service-account" so an existing deployment does
# not change identity underneath itself on an unrelated apply. Impact's never
# had a real key seeded - FIREBASE_PRIVATE_KEY was still the CHANGE_ME
# placeholder, so every server-side Firestore call failed with
# "Failed to parse private key: DECODER routines::unsupported" and no mission
# could be submitted at all.
