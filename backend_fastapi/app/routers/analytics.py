from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import json
import threading
from typing import Optional
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.deps.auth import get_current_user
from app.db.deps import get_db
from app.db.schema import accounts_user as users
from app.db.schema import catalog_category as categories
from app.db.schema import catalog_product as products
from app.db.schema import companies_company as companies
from app.db.schema import companies_companymember as company_members
from app.db.schema import orders_order as orders
from app.db.schema import orders_orderitem as items

router = APIRouter(tags=["analytics"])

_INSIGHTS_CACHE_TTL_SECONDS = 600
_INSIGHTS_CACHE_LOCK = threading.Lock()
_INSIGHTS_CACHE: dict[tuple[int, str, int], tuple[datetime, list[str]]] = {}


class AnalyticsAssistantRequest(BaseModel):
    company_id: int = Field(..., ge=1)
    role: str = Field(default="supplier")
    days: int = Field(default=365, ge=7, le=3650)
    question: str = Field(..., min_length=2, max_length=500)
    selected_month: Optional[str] = Field(default=None)


def _pct_delta(prev: float, cur: float) -> float | None:
    if prev <= 0:
        return None
    return ((cur - prev) / prev) * 100


def _assistant_answer(summary: dict, question: str, selected_month: str | None) -> dict:
    sales = summary.get("sales_trends") or []
    market = summary.get("market_trends") or []
    funnel = summary.get("status_funnel") or []
    categories = summary.get("category_breakdown") or []
    market_info = summary.get("market") or {}

    sales_values = [float(x.get("revenue") or 0) for x in sales]
    current_sales = sales_values[-1] if sales_values else 0.0
    prev_sales = sales_values[-2] if len(sales_values) >= 2 else 0.0
    mom = _pct_delta(prev_sales, current_sales)

    focus = None
    if selected_month:
        focus = next((x for x in sales if str(x.get("month")) == selected_month), None)
    if not focus and sales:
        focus = sales[-1]

    delivered = sum(int(x.get("count") or 0) for x in funnel if str(x.get("status") or "").upper() == "DELIVERED")
    cancelled = sum(
        int(x.get("count") or 0)
        for x in funnel
        if str(x.get("status") or "").upper() in {"CANCELLED", "CANCELED"}
    )
    total = sum(int(x.get("count") or 0) for x in funnel)
    delivery_rate = (delivered / total) * 100 if total else 0.0
    cancel_rate = (cancelled / total) * 100 if total else 0.0

    top_cat = categories[0] if categories else None
    top_cat_name = str(top_cat.get("name")) if top_cat else "вЂ”"
    top_cat_share = float(top_cat.get("share_pct") or 0) if top_cat else 0.0
    share = float(market_info.get("company_share_pct") or 0)

    probable_causes: list[str] = []
    actions: list[str] = []

    if mom is not None and mom <= -10:
        probable_causes.append(
            f"Р’С‹СЂСѓС‡РєР° Р·Р° РїРѕСЃР»РµРґРЅРёР№ РјРµСЃСЏС† СЃРЅРёР·РёР»Р°СЃСЊ РЅР° {abs(mom):.1f}% Рє РїСЂРµРґС‹РґСѓС‰РµРјСѓ РїРµСЂРёРѕРґСѓ, СЌС‚Рѕ РѕСЃРЅРѕРІРЅРѕР№ РґСЂР°Р№РІРµСЂ РїСЂРѕСЃР°РґРєРё."
        )
        actions.append("Р—Р°РїСѓСЃС‚РёС‚СЊ РєРѕСЂРѕС‚РєРѕРµ РїСЂРѕРјРѕ РЅР° 7-10 РґРЅРµР№ РїРѕ С‚РѕРї-2 SKU РґР»СЏ РІРѕР·РІСЂР°С‚Р° РѕР±СЉРµРјР°.")
    elif mom is not None and mom >= 8:
        probable_causes.append(f"РќР°Р±Р»СЋРґР°РµС‚СЃСЏ СЃРёР»СЊРЅС‹Р№ СЂРѕСЃС‚ MoM: +{mom:.1f}%, СЃРїСЂРѕСЃ СѓСЃРєРѕСЂСЏРµС‚СЃСЏ.")
        actions.append("РЈРІРµР»РёС‡РёС‚СЊ СЃС‚СЂР°С…РѕРІРѕР№ РѕСЃС‚Р°С‚РѕРє РїРѕ Р»РёРґРёСЂСѓСЋС‰РёРј SKU, С‡С‚РѕР±С‹ РЅРµ РїРѕС‚РµСЂСЏС‚СЊ СЂРѕСЃС‚ РёР·-Р·Р° out-of-stock.")
    else:
        probable_causes.append("РР·РјРµРЅРµРЅРёРµ РїРѕ РјРµСЃСЏС†Сѓ СѓРјРµСЂРµРЅРЅРѕРµ, РІРµСЂРѕСЏС‚РЅРµРµ РІСЃРµРіРѕ СЌС‚Рѕ РЅРѕСЂРјР°Р»СЊРЅР°СЏ СЂС‹РЅРѕС‡РЅР°СЏ С„Р»СѓРєС‚СѓР°С†РёСЏ.")
        actions.append("РџРѕРґРґРµСЂР¶РёРІР°С‚СЊ С‚РµРєСѓС‰РёР№ РїСЂР°Р№СЃ Рё РєРѕРЅС‚СЂРѕР»РёСЂРѕРІР°С‚СЊ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ Р·Р°РєР°Р·РѕРІ РІ РїРёРєРѕРІС‹Рµ РґРЅРё.")

    if cancel_rate >= 10:
        probable_causes.append(f"Р’С‹СЃРѕРєР°СЏ РґРѕР»СЏ РѕС‚РјРµРЅ ({cancel_rate:.1f}%) СЃСЉРµРґР°РµС‚ С‡Р°СЃС‚СЊ РІС‹СЂСѓС‡РєРё.")
        actions.append("РџРѕСЃС‚Р°РІРёС‚СЊ SLA РЅР° РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ Р·Р°РєР°Р·Р° РґРѕ 30 РјРёРЅСѓС‚ Рё РјРѕРЅРёС‚РѕСЂРёС‚СЊ РґРѕР»СЋ РѕС‚РјРµРЅ РµР¶РµРґРЅРµРІРЅРѕ.")
    if delivery_rate < 70:
        probable_causes.append(f"РќРёР·РєРёР№ delivery rate ({delivery_rate:.1f}%) РѕРіСЂР°РЅРёС‡РёРІР°РµС‚ СЂРµР°Р»РёР·Р°С†РёСЋ СЃРїСЂРѕСЃР°.")
        actions.append("РЈСЃРёР»РёС‚СЊ РєРѕРЅС‚СЂРѕР»СЊ СЌС‚Р°РїРѕРІ CONFIRMED/DELIVERING, С‡С‚РѕР±С‹ Р·Р°РєСЂС‹РІР°С‚СЊ Р±РѕР»СЊС€Рµ Р·Р°РєР°Р·РѕРІ РІ DELIVERED.")

    if top_cat_share >= 55:
        probable_causes.append(f"Р’С‹СЂСѓС‡РєР° СЃРёР»СЊРЅРѕ СЃРєРѕРЅС†РµРЅС‚СЂРёСЂРѕРІР°РЅР° РІ РєР°С‚РµРіРѕСЂРёРё В«{top_cat_name}В» ({top_cat_share:.1f}%).")
        actions.append("Р”РёРІРµСЂСЃРёС„РёС†РёСЂРѕРІР°С‚СЊ Р°СЃСЃРѕСЂС‚РёРјРµРЅС‚: РґРѕР±Р°РІРёС‚СЊ 2-3 SKU РёР· РІС‚РѕСЂРѕР№ РїРѕ РґРѕР»Рµ РєР°С‚РµРіРѕСЂРёРё.")
    else:
        actions.append("РЎС„РѕРєСѓСЃРёСЂРѕРІР°С‚СЊ СЂРµРєР»Р°РјСѓ РЅР° РєР°С‚РµРіРѕСЂРёСЏС… СЃ РґРѕР»РµР№ >20% РґР»СЏ РјР°РєСЃРёРјР°Р»СЊРЅРѕРіРѕ ROMI.")

    if share < 3:
        probable_causes.append(f"Р”РѕР»СЏ РєРѕРјРїР°РЅРёРё РЅР° СЂС‹РЅРєРµ РїРѕРєР° РЅРёР·РєР°СЏ ({share:.2f}%).")
        actions.append("Р—Р°Р±СЂР°С‚СЊ РґРѕР»СЋ С‡РµСЂРµР· С†РµРЅРѕРІРѕР№ С‚РµСЃС‚: -3% РЅР° С„Р»Р°РіРјР°РЅСЃРєРёРµ С‚РѕРІР°СЂС‹ РІ С‚РµС‡РµРЅРёРµ 2 РЅРµРґРµР»СЊ.")

    if focus:
        fm = str(focus.get("month") or "")
        fv = float(focus.get("revenue") or 0)
        focus_line = f"Р¤РѕРєСѓСЃ-РјРµСЃСЏС† {fm}: РІС‹СЂСѓС‡РєР° {fv:.0f}."
    else:
        focus_line = "Р¤РѕРєСѓСЃ-РјРµСЃСЏС† РЅРµ РІС‹Р±СЂР°РЅ."

    q = question.lower()
    if "РїРѕС‡РµРјСѓ" in q:
        summary_text = (
            f"{focus_line} РљР»СЋС‡РµРІС‹Рµ С„Р°РєС‚РѕСЂС‹: РґРёРЅР°РјРёРєР° MoM, РѕС‚РјРµРЅС‹, delivery rate Рё СЃС‚СЂСѓРєС‚СѓСЂР° РєР°С‚РµРіРѕСЂРёР№."
        )
    elif "С‡С‚Рѕ РґРµР»Р°С‚СЊ" in q or "СЃРѕРІРµС‚" in q:
        summary_text = (
            f"{focus_line} РџСЂРёРѕСЂРёС‚РµС‚: СЃС‚Р°Р±РёР»РёР·РёСЂРѕРІР°С‚СЊ РёСЃРїРѕР»РЅРµРЅРёРµ Рё СѓСЃРёР»РёС‚СЊ РїСЂРѕРґР°Р¶Рё РІ СЃРёР»СЊРЅС‹С… РєР°С‚РµРіРѕСЂРёСЏС…."
        )
    else:
        summary_text = (
            f"{focus_line} РЎРѕСЃС‚РѕСЏРЅРёРµ: MoM {('вЂ”' if mom is None else f'{mom:+.1f}%')}, "
            f"delivery {delivery_rate:.1f}%, РѕС‚РјРµРЅС‹ {cancel_rate:.1f}%."
        )

    signal_count = len(probable_causes)
    confidence = min(0.95, max(0.55, 0.55 + signal_count * 0.07))

    return {
        "summary": summary_text,
        "probable_causes": probable_causes[:4],
        "actions": actions[:5],
        "confidence": round(confidence, 2),
        "focus_month": str(focus.get("month")) if focus else None,
        "show_metrics": True,
        "metrics": {
            "mom_pct": None if mom is None else round(mom, 2),
            "delivery_rate_pct": round(delivery_rate, 2),
            "cancel_rate_pct": round(cancel_rate, 2),
            "market_share_pct": round(share, 2),
            "top_category_name": top_cat_name,
            "top_category_share_pct": round(top_cat_share, 2),
        },
    }


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _looks_analytics_question(question: str) -> bool:
    q = (question or "").lower()
    if not q:
        return False
    keywords = [
        "analytics",
        "metric",
        "kpi",
        "growth",
        "revenue",
        "profit",
        "sales",
        "order",
        "delivery",
        "cancel",
        "risk",
        "forecast",
        "plan",
        "recommend",
        "advice",
        "выруч",
        "продаж",
        "заказ",
        "достав",
        "отмен",
        "риск",
        "прогноз",
        "метрик",
        "аналит",
        "что делать",
        "как улучш",
        "почему",
    ]
    return any(k in q for k in keywords)


def _contains_cyrillic(text: str) -> bool:
    return any("а" <= ch.lower() <= "я" or ch.lower() == "ё" for ch in text)


def _policy_block_response() -> dict:
    return {
        "summary": "Р­С‚РѕС‚ Р·Р°РїСЂРѕСЃ РЅР°СЂСѓС€Р°РµС‚ СѓСЃР»РѕРІРёСЏ РїРѕР»СЊР·РѕРІР°РЅРёСЏ. РџРѕР¶Р°Р»СѓР№СЃС‚Р°, РїРµСЂРµС„РѕСЂРјСѓР»РёСЂСѓР№С‚Рµ РІРѕРїСЂРѕСЃ.",
        "probable_causes": [],
        "actions": [],
        "confidence": 1.0,
        "focus_month": None,
        "show_metrics": False,
        "metrics": {
            "mom_pct": None,
            "delivery_rate_pct": 0.0,
            "cancel_rate_pct": 0.0,
            "market_share_pct": 0.0,
            "top_category_name": "вЂ”",
            "top_category_share_pct": 0.0,
        },
    }


def _looks_abusive_minimal(question: str) -> bool:
    q = (question or "").lower()
    if not q:
        return False
    # Minimal non-strict guard for explicit insults/abuse phrases.
    abusive_terms = [
        "СЃС‹РЅ Р±Р»СЏРґРё",
        "son of a bitch",
        "РїРѕС€РµР» РЅР°С…",
        "РёРґРё РЅР°С…",
        "fuck you",
        "РёРґРёРѕС‚",
        "РґРѕР»Р±Р°РµР±",
    ]
    return any(t in q for t in abusive_terms)


def _llm_policy_check(question: str) -> bool | None:
    """
    Returns:
      - True  => block question
      - False => allow question
      - None  => unable to classify (e.g. provider unavailable)
    """
    if not settings.OPENAI_API_KEY:
        return None

    policy_prompt = (
        "You are a strict safety classifier for chat input. "
        "Return ONLY JSON with keys: decision (allow|block), reason (short string). "
        "Block if message includes harassment/abuse, explicit sexual content, sexual content involving minors, "
        "violent wrongdoing instructions, illegal wrongdoing instructions, or self-harm instructions. "
        "Allow normal business questions, analytics questions, neutral small talk, and non-harmful profanity. "
        "Do not overblock."
    )
    payload = {
        "model": settings.OPENAI_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": policy_prompt},
            {"role": "user", "content": question},
        ],
    }

    req = urlrequest.Request(
        url=f"{settings.OPENAI_BASE_URL.rstrip('/')}/chat/completions",
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload).encode("utf-8"),
    )
    try:
        with urlrequest.urlopen(req, timeout=float(settings.OPENAI_TIMEOUT_SECONDS)) as resp:
            raw = resp.read().decode("utf-8")
        parsed = json.loads(raw)
        content = (((parsed.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        if not content:
            return None
        out = json.loads(content)
        decision = str(out.get("decision") or "").strip().lower()
        if decision == "block":
            return True
        if decision == "allow":
            return False
        return None
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValueError, TypeError):
        return None


def _build_actor_context(db: Session, user: dict, company_id: int, role: str, selected_month: str | None) -> dict:
    u_id = int(user.get("id"))
    user_row = db.execute(
        select(
            users.c.id,
            users.c.email,
            users.c.first_name,
            users.c.last_name,
            users.c.phone,
        ).where(users.c.id == u_id)
    ).mappings().first()
    company_row = db.execute(
        select(
            companies.c.id,
            companies.c.name,
            companies.c.company_type,
            companies.c.phone,
            companies.c.address,
        ).where(companies.c.id == company_id)
    ).mappings().first()

    full_name = ""
    if user_row:
        first = str(user_row.get("first_name") or "").strip()
        last = str(user_row.get("last_name") or "").strip()
        full_name = f"{first} {last}".strip()

    return {
        "user": {
            "id": u_id,
            "name": full_name or None,
            "email": (str(user_row.get("email")) if user_row and user_row.get("email") else None),
            "phone": (str(user_row.get("phone")) if user_row and user_row.get("phone") else None),
        },
        "company": {
            "id": company_id,
            "name": (str(company_row.get("name")) if company_row and company_row.get("name") else None),
            "type": (str(company_row.get("company_type")) if company_row and company_row.get("company_type") else None),
            "phone": (str(company_row.get("phone")) if company_row and company_row.get("phone") else None),
            "address": (str(company_row.get("address")) if company_row and company_row.get("address") else None),
        },
        "session": {
            "role": role,
            "selected_month": selected_month,
        },
    }


def _llm_assistant_answer(
    summary: dict,
    question: str,
    selected_month: str | None,
    actor_context: dict | None = None,
) -> dict | None:
    if not settings.OPENAI_API_KEY:
        return None

    compact = {
        "assistant_runtime": {
            "provider": "openai_compatible",
            "model": settings.OPENAI_MODEL,
        },
        "actor_context": actor_context or {},
        "company_id": summary.get("company_id"),
        "role": summary.get("role"),
        "days": summary.get("days"),
        "total_orders": int(summary.get("total_orders") or 0),
        "total_revenue": _safe_float(summary.get("total_revenue")),
        "market": summary.get("market") or {},
        "sales_trends": (summary.get("sales_trends") or [])[-12:],
        "market_trends": (summary.get("market_trends") or [])[-12:],
        "category_breakdown_top": (summary.get("category_breakdown") or [])[:5],
        "status_funnel": summary.get("status_funnel") or [],
        "insights": summary.get("insights") or [],
        "selected_month": selected_month,
        "question": question,
    }

    system_prompt = (
        "You are an analytics assistant for a B2B supply app. "
        "Always answer directly and use provided metrics as evidence. "
        "If the user asks an analytics/business question (causes, risks, growth, plan, priorities, what to do), "
        "return actionable guidance: probable_causes must contain 2-4 items and actions must contain 3-5 concrete steps. "
        "Actions must be prioritized, practical, and tied to the numbers in context. "
        "Summary should be concise (2-4 sentences) and explain what is happening in the data. "
        "If data is insufficient, say so explicitly and avoid invented facts. "
        "Use actor_context for personalization when relevant. "
        "If input is abusive/sexual/illegal-harmful, refuse with exactly: "
        "'Этот запрос нарушает условия пользования. Пожалуйста, переформулируйте вопрос.' "
        "and set probable_causes/actions empty and show_metrics=false. "
        "For non-analytics small talk, reply briefly, probable_causes/actions empty, show_metrics=false. "
        "Return STRICT JSON only with keys: summary (string), probable_causes (string[]), actions (string[]), "
        "confidence (number 0..1), focus_month (string|null), metrics (object: mom_pct, delivery_rate_pct, "
        "cancel_rate_pct, market_share_pct, top_category_name, top_category_share_pct), show_metrics (boolean)."
    )
    payload = {
        "model": settings.OPENAI_MODEL,
        "temperature": 0.45,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(compact, ensure_ascii=False)},
        ],
    }

    req = urlrequest.Request(
        url=f"{settings.OPENAI_BASE_URL.rstrip('/')}/chat/completions",
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload).encode("utf-8"),
    )
    try:
        with urlrequest.urlopen(req, timeout=float(settings.OPENAI_TIMEOUT_SECONDS)) as resp:
            raw = resp.read().decode("utf-8")
        parsed = json.loads(raw)
        content = (((parsed.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        if not content:
            return None
        out = json.loads(content)
        if not isinstance(out, dict):
            return None
        metrics = out.get("metrics") or {}
        return {
            "summary": str(out.get("summary") or ""),
            "probable_causes": [str(x) for x in (out.get("probable_causes") or [])][:4],
            "actions": [str(x) for x in (out.get("actions") or [])][:5],
            "confidence": max(0.0, min(1.0, _safe_float(out.get("confidence"), 0.7))),
            "focus_month": out.get("focus_month"),
            "show_metrics": bool(out.get("show_metrics", True)),
            "metrics": {
                "mom_pct": None if metrics.get("mom_pct") is None else _safe_float(metrics.get("mom_pct")),
                "delivery_rate_pct": _safe_float(metrics.get("delivery_rate_pct")),
                "cancel_rate_pct": _safe_float(metrics.get("cancel_rate_pct")),
                "market_share_pct": _safe_float(metrics.get("market_share_pct")),
                "top_category_name": str(metrics.get("top_category_name") or "вЂ”"),
                "top_category_share_pct": _safe_float(metrics.get("top_category_share_pct")),
            },
        }
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValueError, TypeError):
        return None


def _company_ids_for_user(db: Session, user_id: int) -> list[int]:
    return [
        int(r[0])
        for r in db.execute(select(company_members.c.company_id).where(company_members.c.user_id == user_id)).all()
    ]


def _month_key(value: str | date | datetime | None) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m")
    if isinstance(value, date):
        return value.strftime("%Y-%m")
    text = str(value)
    if len(text) >= 7:
        return text[:7]
    return text


def _get_cached_insights(company_id: int, role: str, days: int) -> list[str] | None:
    key = (company_id, role, days)
    now = datetime.now(timezone.utc)
    with _INSIGHTS_CACHE_LOCK:
        item = _INSIGHTS_CACHE.get(key)
        if not item:
            return None
        expires_at, value = item
        if expires_at <= now:
            _INSIGHTS_CACHE.pop(key, None)
            return None
        return value[:]


def _set_cached_insights(company_id: int, role: str, days: int, insights: list[str]) -> None:
    key = (company_id, role, days)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_INSIGHTS_CACHE_TTL_SECONDS)
    with _INSIGHTS_CACHE_LOCK:
        _INSIGHTS_CACHE[key] = (expires_at, insights[:3])


def _llm_generate_insights(summary_payload: dict) -> list[str] | None:
    if not settings.OPENAI_API_KEY:
        return None

    prompt = (
        "Ты генерируешь короткие бизнес-инсайты для карточки аналитики. "
        "Пиши СТРОГО на русском языке. "
        "Верни ТОЛЬКО JSON формата: {\"insights\": [\"...\", \"...\", \"...\"]}. "
        "Правила: 2-3 пункта, каждый пункт в 1 предложении, конкретно и по данным из payload, без markdown."
    )
    payload = {
        "model": settings.OPENAI_MODEL,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(summary_payload, ensure_ascii=False)},
        ],
    }

    req = urlrequest.Request(
        url=f"{settings.OPENAI_BASE_URL.rstrip('/')}/chat/completions",
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload).encode("utf-8"),
    )

    try:
        with urlrequest.urlopen(req, timeout=float(settings.OPENAI_TIMEOUT_SECONDS)) as resp:
            raw = resp.read().decode("utf-8")
        parsed = json.loads(raw)
        content = (((parsed.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        if not content:
            return None
        out = json.loads(content)
        items = out.get("insights")
        if not isinstance(items, list):
            return None
        clean = [str(x).strip() for x in items if str(x).strip()]
        if clean and not any(_contains_cyrillic(x) for x in clean):
            return None
        return clean[:3] if clean else None
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValueError, TypeError):
        return None


def _build_insights(
    sales_trends: list[dict],
    category_breakdown: list[dict],
    status_funnel: list[dict],
) -> list[str]:
    out: list[str] = []

    if len(sales_trends) >= 2:
        prev = float(sales_trends[-2]["revenue"])
        cur = float(sales_trends[-1]["revenue"])
        if prev > 0:
            delta_pct = ((cur - prev) / prev) * 100
            if delta_pct >= 5:
                out.append(f"Выручка за последний месяц выросла на {delta_pct:.1f}% — закрепите рост через приоритетные SKU.")
            elif delta_pct <= -5:
                out.append(f"Выручка за последний месяц снизилась на {abs(delta_pct):.1f}% — проверьте цену, остатки и конверсию.")
        elif cur > 0:
            out.append("В последнем месяце появились оплаченные поставки — можно масштабировать рабочую воронку.")

    top_cat = category_breakdown[0] if category_breakdown else None
    if top_cat and float(top_cat.get("share_pct", 0)) >= 55:
        out.append(
            f"Высокая концентрация в категории «{top_cat.get('name')}»: {float(top_cat.get('share_pct')):.1f}% выручки."
        )

    total = sum(int(x.get("count") or 0) for x in status_funnel)
    cancelled = 0
    for x in status_funnel:
        status = str(x.get("status") or "").upper()
        if status in {"CANCELLED", "CANCELED"}:
            cancelled += int(x.get("count") or 0)
    if total > 0:
        cancelled_share = (cancelled / total) * 100
        if cancelled_share >= 15:
            out.append(f"Доля отмен высокая ({cancelled_share:.1f}%) — усилите SLA подтверждения и контроль наличия.")
        elif cancelled_share == 0:
            out.append("Отмен за период не было — операционная дисциплина на хорошем уровне.")

    if not out:
        out.append("Недостаточно данных для устойчивых выводов — накопите больше заказов за период.")
    return out[:3]


@router.get("/analytics/summary/")
def analytics_summary(
    company_id: int = Query(..., ge=1),
    role: str = Query("supplier"),
    days: int = Query(180, ge=7, le=3650),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    u_id = int(user["id"])
    if company_id not in _company_ids_for_user(db, u_id):
        raise HTTPException(403, detail="Not allowed")

    role_norm = (role or "").strip().lower()
    if role_norm not in {"supplier", "buyer"}:
        role_norm = "supplier"

    company_col = orders.c.supplier_company_id if role_norm == "supplier" else orders.c.buyer_company_id
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)

    delivered_company = (
        select(orders.c.id, orders.c.created_at)
        .where(
            company_col == company_id,
            orders.c.status == "DELIVERED",
            orders.c.created_at >= since_dt,
        )
        .subquery()
    )

    total_orders = db.execute(select(func.count()).select_from(delivered_company)).scalar_one()

    total_revenue = db.execute(
        select(func.coalesce(func.sum(items.c.qty * items.c.price_snapshot), 0))
        .select_from(items.join(delivered_company, items.c.order_id == delivered_company.c.id))
    ).scalar_one()

    daily_rows = db.execute(
        select(
            func.date(delivered_company.c.created_at).label("day"),
            func.coalesce(func.sum(items.c.qty * items.c.price_snapshot), 0).label("revenue"),
        )
        .select_from(items.join(delivered_company, items.c.order_id == delivered_company.c.id))
        .group_by(func.date(delivered_company.c.created_at))
        .order_by(func.date(delivered_company.c.created_at))
    ).all()

    top_rows = db.execute(
        select(
            items.c.product_id.label("product_id"),
            products.c.name.label("name"),
            func.coalesce(func.sum(items.c.qty * items.c.price_snapshot), 0).label("revenue"),
            func.coalesce(func.sum(items.c.qty), 0).label("qty_total"),
        )
        .select_from(
            items.join(delivered_company, items.c.order_id == delivered_company.c.id).join(
                products, items.c.product_id == products.c.id
            )
        )
        .group_by(items.c.product_id, products.c.name)
        .order_by(func.sum(items.c.qty * items.c.price_snapshot).desc())
        .limit(10)
    ).all()

    sales_month_rows = db.execute(
        select(
            func.date_trunc("month", delivered_company.c.created_at).label("month"),
            func.coalesce(func.sum(items.c.qty * items.c.price_snapshot), 0).label("revenue"),
        )
        .select_from(items.join(delivered_company, items.c.order_id == delivered_company.c.id))
        .group_by(func.date_trunc("month", delivered_company.c.created_at))
        .order_by(func.date_trunc("month", delivered_company.c.created_at))
    ).all()

    delivered_market = (
        select(orders.c.id, orders.c.created_at)
        .where(
            orders.c.status == "DELIVERED",
            orders.c.created_at >= since_dt,
        )
        .subquery()
    )

    market_revenue = db.execute(
        select(func.coalesce(func.sum(items.c.qty * items.c.price_snapshot), 0))
        .select_from(items.join(delivered_market, items.c.order_id == delivered_market.c.id))
    ).scalar_one()
    market_orders = db.execute(select(func.count()).select_from(delivered_market)).scalar_one()

    market_month_rows = db.execute(
        select(
            func.date_trunc("month", delivered_market.c.created_at).label("month"),
            func.coalesce(func.sum(items.c.qty * items.c.price_snapshot), 0).label("revenue"),
        )
        .select_from(items.join(delivered_market, items.c.order_id == delivered_market.c.id))
        .group_by(func.date_trunc("month", delivered_market.c.created_at))
        .order_by(func.date_trunc("month", delivered_market.c.created_at))
    ).all()

    cat_rows = db.execute(
        select(
            func.coalesce(categories.c.name, "Без категории").label("name"),
            func.coalesce(func.sum(items.c.qty * items.c.price_snapshot), 0).label("revenue"),
        )
        .select_from(
            items.join(delivered_company, items.c.order_id == delivered_company.c.id)
            .join(products, items.c.product_id == products.c.id)
            .outerjoin(categories, products.c.category_id == categories.c.id)
        )
        .group_by(func.coalesce(categories.c.name, "Без категории"))
        .order_by(func.sum(items.c.qty * items.c.price_snapshot).desc())
    ).all()

    status_rows = db.execute(
        select(
            orders.c.status.label("status"),
            func.count().label("count"),
        )
        .where(company_col == company_id, orders.c.created_at >= since_dt)
        .group_by(orders.c.status)
        .order_by(
            case(
                (orders.c.status == "PENDING", 1),
                (orders.c.status == "CONFIRMED", 2),
                (orders.c.status == "DELIVERING", 3),
                (orders.c.status == "DELIVERED", 4),
                (orders.c.status == "CANCELLED", 5),
                else_=9,
            )
        )
    ).all()

    daily_revenue = [
        {"day": str(row.day) if isinstance(row.day, date) else str(row.day), "revenue": float(row.revenue or 0)}
        for row in daily_rows
    ]

    top_products = [
        {
            "product_id": int(row.product_id),
            "name": row.name,
            "revenue": float(row.revenue or 0),
            "qty_total": float(row.qty_total or 0),
        }
        for row in top_rows
    ]

    sales_trends = [{"month": _month_key(r.month), "revenue": float(r.revenue or 0)} for r in sales_month_rows]
    market_trends = [{"month": _month_key(r.month), "revenue": float(r.revenue or 0)} for r in market_month_rows]

    cat_total = sum(float(r.revenue or 0) for r in cat_rows)
    category_breakdown = [
        {
            "name": str(r.name),
            "revenue": float(r.revenue or 0),
            "share_pct": round((float(r.revenue or 0) / cat_total) * 100, 2) if cat_total > 0 else 0,
        }
        for r in cat_rows
    ]

    status_funnel = [{"status": str(r.status), "count": int(r.count or 0)} for r in status_rows]
    base_insights = _build_insights(sales_trends=sales_trends, category_breakdown=category_breakdown, status_funnel=status_funnel)

    market_revenue_f = float(market_revenue or 0)
    total_revenue_f = float(total_revenue or 0)
    company_share_pct = round((total_revenue_f / market_revenue_f) * 100, 2) if market_revenue_f > 0 else 0
    insights = _get_cached_insights(company_id=company_id, role=role_norm, days=days) or base_insights
    if insights is base_insights and settings.OPENAI_API_KEY:
        llm_insights = _llm_generate_insights(
            {
                "company_id": company_id,
                "role": role_norm,
                "days": days,
                "total_orders": int(total_orders or 0),
                "total_revenue": total_revenue_f,
                "market": {
                    "platform_revenue": market_revenue_f,
                    "platform_orders": int(market_orders or 0),
                    "company_share_pct": company_share_pct,
                },
                "sales_trends": sales_trends[-12:],
                "category_breakdown_top": category_breakdown[:5],
                "status_funnel": status_funnel,
                "fallback_insights": base_insights,
            }
        )
        if llm_insights:
            insights = llm_insights[:3]
            _set_cached_insights(company_id=company_id, role=role_norm, days=days, insights=insights)

    return {
        "company_id": company_id,
        "role": role_norm,
        "days": days,
        "total_orders": int(total_orders or 0),
        "total_revenue": total_revenue_f,
        "daily_revenue": daily_revenue,
        "top_products": top_products,
        "market": {
            "platform_revenue": market_revenue_f,
            "platform_orders": int(market_orders or 0),
            "company_share_pct": company_share_pct,
        },
        "market_trends": market_trends,
        "sales_trends": sales_trends,
        "category_breakdown": category_breakdown,
        "status_funnel": status_funnel,
        "insights": insights,
    }


@router.post("/analytics/assistant/query")
def analytics_assistant_query(
    payload: AnalyticsAssistantRequest,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Do not spend extra LLM request for moderation (quota-sensitive).
    # Use model prompt policy + a small explicit abuse guard.
    if _looks_abusive_minimal(payload.question):
        return _policy_block_response()

    actor_context = _build_actor_context(
        db=db,
        user=user,
        company_id=payload.company_id,
        role=payload.role,
        selected_month=payload.selected_month,
    )
    summary = analytics_summary(
        company_id=payload.company_id,
        role=payload.role,
        days=payload.days,
        user=user,
        db=db,
    )
    llm = _llm_assistant_answer(
        summary=summary,
        question=payload.question,
        selected_month=payload.selected_month,
        actor_context=actor_context,
    )
    if llm is not None:
        # Guarantee practical recommendations for analytics questions.
        if _looks_analytics_question(payload.question):
            if not llm.get("probable_causes") or not llm.get("actions"):
                fallback = _assistant_answer(summary=summary, question=payload.question, selected_month=payload.selected_month)
                if not llm.get("probable_causes"):
                    llm["probable_causes"] = fallback.get("probable_causes", [])
                if not llm.get("actions"):
                    llm["actions"] = fallback.get("actions", [])
                if not llm.get("summary"):
                    llm["summary"] = fallback.get("summary", "")
                llm["show_metrics"] = bool(llm.get("show_metrics", True))
        return llm
    return _assistant_answer(summary=summary, question=payload.question, selected_month=payload.selected_month)

