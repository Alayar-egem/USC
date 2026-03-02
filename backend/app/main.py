import logging
import time
import uuid

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.observability import observe_http_request, request_route_template, sentry_before_send
from app.routers import analytics, auth, categories, companies, deliveries, health, notifications, orders, products, profile

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("usc.api")

if settings.SENTRY_DSN_BACKEND:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN_BACKEND,
        environment=settings.SENTRY_ENVIRONMENT,
        release=settings.SENTRY_RELEASE or None,
        traces_sample_rate=max(0.0, min(1.0, float(settings.SENTRY_TRACES_SAMPLE_RATE or 0.0))),
        before_send=sentry_before_send,
    )
    logger.info("Sentry backend integration enabled")

app = FastAPI(title="USC API (FastAPI)", version="0.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"^http://\d{1,3}(?:\.\d{1,3}){3}:5173$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id
    if settings.SENTRY_DSN_BACKEND:
        sentry_sdk.set_tag("service", "backend")
        sentry_sdk.set_tag("request_id", request_id)
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_seconds = time.perf_counter() - start
    elapsed_ms = elapsed_seconds * 1000
    response.headers["x-request-id"] = request_id
    observe_http_request(
        method=request.method,
        route=request_route_template(request),
        status_code=response.status_code,
        duration_seconds=elapsed_seconds,
    )
    logger.info(
        "request_id=%s method=%s path=%s status=%s latency_ms=%.2f",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


app.include_router(health.router, prefix=settings.API_PREFIX)
app.include_router(analytics.router, prefix=settings.API_PREFIX)
app.include_router(categories.router, prefix=settings.API_PREFIX)
app.include_router(products.router, prefix=settings.API_PREFIX)
app.include_router(companies.router, prefix=settings.API_PREFIX)
app.include_router(orders.router, prefix=settings.API_PREFIX)
app.include_router(auth.router, prefix=settings.API_PREFIX)
app.include_router(profile.router, prefix=settings.API_PREFIX)
app.include_router(deliveries.router, prefix=settings.API_PREFIX)
app.include_router(notifications.router, prefix=settings.API_PREFIX)
