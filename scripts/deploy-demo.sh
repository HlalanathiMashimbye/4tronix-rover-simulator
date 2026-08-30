#!/usr/bin/env bash
#
# Build and deploy Mission Control to Cloud Run from this machine.
#
# The normal path is GitHub Actions (see .github/workflows/deploy-staging.yml).
# This is the manual equivalent, for getting a public URL up without waiting on
# CI, WIF or a green build. It does the same three things: build the image with
# the public Firebase config baked in, push it to Artifact Registry, deploy the
# resulting digest to Cloud Run.
#
# Deploys by DIGEST, not tag, for the same reason CI does: a tag can be moved,
# so "what is running" stays answerable.
#
# Requires: gcloud, authenticated, with the target project set.
# Reads the NEXT_PUBLIC_* values from mission-control/.env so no config has to
# be typed or pasted. Nothing secret is passed here - server credentials come
# from Secret Manager at runtime.
#
# Usage:
#   scripts/deploy-demo.sh [service-name]
# Defaults to mission-control-staging.

set -euo pipefail

SERVICE="${1:-mission-control-staging}"
REGION="${REGION:-africa-south1}"
REPO="${REPO:-mission-control}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/mission-control/.env"

[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE - cannot read the Firebase web config." >&2; exit 1; }

PROJECT="$(gcloud config get-value project 2>/dev/null)"
[ -n "$PROJECT" ] && [ "$PROJECT" != "(unset)" ] || {
  echo "No gcloud project set. Run: gcloud config set project <id>" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/mission-control:$(git -C "$ROOT" rev-parse --short HEAD)"

echo "==> Project : $PROJECT"
echo "==> Service : $SERVICE ($REGION)"
echo "==> Image   : $IMAGE"

# ^~^ changes the substitution delimiter from comma to tilde: several of these
# values contain commas and would otherwise be split into bogus substitutions.
gcloud builds submit "$ROOT/mission-control" \
  --config "$ROOT/mission-control/cloudbuild.yaml" \
  --substitutions="^~^_IMAGE=${IMAGE}~_APP_URL=${NEXT_PUBLIC_APP_URL:-}~_FB_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY}~_FB_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}~_FB_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID}~_FB_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET}~_FB_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}~_FB_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}~_FB_MEASUREMENT_ID=${NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID:-}~_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY:-}~_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST:-}"

DIGEST="$(gcloud artifacts docker images describe "$IMAGE" --format='value(image_summary.digest)')"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "${IMAGE%%:*}@${DIGEST}" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "==> Live at $URL"
curl -fsS -o /dev/null -w "==> Smoke check: HTTP %{http_code}\n" "$URL" || {
  echo "==> Smoke check FAILED. Logs: gcloud run services logs read $SERVICE --region $REGION" >&2
  exit 1
}
