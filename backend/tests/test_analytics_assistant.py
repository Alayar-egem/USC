import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://usc:usc123@127.0.0.1:5432/usc_db")

from app.routers.analytics import _assistant_answer, _sanitize_assistant_line


def test_assistant_answer_shape():
    summary = {
        "market": {"company_share_pct": 4.2},
        "sales_trends": [
            {"month": "2026-01", "revenue": 100000},
            {"month": "2026-02", "revenue": 110000},
        ],
        "market_trends": [
            {"month": "2026-01", "revenue": 400000},
            {"month": "2026-02", "revenue": 430000},
        ],
        "category_breakdown": [{"name": "Meat", "share_pct": 61.3, "revenue": 70000}],
        "status_funnel": [
            {"status": "DELIVERED", "count": 50},
            {"status": "CANCELLED", "count": 3},
        ],
    }
    out = _assistant_answer(summary, "что делать", "2026-02")
    assert isinstance(out, dict)
    assert isinstance(out.get("summary"), str)
    assert isinstance(out.get("probable_causes"), list)
    assert isinstance(out.get("actions"), list)
    assert "metrics" in out
    assert "delivery_rate_pct" in out["metrics"]


def test_assistant_answer_why_question_returns_causes_only():
    summary = {
        "market": {"company_share_pct": 4.2},
        "sales_trends": [
            {"month": "2026-01", "revenue": 100000},
            {"month": "2026-02", "revenue": 80000},
        ],
        "category_breakdown": [{"name": "Meat", "share_pct": 61.3, "revenue": 70000}],
        "status_funnel": [
            {"status": "DELIVERED", "count": 50},
            {"status": "CANCELLED", "count": 3},
        ],
    }
    out = _assistant_answer(summary, "почему просела выручка?", "2026-02")
    assert out.get("probable_causes")
    assert out.get("actions") == []


def test_assistant_answer_actions_question_returns_actions_only():
    summary = {
        "market": {"company_share_pct": 4.2},
        "sales_trends": [
            {"month": "2026-01", "revenue": 100000},
            {"month": "2026-02", "revenue": 80000},
        ],
        "category_breakdown": [{"name": "Meat", "share_pct": 61.3, "revenue": 70000}],
        "status_funnel": [
            {"status": "DELIVERED", "count": 50},
            {"status": "CANCELLED", "count": 3},
        ],
    }
    out = _assistant_answer(summary, "что делать с просадкой?", "2026-02")
    assert out.get("actions")
    assert out.get("probable_causes") == []


def test_sanitize_assistant_line_strips_technical_prefix():
    raw = "1. analytics_modules.actions.buyer_switch_cheaper: Переключите закупку на альтернативу."
    cleaned = _sanitize_assistant_line(raw)
    assert cleaned == "Переключите закупку на альтернативу."
