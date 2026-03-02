#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${BACKUP_OUT_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
STAMP="$(date +%Y%m%d_%H%M%S)"
mkdir -p "${OUT_DIR}"

DB_URL="${DATABASE_URL:-}"
if [[ -z "${DB_URL}" ]]; then
  if [[ -z "${PGHOST:-}" || -z "${PGUSER:-}" || -z "${PGDATABASE:-}" ]]; then
    echo "DATABASE_URL or PGHOST/PGUSER/PGDATABASE must be set" >&2
    exit 1
  fi
  DB_URL="postgresql://${PGUSER}:${PGPASSWORD:-}@${PGHOST}:${PGPORT:-5432}/${PGDATABASE}"
fi

DB_URL="${DB_URL/postgresql+psycopg2:/postgresql:}"
OUT_FILE="${OUT_DIR}/usc_${STAMP}.dump"

pg_dump --format=custom --no-owner --no-privileges --file "${OUT_FILE}" "${DB_URL}"
find "${OUT_DIR}" -type f -name "*.dump" -mtime "+${RETENTION_DAYS}" -delete

echo "Backup created: ${OUT_FILE}"
