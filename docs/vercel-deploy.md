# Vercel Deployment Guide (Frontend)

This repository uses a monorepo layout. Vercel is configured for frontend deployment via root `vercel.json`.

## What is deployed on Vercel

- Frontend only (`frontend/`, Vite + React)
- Backend should stay on Railway (or another backend host)

## 1) Import project to Vercel

1. Import GitHub repository `Alayar-egem/USC` in Vercel.
2. Keep project root as repository root (default).
3. `vercel.json` in repo root provides install/build/output configuration.

## 2) Configure environment variables

Set these in Vercel Project -> Settings -> Environment Variables:

- `VITE_API_BASE=https://<YOUR_BACKEND_PUBLIC_DOMAIN>/api` (required)

Optional:
- `VITE_MAP_STYLE_URL`
- `VITE_MAP_DEFAULT_LAT`
- `VITE_MAP_DEFAULT_LNG`
- `VITE_MAP_DEFAULT_ZOOM`
- `VITE_SENTRY_DSN_FRONTEND`
- `VITE_SENTRY_ENVIRONMENT`
- `VITE_SENTRY_RELEASE`
- `VITE_SENTRY_TRACES_SAMPLE_RATE`

Template: `ops/vercel/frontend.env.example`.

## 3) Deploy

1. Trigger deployment in Vercel.
2. Open deployment URL.
3. Verify that SPA routes open directly (rewrite to `index.html` is configured).

## 4) Smoke checks

1. Open frontend URL.
2. Register/login.
3. Confirm API requests go to `https://<YOUR_BACKEND_PUBLIC_DOMAIN>/api/...` in browser network tab.

## 5) Troubleshooting

If API calls fail with 404 from Vercel:
1. Verify `VITE_API_BASE` is set and ends with `/api`.
2. Redeploy after variable changes (Vite embeds env at build time).
3. Verify backend CORS allows your Vercel domain.
