# USC MVP: Run Fully in Docker

## Quick start (development profile)

Use base + dev override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Open:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/api/health
- Frontend from another device in same network: `http://<YOUR_LAN_IP>:5173`

Find your LAN IPv4 on Windows:

```powershell
ipconfig
```

Use the `IPv4 Address` value (for example `192.168.1.25`) in URL:
`http://192.168.1.25:5173`

## Production-like start

Use base + prod override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Mentor testing profile (Netlify frontend + public backend)

This profile keeps your current local `dev` flow unchanged and adds a separate public setup for mentor access.

### 1) Run backend stack on a public host

On the backend host:

```powershell
copy .env.mentor.example .env
```

Fill real values in `.env`:
- `JWT_SECRET_KEY`
- `CORS_ALLOW_ORIGINS` with your Netlify URL
- `CORS_ALLOW_ORIGIN_REGEX` with your Netlify site pattern

Start only backend dependencies + API:

```powershell
docker compose up -d --build postgres redis backend
```

Health check:

```powershell
curl http://<BACKEND_PUBLIC_HOST>:8000/api/health
```

### 2) Seed demo data once

```powershell
docker exec -w /app usc-backend python scripts/seed_demo.py
```

### 3) Deploy frontend to Netlify

Repo already includes `netlify.toml`:
- base: `frontend`
- build: `npm ci && npm run build`
- publish: `dist`

In Netlify project settings, set required environment variable:

- `VITE_API_BASE=https://<BACKEND_PUBLIC_HOST>/api`

Optional:
- `VITE_MAP_STYLE_URL`, `VITE_MAP_DEFAULT_LAT`, `VITE_MAP_DEFAULT_LNG`, `VITE_MAP_DEFAULT_ZOOM`
- `VITE_SENTRY_*`

### 4) Verify mentor URL

Open Netlify URL and test:
1. login with demo account
2. products/orders/analytics
3. AI screen
4. order create flow

Important: Netlify hosts only frontend. PostgreSQL/Redis/FastAPI must stay on your backend host.

## Railway deployment profile (backend + frontend)

Railway deployment is documented in:
- `docs/railway-deploy.md`

Ready-to-copy env templates:
- `ops/railway/backend.env.example`
- `ops/railway/frontend.env.example`

Recommended service split on Railway:
1. Postgres service
2. Redis service
3. Backend service (root directory: `backend`)
4. Frontend service (root directory: `frontend`)

## Vercel deployment profile (frontend + backend)

Vercel deployment is documented in:
- `docs/vercel-deploy.md`

Frontend env template:
- `ops/vercel/frontend.env.example`

Important:
- Frontend and backend can run in one Vercel project.
- Set `VITE_API_BASE=/api` in Vercel env vars.
- Configure backend env vars (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET_KEY`, `API_PREFIX=/api`, `CORS_ALLOW_ORIGINS`).

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

## MVP map setup (free, no API key)

Frontend uses `MapLibre GL JS` with a free OpenFreeMap style by default:

- `VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty`
- `VITE_MAP_DEFAULT_LAT=42.8746`
- `VITE_MAP_DEFAULT_LNG=74.5698`
- `VITE_MAP_DEFAULT_ZOOM=12`

This gives an interactive delivery map in checkout without paid providers.

Attribution:
- OpenStreetMap contributors: https://www.openstreetmap.org/copyright
- OpenFreeMap: https://openfreemap.org/

If map tiles are temporarily unavailable, checkout still works with manual lat/lng input.

### Map smoke checklist (dev)

Run with dev profile:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Acceptance checklist:
1. Open Cart screen.
2. Open checkout block.
3. Click on map and ensure marker appears.
4. Ensure `lat/lng` inputs sync with selected point.
5. Click geolocation and ensure point is updated.
6. Deny geolocation permission and ensure fallback/error text is shown.
7. Create order.
8. Open order details and verify `comment` contains `[geo:lat,lng]`.

### Map runbook: if map is not loading

1. Continue checkout using manual `lat/lng` fields.
2. Verify frontend env values: `VITE_MAP_STYLE_URL`, `VITE_MAP_DEFAULT_LAT`, `VITE_MAP_DEFAULT_LNG`, `VITE_MAP_DEFAULT_ZOOM`.
3. Open browser devtools and check failed tile/style requests.
4. Try another style URL, then restart frontend container.

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

## Codex Remote (phone control)

- Detailed setup and phone connection guide:
  - `docs/codex_remote.md`
- Quick commands from project root:
  - Bootstrap: `.\scripts\codex_remote\bootstrap.ps1`
  - Start: `.\scripts\codex_remote\start.ps1`
  - Stop: `.\scripts\codex_remote\stop.ps1`
