# Public front door: External Application Load Balancer -> serverless NEG ->
# Cloud Run. Cloud Run has invoker IAM disabled and ingress locked to the LB
# (see main.tf), so there is no allUsers binding and *.run.app stays closed.
#
# One LB stack per environment (matches the Cloud Run for_each). Optional
# hostname in var.domains enables Google-managed HTTPS; without it that env
# is HTTP on the reserved IP (demo only).

locals {
  # Envs that should get a managed cert + HTTPS proxy.
  domains = {
    for env, domain in var.domains : env => domain
    if contains(keys(var.environments), env) && trimspace(domain) != ""
  }

  # Public origin per environment, same rule as the service_urls output.
  # Handed to the container as a RUNTIME env var rather than baked in at build
  # time: prod promotes the exact image digest already serving on staging, and
  # Next freezes every NEXT_PUBLIC_* value when `next build` runs, so a
  # build-time origin would make prod emails link to the staging domain.
  app_urls = {
    for env, _ in var.environments :
    env => (
      contains(keys(local.domains), env)
      ? "https://${local.domains[env]}"
      : "http://${google_compute_global_address.mission_control[env].address}"
    )
  }
}

resource "google_compute_global_address" "mission_control" {
  for_each = var.environments
  name     = "mission-control-${each.key}"
}

resource "google_compute_region_network_endpoint_group" "mission_control" {
  for_each              = var.environments
  name                  = "mission-control-${each.key}"
  network_endpoint_type = "SERVERLESS"
  region                = var.region

  cloud_run {
    service = google_cloud_run_v2_service.mission_control[each.key].name
  }
}

resource "google_compute_backend_service" "mission_control" {
  for_each = var.environments

  name                  = "mission-control-${each.key}"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  # Serverless NEG has no VMs to health-check; Google manages readiness.

  backend {
    group = google_compute_region_network_endpoint_group.mission_control[each.key].id
  }
}

resource "google_compute_url_map" "mission_control" {
  for_each        = var.environments
  name            = "mission-control-${each.key}"
  default_service = google_compute_backend_service.mission_control[each.key].id
}

# --- HTTP (always): IP-based demo access, and clear failures before DNS/cert ---

resource "google_compute_target_http_proxy" "mission_control" {
  for_each = var.environments
  name     = "mission-control-${each.key}"
  url_map  = google_compute_url_map.mission_control[each.key].id
}

resource "google_compute_global_forwarding_rule" "http" {
  for_each = var.environments

  name                  = "mission-control-${each.key}-http"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.mission_control[each.key].id
  ip_address            = google_compute_global_address.mission_control[each.key].id
}

# --- HTTPS (only when a hostname is configured) -------------------------------

resource "google_compute_managed_ssl_certificate" "mission_control" {
  for_each = local.domains
  name     = "mission-control-${each.key}"

  managed {
    domains = [each.value]
  }
}

resource "google_compute_target_https_proxy" "mission_control" {
  for_each = local.domains

  name             = "mission-control-${each.key}"
  url_map          = google_compute_url_map.mission_control[each.key].id
  ssl_certificates = [google_compute_managed_ssl_certificate.mission_control[each.key].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  for_each = local.domains

  name                  = "mission-control-${each.key}-https"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.mission_control[each.key].id
  ip_address            = google_compute_global_address.mission_control[each.key].id
}
