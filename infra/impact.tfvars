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
#   missioncontrol.sapient.rocks          A    136.68.161.27    (prod)
#   staging.missioncontrol.sapient.rocks  A    136.68.166.17    (staging)
#
# Google validates domain ownership by resolving the name to the load
# balancer. Apply first and the certificate sits in PROVISIONING until DNS
# catches up, which looks like a broken deploy for as long as it takes.
#
# The IPs are reserved global addresses, so they do not change on re-apply.
# Confirm them with: terraform output lb_ip_addresses
domains = {
  prod    = "missioncontrol.sapient.rocks"
  staging = "staging.missioncontrol.sapient.rocks"
}
