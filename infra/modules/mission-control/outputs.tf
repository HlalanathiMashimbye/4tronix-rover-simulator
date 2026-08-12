output "artifact_registry_repo" {
  value = google_artifact_registry_repository.mission_control.repository_id
}

output "service_names" {
  value = { for env, svc in google_cloud_run_v2_service.mission_control : env => svc.name }
}

# Learner-facing URLs: LB hostname when configured, otherwise the LB IP over HTTP.
# Direct Cloud Run *.run.app URIs are intentionally not exported — ingress is
# locked to the load balancer.
output "service_urls" {
  value = {
    for env, _ in var.environments :
    env => (
      contains(keys(local.domains), env)
      ? "https://${local.domains[env]}"
      : "http://${google_compute_global_address.mission_control[env].address}"
    )
  }
}

output "lb_ip_addresses" {
  value = {
    for env, addr in google_compute_global_address.mission_control : env => addr.address
  }
}
