# Railway Deployment Guide (Backend + Frontend)

This project is a monorepo and should be deployed as separate Railway services:
- `backend` service (FastAPI)
- `frontend` service (Vite preview server)
- `Postgres` service (Railway template/plugin)
- `Redis` service (Railway template/plugin)

## 1) Create Railway services

Create a Railway project and add:
1. PostgreSQL service.
2. Redis service.
3. Backend service from this repository with **Root Directory** = `backend`.
4. Frontend service from this repository with **Root Directory** = `frontend`.

Both app services use Dockerfiles already present in their root directories.

## 2) Configure backend service variables

Start from `ops/railway/backend.env.example`.

Required:
- `DATABASE_URL` -> reference Railway Postgres connection URL.
- `REDIS_URL` -> reference Railway Redis connection URL.
- `JWT_SECRET_KEY` -> strong random secret (32+ chars).
- `API_PREFIX=/api`
- `CORS_ALLOW_ORIGINS=https://<YOUR_FRONTEND_PUBLIC_DOMAIN>`

Recommended for demo/staging:
- `EMAIL_CODE_DEV_FALLBACK=true`
- `AUTO_SEED_DEMO=false`
- `METRICS_ENABLED=true`
- `RATE_LIMIT_ENABLED=true`

Recommended for production:
- `EMAIL_CODE_DEV_FALLBACK=false` plus real SMTP settings (`SMTP_*`).
- Configure `SENTRY_*` if you want tracing/error monitoring.

Backend healthcheck path in Railway:
- `/api/health`

## 3) Configure frontend service variables

Start from `ops/railway/frontend.env.example`.

Required:
- `VITE_API_BASE=https://<YOUR_BACKEND_PUBLIC_DOMAIN>/api`

Optional:
- `VITE_MAP_STYLE_URL`
- `VITE_MAP_DEFAULT_LAT`
- `VITE_MAP_DEFAULT_LNG`
- `VITE_MAP_DEFAULT_ZOOM`
- `VITE_SENTRY_*`

Important:
- `VITE_API_BASE` is used at frontend build time.
- After changing `VITE_API_BASE`, redeploy frontend so the new value is baked into the bundle.

## 4) Deploy order and verification

Recommended order:
1. Deploy Postgres + Redis.
2. Deploy backend.
3. Verify backend: `https://<BACKEND_PUBLIC_DOMAIN>/api/health`
4. Deploy frontend.

Smoke check:
1. Open frontend URL.
2. Request email/phone code.
3. Register/login.
4. Open products/orders/analytics screens.

## 5) Troubleshooting checklist

If frontend shows `404` for `/auth/login/`:
1. Verify frontend env `VITE_API_BASE` points to backend URL with `/api` suffix.
2. Verify backend URL is reachable and returns 200 on `/api/health`.
3. Verify backend `CORS_ALLOW_ORIGINS` includes exact frontend public URL.
4. Redeploy frontend after env changes.

If backend deploy fails on startup:
1. Check `DATABASE_URL` and `REDIS_URL` are populated from Railway services.
2. Check database migrations logs (`alembic upgrade head`).
3. Ensure `JWT_SECRET_KEY` is set.
