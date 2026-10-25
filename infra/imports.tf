# Secrets that exist in the project but not yet in Terraform's state.
#
# Automatic YouTube upload (#304) added six secrets to the configuration, and
# three of them were created by hand on 11 October 2026 before anyone applied
# it. Without these blocks the next apply fails on "already exists". With them
# the same apply takes them into state, and their values stay as they are:
# Terraform manages these secrets, not their versions.
#
# Once an apply has run with them, they do nothing and can be deleted.

import {
  to = module.mission_control.google_secret_manager_secret.youtube_client_id
  id = "projects/bt-impact-academy/secrets/youtube-client-id"
}

import {
  to = module.mission_control.google_secret_manager_secret.youtube_client_secret
  id = "projects/bt-impact-academy/secrets/youtube-client-secret"
}

import {
  to = module.mission_control.google_secret_manager_secret.youtube_refresh_token
  id = "projects/bt-impact-academy/secrets/youtube-refresh-token"
}
