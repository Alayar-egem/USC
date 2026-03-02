import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://usc:usc123@127.0.0.1:5432/usc_db")

from fastapi.testclient import TestClient

from app.main import app


def test_health_ok():
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_health_cache_shape():
    client = TestClient(app)
    r = client.get("/api/health/cache")
    assert r.status_code == 200
    data = r.json()
    assert "redis_enabled" in data
    assert "redis_ping" in data
    assert "redis_prefix" in data
    assert "sample_keys_count" in data
    assert "cache_write_test" in data


def test_health_llm_shape():
    client = TestClient(app)
    r = client.get("/api/health/llm")
    assert r.status_code == 200
    data = r.json()
    assert "provider" in data
    assert "configured" in data
    assert "ok" in data


def test_metrics_available():
    client = TestClient(app)
    r = client.get("/api/metrics")
    assert r.status_code == 200
    assert "http_requests_total" in r.text
