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

  # Hostnames behind a proxy get a DNS-validated certificate (see below), and
  # the ones whose load balancer already uses it.
  dns_validated = {
    for env, domain in local.domains : env => domain
    if contains(keys(var.dns_validated_certificates), env)
  }
  uses_certificate_map = {
    for env, domain in local.dns_validated : env => domain
    if var.dns_validated_certificates[env]
  }
  # Everything else keeps the classic Google-managed certificate.
  classic_certificates = {
    for env, domain in local.domains : env => domain
    if !contains(keys(local.uses_certificate_map), env)
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
#
# Once an environment has a hostname, port 80 only redirects. It used to serve
# the whole app, API included, so a learner who typed marsyard.labs.ws without
# https:// filled in their email address over plain HTTP: the certificate was
# there, and nothing sent anyone to it. Found 22 Oct 2026, before prod.
#
# A second URL map whose only job is the redirect is Google's documented shape
# for this, and it leaves the managed certificate's provisioning untouched.

resource "google_compute_url_map" "https_redirect" {
  for_each = local.domains
  name     = "mission-control-${each.key}-https-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "mission_control" {
  for_each = var.environments
  name     = "mission-control-${each.key}"
  url_map = (
    contains(keys(local.domains), each.key)
    ? google_compute_url_map.https_redirect[each.key].id
    : google_compute_url_map.mission_control[each.key].id
  )
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
  for_each = local.classic_certificates
  name     = "mission-control-${each.key}"

  managed {
    domains = [each.value]
  }
}

# --- DNS-validated certificate, for a hostname behind a proxy ----------------
#
# A classic managed certificate renews by Google reaching the load balancer at
# its hostname. Once David moved sapient.rocks to Cloudflare (by 1 Nov 2026),
# marsyard.sapient.rocks resolved to Cloudflare, and prod's certificate went to
# FAILED_NOT_VISIBLE with an expiry of 18 Nov 2026. Visitors see Cloudflare's
# certificate, but Cloudflare still connects to this load balancer over HTTPS.
#
# Certificate Manager proves ownership with a CNAME instead, which the proxy
# does not touch, and it can issue before the load balancer uses it. The record
# must be DNS only (grey cloud) in Cloudflare: a proxied CNAME is not one.

resource "google_certificate_manager_dns_authorization" "mission_control" {
  for_each = local.dns_validated
  name     = "mission-control-${each.key}"
  domain   = each.value
}

resource "google_certificate_manager_certificate" "mission_control" {
  for_each = local.dns_validated
  name     = "mission-control-${each.key}"

  managed {
    domains            = [each.value]
    dns_authorizations = [google_certificate_manager_dns_authorization.mission_control[each.key].id]
  }
}

resource "google_certificate_manager_certificate_map" "mission_control" {
  for_each = local.dns_validated
  name     = "mission-control-${each.key}"
}

resource "google_certificate_manager_certificate_map_entry" "mission_control" {
  for_each     = local.dns_validated
  name         = "mission-control-${each.key}"
  map          = google_certificate_manager_certificate_map.mission_control[each.key].name
  hostname     = each.value
  certificates = [google_certificate_manager_certificate.mission_control[each.key].id]
}

resource "google_compute_target_https_proxy" "mission_control" {
  for_each = local.domains

  name    = "mission-control-${each.key}"
  url_map = google_compute_url_map.mission_control[each.key].id

  # One or the other: a proxy with a certificate map ignores ssl_certificates.
  certificate_map = (
    contains(keys(local.uses_certificate_map), each.key)
    ? "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.mission_control[each.key].id}"
    : null
  )
  ssl_certificates = (
    contains(keys(local.uses_certificate_map), each.key)
    ? null
    : [google_compute_managed_ssl_certificate.mission_control[each.key].id]
  )
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
