#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <dump-file>" >&2
  exit 1
fi

DUMP_FILE="$1"
if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "Dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

TARGET_DB_URL="${TARGET_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "${TARGET_DB_URL}" ]]; then
  echo "TARGET_DATABASE_URL or DATABASE_URL must be set" >&2
  exit 1
fi

TARGET_DB_URL="${TARGET_DB_URL/postgresql+psycopg2:/postgresql:}"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "${TARGET_DB_URL}" "${DUMP_FILE}"

echo "Restore completed: ${DUMP_FILE}"
