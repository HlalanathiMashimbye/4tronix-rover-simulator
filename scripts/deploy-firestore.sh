#!/usr/bin/env bash
#
# Deploy firestore.rules and firestore.indexes.json to every Mission Control
# database: (default), which is staging's, and prod.
#
# Two config files, not one. firebase.json can list several databases, but the
# Firestore emulator does not support that yet: given the list, it loads no
# rules at all and allows every read and write, so the rules tests in CI would
# be testing nothing. firebase.json stays single-database for the emulator, and
# firebase.prod.json points the same files at prod. firestoreDeployConfig.test.ts
# keeps the two pointing at the same rules.
#
# REFUSES TO RUN UNTIL THE DATABASE EXISTS. `firebase deploy` creates a missing
# named database by itself, even with --dry-run, with none of the settings
# Terraform gives it: no point-in-time recovery, no delete protection, and not
# in Terraform's state, so the next apply fails on "already exists". Prod's
# database is created by `terraform apply` (docs/go-live.md) and only then gets
# its rules.
#
#   scripts/deploy-firestore.sh            # both databases
#   PROJECT=other-project scripts/deploy-firestore.sh

set -euo pipefail

PROJECT="${PROJECT:-bt-impact-academy}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

deploy() {
  local database="$1" config="$2"
  if ! gcloud firestore databases describe --database="$database" --project="$PROJECT" >/dev/null 2>&1; then
    echo "Firestore database '$database' does not exist in $PROJECT, or you cannot see it." >&2
    echo "Create it with terraform apply first (docs/go-live.md). Not deploying, because" >&2
    echo "firebase deploy would create it itself, without Terraform's settings." >&2
    exit 1
  fi
  echo "== rules and indexes -> $database"
  firebase deploy --config "$config" --only firestore --project "$PROJECT"
}

deploy "(default)" firebase.json
deploy "prod" firebase.prod.json

echo "Rules and indexes deployed to (default) and prod in $PROJECT."
