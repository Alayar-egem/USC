# DB Backup and Rollback Runbook (MVP)

## RPO / RTO defaults
- RPO: up to 24 hours (daily full backup).
- RTO: 30-60 minutes for manual restore and service validation.

## Standard backup
1. Ensure `pg_dump` is installed.
2. Set `DATABASE_URL` (or `PGHOST/PGUSER/PGDATABASE`).
3. Run:
   - Linux/macOS: `bash scripts/db/backup.sh`
   - Windows: `powershell -ExecutionPolicy Bypass -File scripts/db/backup.ps1`

## Restore
1. Freeze writes to the application.
2. Set restore target:
   - `TARGET_DATABASE_URL` (recommended), or `DATABASE_URL`.
3. Run:
   - Linux/macOS: `bash scripts/db/restore.sh backups/<file>.dump`
   - Windows: `powershell -ExecutionPolicy Bypass -File scripts/db/restore.ps1 -DumpFile backups/<file>.dump`
4. Run smoke sanity checks (counts/health endpoints).

## Smoke restore check on temporary DB
1. Create an empty temporary DB.
2. Set `SMOKE_DATABASE_URL` to that DB.
3. Run:
   - Linux/macOS: `bash scripts/db/smoke_restore.sh backups/<file>.dump`
   - Windows: `powershell -ExecutionPolicy Bypass -File scripts/db/smoke_restore.ps1 -DumpFile backups/<file>.dump`

## Rollback after failed migration
1. Stop API workers and background writes.
2. Identify latest valid `.dump`.
3. Restore DB from dump.
4. Pin backend image/commit to the last known good revision.
5. Start backend and verify:
   - `/api/health`
   - `/api/health/cache`
   - critical user flows (auth, orders, notifications).
6. Re-open writes only after validation.
