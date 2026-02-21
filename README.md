# USC MVP: Run Fully in Docker

## Quick start (backend + frontend + postgres + redis)

```powershell
docker compose up -d --build
```

Open:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/api/health

## Stop

```powershell
docker compose down
```

## Rebuild after code changes in Dockerfiles

```powershell
docker compose up -d --build backend frontend
```

## Notes
- `docker-compose.yml` already wires:
  - `postgres` on `5432`
  - `redis` on `6379`
  - `backend` on `8000`
  - `frontend` on `5173`
- Frontend proxy points to backend service inside Docker network via `VITE_PROXY_TARGET=http://backend:8000`.
- Backend cache uses Redis via `REDIS_URL=redis://redis:6379/0` in compose env.

## Optional checks

```powershell
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
docker exec usc-redis redis-cli ping
```

Expected Redis response: `PONG`.
