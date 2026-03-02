# USC MVP: Run Fully in Docker

## Quick start (development profile)

Use base + dev override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Open:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/api/health

## Production-like start

Use base + prod override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### With observability stack (optional)

Add `--profile observability` to include Prometheus (and Grafana in dev):

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile observability up -d --build
```

Open:
- Prometheus: http://localhost:9090
- Grafana (dev): http://localhost:3000

## Stop (any profile)

```powershell
docker compose down
```

## Rebuild after code changes in Dockerfiles

```powershell
docker compose up -d --build backend frontend
```

## Notes
- Compose files:
  - `docker-compose.yml` = base services and safe defaults (no dev-only hot reload in backend runtime)
  - `docker-compose.dev.yml` = local dev overrides (`uvicorn --reload`, frontend `npm run dev`, bind mounts)
  - `docker-compose.prod.yml` = production-like overrides
- Frontend proxy in dev points to backend via `VITE_PROXY_TARGET=http://backend:8000`.
- Backend cache uses Redis via `REDIS_URL=redis://redis:6379/0` in compose env.
- Demo seeding is disabled by default (`AUTO_SEED_DEMO=false`) to avoid data mutation on every restart.
- `JWT_SECRET_KEY` is required by compose and must be provided from your local environment.
- Frontend container no longer runs `npm install` on every start.

## JWT secret setup

Before running compose, define a strong local `JWT_SECRET_KEY` (do not commit real secrets):

```powershell
$env:JWT_SECRET_KEY = "replace-with-at-least-32-random-characters"
```

Recommended minimum:
- length: 32+ characters
- high entropy random string (letters + numbers + symbols)
- never commit to git

## Metrics and tracing

- Backend metrics endpoint: `GET /api/metrics` (Prometheus format).
- Request correlation: backend returns `x-request-id` response header and logs it.
- Important metric families:
  - `http_requests_total`
  - `http_request_duration_seconds`
  - `auth_login_attempts_total`
  - `rate_limit_hits_total`
  - `db_query_failures_total`

Alert hints:
- sustained growth of 5xx statuses in `http_requests_total`
- spikes in `rate_limit_hits_total`
- p95 latency growth in `http_request_duration_seconds`

## Sentry integration

Backend env:
- `SENTRY_DSN_BACKEND`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `SENTRY_TRACES_SAMPLE_RATE`

Frontend env:
- `VITE_SENTRY_DSN_FRONTEND`
- `VITE_SENTRY_ENVIRONMENT`
- `VITE_SENTRY_RELEASE`
- `VITE_SENTRY_TRACES_SAMPLE_RATE`

If DSN is empty, Sentry stays disabled.

## Seed demo data manually

```powershell
docker exec -w /app usc-backend python scripts/seed_demo.py
```

Or set `AUTO_SEED_DEMO=true` in backend environment when you explicitly need auto-seed on startup.

## Local backend (Windows, no Docker for API process)

Bootstrap local virtualenv once:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap_backend_venv.ps1
```

Run backend:

```powershell
cd backend
.\.venv_local\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Optional checks

```powershell
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
docker exec usc-redis redis-cli ping
```

Expected Redis response: `PONG`.

## DB backup / restore

Daily full backup + manual pre-release backup is the MVP default policy.

Commands:
- Backup (Linux/macOS): `bash scripts/db/backup.sh`
- Backup (Windows): `powershell -ExecutionPolicy Bypass -File scripts/db/backup.ps1`
- Restore (Linux/macOS): `bash scripts/db/restore.sh backups/<file>.dump`
- Restore (Windows): `powershell -ExecutionPolicy Bypass -File scripts/db/restore.ps1 -DumpFile backups/<file>.dump`
- Smoke restore on temp DB:
  - Linux/macOS: `bash scripts/db/smoke_restore.sh backups/<file>.dump`
  - Windows: `powershell -ExecutionPolicy Bypass -File scripts/db/smoke_restore.ps1 -DumpFile backups/<file>.dump`

Detailed rollback instructions: `docs/db-rollback-runbook.md`.

## CI/Test baseline

- Backend unit/API tests:
  - `pytest backend/tests -q --ignore=backend/tests/integration`
- Backend integration tests (PostgreSQL required):
  - `alembic upgrade head`
  - `pytest backend/tests/integration -q`
- Frontend unit/component tests:
  - `cd frontend`
  - `npm run test:ci`
- E2E golden path (Playwright):
  - `cd frontend`
  - `npm run e2e:ci`

GitHub Actions workflow: `.github/workflows/ci.yml` (single required pipeline `CI`).

## Auth/Orders hardening (MVP)

- Centralized audit log is written to `audit_event` for `auth`, `orders`, `deliveries` actions.
- `POST /api/orders/create/` supports `Idempotency-Key` header:
  - same key + same payload (within 24h) returns the same response;
  - same key + different payload returns `409 IDEMPOTENCY_CONFLICT`.
- Strict order statuses:
  - `PENDING`, `CONFIRMED`, `DELIVERING`, `PARTIALLY_DELIVERED`, `DELIVERED`, `CANCELLED`, `FAILED`
- Strict delivery statuses:
  - `ASSIGNED`, `PICKED_UP`, `ON_THE_WAY`, `PARTIALLY_DELIVERED`, `DELIVERED`, `FAILED`, `CANCELLED`
- Returns are disabled in MVP:
  - `POST /api/orders/{id}/returns/` returns `501 RETURNS_DISABLED_IN_MVP`.

## Notifications + Profile updates (MVP)

- Notifications are persistent in DB:
  - `notification_event`
  - `notification_user_state` (per-user `read/unread`)
- Notifications API:
  - `GET /api/notifications/` -> `{ items, unread_count }`
  - `POST /api/notifications/{id}/read/`
  - `POST /api/notifications/read_all/`
- Profile update API:
  - `PATCH /api/profile/me/` updates user fields and active company fields (when user is member).
