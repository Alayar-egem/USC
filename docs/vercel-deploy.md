# Vercel Deployment Guide (Frontend + Backend)

This repository can run fully on Vercel in one project:
- Frontend static build from `frontend/`
- Backend FastAPI via Vercel Python Function at `api/index.py`

Important:
- You still need PostgreSQL and Redis endpoints.
- You can use Vercel-managed services or any external providers.

## 1) Import project to Vercel

1. Import GitHub repository `Alayar-egem/USC`.
2. Keep project root as repository root.
3. `vercel.json` already configures frontend build/output and SPA rewrites while preserving `/api/*`.

## 2) Configure environment variables

Use templates:
- `ops/vercel/frontend.env.example`
- `ops/vercel/backend.env.example`

Required frontend variable:
- `VITE_API_BASE=/api`

Required backend variables:
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET_KEY`
- `API_PREFIX=/api`
- `CORS_ALLOW_ORIGINS=https://<YOUR_VERCEL_DOMAIN>`

Optional:
- SMTP (`SMTP_*`)
- Sentry (`SENTRY_*`, `VITE_SENTRY_*`)
- map defaults (`VITE_MAP_*`)

## 3) Deploy

1. Trigger deployment.
2. Verify frontend URL loads.
3. Verify backend health endpoint:
   - `https://<YOUR_VERCEL_DOMAIN>/api/health`

## 4) Apply database migrations

Vercel serverless functions do not run migrations automatically. Run once after setting `DATABASE_URL`:

```powershell
pip install -r backend/requirements.txt
cd backend
alembic upgrade head
```

If you run migrations from CI/CD, use the same command there with production DB credentials.

## 5) Smoke checks

1. Open frontend URL.
2. Register/login.
3. Ensure network calls hit same domain under `/api/...`.
4. Open products/orders/analytics screens.

## 6) Troubleshooting

If API calls return HTML 404:
1. Verify `VITE_API_BASE=/api`.
2. Verify `API_PREFIX=/api`.
3. Redeploy after env changes.
4. Verify `CORS_ALLOW_ORIGINS` contains your exact Vercel domain.
