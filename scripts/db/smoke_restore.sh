#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <dump-file>" >&2
  exit 1
fi

DUMP_FILE="$1"
SMOKE_DB_URL="${SMOKE_DATABASE_URL:-}"
if [[ -z "${SMOKE_DB_URL}" ]]; then
  echo "SMOKE_DATABASE_URL must be set (separate temporary DB)" >&2
  exit 1
fi

TARGET_DATABASE_URL="${SMOKE_DB_URL}" "$(dirname "$0")/restore.sh" "${DUMP_FILE}"
SMOKE_DB_URL="${SMOKE_DB_URL/postgresql+psycopg2:/postgresql:}"
psql "${SMOKE_DB_URL}" -c "select count(*) as users_count from accounts_user;"

echo "Smoke restore check passed"
