#!/usr/bin/env bash
#
# The smoke check both deploy workflows end with: is this URL serving Mission
# Control, with the operator console still behind sign-in?
#
# It lives here, once, because it used to live in each workflow and the two
# copies drifted. Staging's was corrected when the operator console shipped.
# Prod's kept the old line on a workflow that had never been run, so the first
# production deploy would have promoted the right image and then gone red.
# Prod promotes the digest serving on staging, so what must be true of one is
# exactly what must be true of the other.
#
# Every request is anonymous on purpose, so this needs no credentials and can
# be run from any machine with curl:
#
#   scripts/smoke-check.sh https://marsyard.labs.ws
#
# Exits 0 when every assertion holds, 1 naming the first one that does not.

set -euo pipefail

URL="${1:-}"
if [ -z "$URL" ]; then
  echo "usage: $0 <base-url>" >&2
  exit 2
fi
URL="${URL%/}"

page="$(mktemp)"
trap 'rm -f "$page"' EXIT

fail() {
  echo "Smoke check FAILED: $1" >&2
  exit 1
}

# Learner home must serve via the load balancer.
curl -sSf -o /dev/null "$URL/" || fail "$URL/ did not serve the learner home"

# The operator surface used to be asserted absent (404). It shipped in
# AB#341/342, so that assertion went stale and staging went red on every
# passing deploy until it was replaced. A permanently failing check is worse
# than no check: it hides the real failure it exists to catch.
#
# What matters now is not that /operator is missing, but that an
# anonymous request cannot get anything behind it. So assert the
# boundary itself.

# The page renders its own sign-in form rather than redirecting.
operator_status="$(curl -sS -o "$page" -w '%{http_code}' "$URL/operator")"
[ "$operator_status" = "200" ] || fail "/operator returned $operator_status, expected 200"
grep -qi 'password' "$page" || fail "/operator has no password field, so it is not the sign-in form"

# ...and it must be sign-in, not the console. If the queue ever renders
# to an anonymous visitor, this is the line that catches it.
if grep -qiE 'dispatch|needs review|mission queue' "$page"; then
  fail "operator console content served to an anonymous request"
fi

# The real boundary: operator APIs reject anonymous callers outright.
api_status="$(curl -sS -o /dev/null -w '%{http_code}' "$URL/api/operator/missions")"
[ "$api_status" = "401" ] || fail "/api/operator/missions returned $api_status to an anonymous caller, expected 401"

echo "Smoke check passed: $URL"
