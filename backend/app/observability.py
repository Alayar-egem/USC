from __future__ import annotations

from typing import Any

from fastapi import Request

try:
    from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
except Exception:  # pragma: no cover - fallback for environments without prometheus_client
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"
    Counter = None
    Histogram = None
    generate_latest = None


def _sanitize(value: str | None) -> str:
    if not value:
        return "unknown"
    return (
        str(value)
        .strip()
        .lower()
        .replace(" ", "_")
        .replace("/", "_")
        .replace("-", "_")
        .replace(":", "_")
        .replace("|", "_")
    ) or "unknown"


HTTP_REQUESTS_TOTAL = (
    Counter(
        "http_requests_total",
        "Total HTTP requests processed by FastAPI app.",
        ["method", "route", "status"],
    )
    if Counter
    else None
)

HTTP_REQUEST_DURATION_SECONDS = (
    Histogram(
        "http_request_duration_seconds",
        "Latency of HTTP requests in seconds.",
        ["method", "route"],
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
    )
    if Histogram
    else None
)

AUTH_LOGIN_ATTEMPTS_TOTAL = (
    Counter(
        "auth_login_attempts_total",
        "Total login attempts by result.",
        ["result"],
    )
    if Counter
    else None
)

RATE_LIMIT_HITS_TOTAL = (
    Counter(
        "rate_limit_hits_total",
        "Rate limit breaches by endpoint and key type.",
        ["endpoint", "key_type"],
    )
    if Counter
    else None
)

DB_QUERY_FAILURES_TOTAL = (
    Counter(
        "db_query_failures_total",
        "Database query failures observed by endpoint/action.",
        ["endpoint"],
    )
    if Counter
    else None
)


def get_metrics_payload() -> tuple[bytes, str]:
    if not generate_latest:
        return b"# prometheus_client is unavailable\n", CONTENT_TYPE_LATEST
    return generate_latest(), CONTENT_TYPE_LATEST


def observe_http_request(*, method: str, route: str, status_code: int, duration_seconds: float) -> None:
    labels = {
        "method": _sanitize(method),
        "route": _sanitize(route),
        "status": str(int(status_code)),
    }
    if HTTP_REQUESTS_TOTAL:
        HTTP_REQUESTS_TOTAL.labels(**labels).inc()
    if HTTP_REQUEST_DURATION_SECONDS:
        HTTP_REQUEST_DURATION_SECONDS.labels(method=labels["method"], route=labels["route"]).observe(
            max(0.0, float(duration_seconds))
        )


def observe_login_attempt(*, result: str) -> None:
    if AUTH_LOGIN_ATTEMPTS_TOTAL:
        AUTH_LOGIN_ATTEMPTS_TOTAL.labels(result=_sanitize(result)).inc()


def observe_rate_limit_hit(*, endpoint: str, key_type: str) -> None:
    if RATE_LIMIT_HITS_TOTAL:
        RATE_LIMIT_HITS_TOTAL.labels(endpoint=_sanitize(endpoint), key_type=_sanitize(key_type)).inc()


def observe_db_query_failure(*, endpoint: str) -> None:
    if DB_QUERY_FAILURES_TOTAL:
        DB_QUERY_FAILURES_TOTAL.labels(endpoint=_sanitize(endpoint)).inc()


def request_route_template(request: Request) -> str:
    try:
        route = request.scope.get("route")
        path = getattr(route, "path", None)
        if isinstance(path, str) and path:
            return path
    except Exception:
        pass
    return request.url.path


def sentry_before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        if isinstance(headers, dict):
            for key in list(headers.keys()):
                key_l = str(key).lower()
                if key_l in {"authorization", "cookie", "x-api-key"}:
                    headers[key] = "[redacted]"
        data = request.get("data")
        if isinstance(data, dict):
            for key in list(data.keys()):
                key_l = str(key).lower()
                if key_l in {"password", "token", "refresh", "access", "captcha_token", "code", "otp"}:
                    data[key] = "[redacted]"
    return event
