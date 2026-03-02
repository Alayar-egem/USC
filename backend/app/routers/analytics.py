from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
import httpx
import json
import re
import threading
from typing import AsyncIterator, Optional
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.cache.redis_cache import get_json, make_key, set_json, stable_hash
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


def _assistant_question_intent(question: str) -> tuple[bool, bool]:
    q = (question or "").lower()
    cause_markers = [
        "почему",
        "причин",
        "причина",
        "из-за",
        "отчего",
        "why",
        "reason",
        "root cause",
    ]
    action_markers = [
        "что делать",
        "что мне делать",
        "как улучш",
        "как поднять",
        "что посоветуешь",
        "совет",
        "план",
        "действ",
        "next step",
        "action",
    ]
    wants_causes = any(marker in q for marker in cause_markers)
    wants_actions = any(marker in q for marker in action_markers)
    return wants_causes, wants_actions


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
    top_cat_name = str(top_cat.get("name")) if top_cat else "—"
    top_cat_share = float(top_cat.get("share_pct") or 0) if top_cat else 0.0
    share = float(market_info.get("company_share_pct") or 0)

    raw_causes: list[str] = []
    raw_actions: list[str] = []
    buyer_recommendations = summary.get("buyer_recommendations") or {}
    analytics_modules = summary.get("analytics_modules") or {}
    module_alerts = analytics_modules.get("alerts") or []
    module_actions = analytics_modules.get("actions") or []
    cheaper_alternatives = buyer_recommendations.get("cheaper_alternatives") or []
    reliable_suppliers = buyer_recommendations.get("reliable_suppliers") or []

    if mom is not None and mom <= -10:
        raw_causes.append(
            f"Выручка за последний месяц снизилась на {abs(mom):.1f}% к предыдущему периоду, это основной драйвер просадки."
        )
        raw_actions.append("Запустить короткое промо на 7-10 дней по топ-2 SKU для возврата объема.")
    elif mom is not None and mom >= 8:
        raw_causes.append(f"Наблюдается сильный рост MoM: +{mom:.1f}%, спрос ускоряется.")
        raw_actions.append(
            "Увеличить страховой остаток по лидирующим SKU, чтобы не потерять рост из-за out-of-stock."
        )

    if cancel_rate >= 10:
        raw_causes.append(f"Высокая доля отмен ({cancel_rate:.1f}%) съедает часть выручки.")
        raw_actions.append("Поставить SLA на подтверждение заказа до 30 минут и мониторить долю отмен ежедневно.")
    if delivery_rate < 70:
        raw_causes.append(f"Низкий delivery rate ({delivery_rate:.1f}%) ограничивает реализацию спроса.")
        raw_actions.append("Усилить контроль этапов CONFIRMED/DELIVERING, чтобы закрывать больше заказов в DELIVERED.")

    if top_cat_share >= 55:
        raw_causes.append(
            f"Выручка сильно сконцентрирована в категории «{top_cat_name}» ({top_cat_share:.1f}%)."
        )
        raw_actions.append("Диверсифицировать ассортимент: добавить 2-3 SKU из второй по доле категории.")

    if share < 3:
        raw_causes.append(f"Доля компании на рынке пока низкая ({share:.2f}%).")
        raw_actions.append("Забрать долю через ценовой тест: -3% на флагманские товары в течение 2 недель.")

    if str(summary.get("role") or "").lower() == "buyer":
        if cheaper_alternatives:
            alt = cheaper_alternatives[0]
            raw_actions.append(
                f"Для {alt.get('anchor_product_name')} переключите часть закупок на "
                f"{alt.get('candidate_supplier_name')} ({alt.get('candidate_product_name')}): "
                f"экономия до {float(alt.get('savings_pct') or 0):.1f}%."
            )
        if reliable_suppliers:
            top_supplier = reliable_suppliers[0]
            raw_actions.append(
                f"Увеличьте долю заказов у {top_supplier.get('supplier_name')} "
                f"(надежность {float(top_supplier.get('score') or 0):.1f}/100) для снижения операционного риска."
            )
    else:
        supplier_module = analytics_modules.get("supplier") or {}
        price_mod = supplier_module.get("price_competitiveness") or {}
        top_overpriced = (price_mod.get("top_overpriced_skus") or [None])[0]
        if top_overpriced:
            raw_actions.append(
                f"Скорректируйте цену на {top_overpriced.get('name')}: отклонение от медианы рынка "
                f"{float(top_overpriced.get('gap_pct') or 0):.1f}%."
            )

    if module_alerts:
        alert = module_alerts[0]
        raw_causes.append(
            f"{str(alert.get('title') or 'Сигнал')}: {str(alert.get('message') or '').strip()}"
        )
    if module_actions:
        for action in module_actions[:2]:
            impact_abs = action.get("expected_impact_abs")
            impact_pct = action.get("expected_impact_pct")
            impact_hint = ""
            if impact_abs is not None:
                impact_hint = f" Оценка эффекта: ~{float(impact_abs):.0f} сом."
            elif impact_pct is not None:
                impact_hint = f" Оценка эффекта: ~{float(impact_pct):.1f}%."
            raw_actions.append(f"{str(action.get('title') or '')}: {str(action.get('rationale') or '').strip()}{impact_hint}")

    if focus:
        fm = str(focus.get("month") or "")
        fv = float(focus.get("revenue") or 0)
        focus_line = f"Фокус-месяц {fm}: выручка {fv:.0f}."
    else:
        focus_line = "Фокус-месяц не выбран."

    q = question.lower()
    if "почему" in q:
        summary_text = (
            f"{focus_line} Ключевые факторы: динамика MoM, отмены, delivery rate и структура категорий."
        )
    elif "что делать" in q or "совет" in q:
        summary_text = (
            f"{focus_line} Приоритет: стабилизировать исполнение и усилить продажи в сильных категориях."
        )
    else:
        summary_text = (
            f"{focus_line} Состояние: MoM {('—' if mom is None else f'{mom:+.1f}%')}, "
            f"delivery {delivery_rate:.1f}%, отмены {cancel_rate:.1f}%."
        )

    wants_causes, wants_actions = _assistant_question_intent(question)
    if wants_causes and not raw_causes:
        raw_causes.append("Существенных негативных отклонений в текущем срезе не обнаружено.")
    if wants_actions and not raw_actions:
        raw_actions.append("Поддерживайте текущую стратегию и мониторьте ключевые KPI ежедневно.")

    probable_causes: list[str] = raw_causes[:4] if wants_causes else []
    actions: list[str] = raw_actions[:5] if wants_actions else []

    signal_count = len(raw_causes)
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


_TECH_PREFIX_RE = re.compile(r"^\s*(?:\d+\.\s*)?analytics_modules\.[^:]+:\s*", flags=re.IGNORECASE)


def _sanitize_assistant_line(text: str) -> str:
    clean = str(text or "").replace("**", "").strip()
    if not clean:
        return ""
    clean = _TECH_PREFIX_RE.sub("", clean)
    clean = re.sub(r"\s{2,}", " ", clean).strip()
    return clean


def _sanitize_assistant_list(values: list[str], *, limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values:
        clean = _sanitize_assistant_line(str(raw))
        if not clean:
            continue
        dedup = clean.lower()
        if dedup in seen:
            continue
        seen.add(dedup)
        out.append(clean)
        if len(out) >= limit:
            break
    return out


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
        "summary": "Этот запрос нарушает условия пользования. Пожалуйста, переформулируйте вопрос.",
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
            "top_category_name": "—",
            "top_category_share_pct": 0.0,
        },
    }


def _looks_abusive_minimal(question: str) -> bool:
    q = (question or "").lower()
    if not q:
        return False
    # Minimal non-strict guard for explicit insults/abuse phrases.
    abusive_terms = [
        "сын бляди",
        "son of a bitch",
        "пошел нах",
        "иди нах",
        "fuck you",
        "идиот",
        "долбаеб",
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
        "buyer_recommendations": summary.get("buyer_recommendations") or {},
        "analytics_modules": summary.get("analytics_modules") or {},
        "selected_month": selected_month,
        "question": question,
    }

    system_prompt = (
        "You are an analytics assistant for a B2B supply app. "
        "Always answer directly and use provided metrics as evidence. "
        "If the user asks an analytics/business question (causes, risks, growth, plan, priorities, what to do), "
        "return actionable guidance: probable_causes must contain 2-4 items and actions must contain 3-5 concrete steps. "
        "Actions must be prioritized, practical, and tied to the numbers in context. "
        "Use analytics_modules.alerts and analytics_modules.actions as primary context for risks and recommendations. "
        "If expected_impact_abs or expected_impact_pct exists, mention these figures in actions. "
        "Summary should be concise (2-4 sentences) and explain what is happening in the data. "
        "If data is insufficient, say so explicitly and avoid invented facts. "
        "Use actor_context for personalization when relevant. "
        "If buyer_recommendations are present, include concrete supplier/product suggestions from them in actions. "
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
        summary_text = _sanitize_assistant_line(str(out.get("summary") or ""))
        probable_causes = _sanitize_assistant_list([str(x) for x in (out.get("probable_causes") or [])], limit=4)
        actions = _sanitize_assistant_list([str(x) for x in (out.get("actions") or [])], limit=5)
        return {
            "summary": summary_text,
            "probable_causes": probable_causes,
            "actions": actions,
            "confidence": max(0.0, min(1.0, _safe_float(out.get("confidence"), 0.7))),
            "focus_month": out.get("focus_month"),
            "show_metrics": bool(out.get("show_metrics", True)),
            "metrics": {
                "mom_pct": None if metrics.get("mom_pct") is None else _safe_float(metrics.get("mom_pct")),
                "delivery_rate_pct": _safe_float(metrics.get("delivery_rate_pct")),
                "cancel_rate_pct": _safe_float(metrics.get("cancel_rate_pct")),
                "market_share_pct": _safe_float(metrics.get("market_share_pct")),
                "top_category_name": str(metrics.get("top_category_name") or "—"),
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


def _build_buyer_recommendations(
    db: Session,
    *,
    company_id: int,
    since_dt: datetime,
) -> dict:
    anchor_rows = db.execute(
        select(
            items.c.product_id.label("product_id"),
            products.c.name.label("product_name"),
            products.c.category_id.label("category_id"),
            products.c.unit.label("unit"),
            orders.c.supplier_company_id.label("supplier_company_id"),
            companies.c.name.label("supplier_name"),
            func.coalesce(func.avg(items.c.price_snapshot), 0).label("avg_price"),
            func.coalesce(func.sum(items.c.qty * items.c.price_snapshot), 0).label("spend"),
        )
        .select_from(
            items.join(orders, items.c.order_id == orders.c.id)
            .join(products, items.c.product_id == products.c.id)
            .join(companies, orders.c.supplier_company_id == companies.c.id)
        )
        .where(
            orders.c.buyer_company_id == company_id,
            orders.c.status == "DELIVERED",
            orders.c.created_at >= since_dt,
        )
        .group_by(
            items.c.product_id,
            products.c.name,
            products.c.category_id,
            products.c.unit,
            orders.c.supplier_company_id,
            companies.c.name,
        )
        .order_by(func.sum(items.c.qty * items.c.price_snapshot).desc())
        .limit(6)
    ).mappings().all()

    cheaper_alternatives: list[dict] = []
    min_savings_pct = 3.0
    for row in anchor_rows:
        anchor_price = float(row.get("avg_price") or 0)
        if anchor_price <= 0:
            continue
        category_id = row.get("category_id")
        supplier_company_id = int(row.get("supplier_company_id"))
        if category_id is None:
            continue

        candidate = db.execute(
            select(
                products.c.id.label("product_id"),
                products.c.name.label("product_name"),
                products.c.supplier_company_id.label("supplier_company_id"),
                companies.c.name.label("supplier_name"),
                products.c.price.label("price"),
                products.c.unit.label("unit"),
            )
            .select_from(products.join(companies, products.c.supplier_company_id == companies.c.id))
            .where(
                products.c.category_id == category_id,
                products.c.supplier_company_id != supplier_company_id,
                products.c.in_stock.is_(True),
                products.c.unit == row.get("unit"),
                products.c.price > 0,
                products.c.price < anchor_price,
            )
            .order_by(products.c.price.asc())
            .limit(1)
        ).mappings().first()
        if not candidate:
            continue

        candidate_price = float(candidate.get("price") or 0)
        if candidate_price <= 0 or candidate_price >= anchor_price:
            continue

        savings_abs = anchor_price - candidate_price
        savings_pct = (savings_abs / anchor_price) * 100 if anchor_price > 0 else 0.0
        if savings_pct < min_savings_pct:
            continue

        cheaper_alternatives.append(
            {
                "anchor_product_id": int(row.get("product_id")),
                "anchor_product_name": str(row.get("product_name") or ""),
                "anchor_supplier_company_id": supplier_company_id,
                "anchor_supplier_name": str(row.get("supplier_name") or ""),
                "anchor_price": round(anchor_price, 2),
                "candidate_product_id": int(candidate.get("product_id")),
                "candidate_product_name": str(candidate.get("product_name") or ""),
                "candidate_supplier_company_id": int(candidate.get("supplier_company_id")),
                "candidate_supplier_name": str(candidate.get("supplier_name") or ""),
                "candidate_price": round(candidate_price, 2),
                "unit": str(candidate.get("unit") or row.get("unit") or ""),
                "savings_abs": round(savings_abs, 2),
                "savings_pct": round(savings_pct, 2),
                "rationale": (
                    f"Та же категория и единица измерения, цена ниже на {savings_pct:.1f}% "
                    f"({round(anchor_price, 2)} -> {round(candidate_price, 2)})."
                ),
            }
        )

    supplier_status_rows = db.execute(
        select(
            orders.c.supplier_company_id.label("supplier_company_id"),
            companies.c.name.label("supplier_name"),
            orders.c.status.label("status"),
            func.count().label("count"),
        )
        .select_from(orders.join(companies, orders.c.supplier_company_id == companies.c.id))
        .where(
            orders.c.buyer_company_id == company_id,
            orders.c.created_at >= since_dt,
        )
        .group_by(
            orders.c.supplier_company_id,
            companies.c.name,
            orders.c.status,
        )
    ).mappings().all()

    by_supplier: dict[int, dict] = {}
    for row in supplier_status_rows:
        sid = int(row.get("supplier_company_id"))
        entry = by_supplier.setdefault(
            sid,
            {
                "supplier_company_id": sid,
                "supplier_name": str(row.get("supplier_name") or ""),
                "total": 0,
                "delivered": 0,
                "cancelled": 0,
            },
        )
        count = int(row.get("count") or 0)
        entry["total"] += count
        status = str(row.get("status") or "").upper()
        if status == "DELIVERED":
            entry["delivered"] += count
        elif status in {"CANCELLED", "CANCELED"}:
            entry["cancelled"] += count

    reliable_suppliers: list[dict] = []
    for entry in by_supplier.values():
        total = int(entry["total"])
        delivered = int(entry["delivered"])
        cancelled = int(entry["cancelled"])
        if total <= 0 or delivered < 5:
            continue

        delivery_rate_pct = (delivered / total) * 100
        cancel_rate_pct = (cancelled / total) * 100
        repeat_share_pct = (max(0, total - 1) / total) * 100
        score = (
            0.45 * delivery_rate_pct
            + 0.35 * (100 - cancel_rate_pct)
            + 0.20 * repeat_share_pct
        )
        reliable_suppliers.append(
            {
                "supplier_company_id": int(entry["supplier_company_id"]),
                "supplier_name": str(entry["supplier_name"]),
                "score": round(score, 2),
                "delivery_rate_pct": round(delivery_rate_pct, 2),
                "cancel_rate_pct": round(cancel_rate_pct, 2),
                "repeat_share_pct": round(repeat_share_pct, 2),
                "delivered_orders": delivered,
            }
        )

    reliable_suppliers.sort(
        key=lambda x: (
            -float(x["score"]),
            -int(x["delivered_orders"]),
        )
    )
    return {
        "cheaper_alternatives": cheaper_alternatives[:4],
        "reliable_suppliers": reliable_suppliers[:5],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _median(values: list[float]) -> float:
    clean = sorted(float(v) for v in values if v is not None)
    if not clean:
        return 0.0
    n = len(clean)
    mid = n // 2
    if n % 2:
        return clean[mid]
    return (clean[mid - 1] + clean[mid]) / 2


def _compute_hhi_from_shares(shares: list[float]) -> float:
    clean = [max(0.0, float(s)) for s in shares if s is not None]
    total = sum(clean)
    if total <= 0:
        return 0.0
    norm = [s / total for s in clean]
    return round(sum(s * s for s in norm), 4)


def _hhi_risk_level(hhi: float) -> str:
    if hhi > 0.25:
        return "high"
    if hhi >= 0.18:
        return "medium"
    return "low"


def _priority_score(*, impact_score: float, urgency_score: float, confidence: float) -> float:
    confidence_score = _clamp(confidence, 0.0, 1.0) * 100
    score = impact_score * 0.55 + urgency_score * 0.30 + confidence_score * 0.15
    return round(_clamp(score, 0.0, 100.0), 2)


def _build_buyer_analytics_modules(
    db: Session,
    *,
    company_id: int,
    since_dt: datetime,
    category_breakdown: list[dict],
    buyer_recommendations: dict,
) -> dict:
    cheaper_alternatives = buyer_recommendations.get("cheaper_alternatives") or []
    reliable_suppliers = buyer_recommendations.get("reliable_suppliers") or []

    savings_watchlist = [
        {
            "anchor_product_id": int(x.get("anchor_product_id")),
            "anchor_product_name": str(x.get("anchor_product_name") or ""),
            "current_supplier_name": str(x.get("anchor_supplier_name") or ""),
            "current_price": round(float(x.get("anchor_price") or 0), 2),
            "alt_supplier_name": str(x.get("candidate_supplier_name") or ""),
            "alt_product_name": str(x.get("candidate_product_name") or ""),
            "alt_price": round(float(x.get("candidate_price") or 0), 2),
            "savings_abs": round(float(x.get("savings_abs") or 0), 2),
            "savings_pct": round(float(x.get("savings_pct") or 0), 2),
        }
        for x in cheaper_alternatives[:6]
    ]

    supplier_reliability = [
        {
            "supplier_company_id": int(x.get("supplier_company_id")),
            "supplier_name": str(x.get("supplier_name") or ""),
            "score": round(float(x.get("score") or 0), 2),
            "delivery_rate_pct": round(float(x.get("delivery_rate_pct") or 0), 2),
            "cancel_rate_pct": round(float(x.get("cancel_rate_pct") or 0), 2),
            "repeat_share_pct": round(float(x.get("repeat_share_pct") or 0), 2),
            "delivered_orders": int(x.get("delivered_orders") or 0),
        }
        for x in reliable_suppliers[:5]
    ]

    supplier_spend_rows = db.execute(
        select(
            orders.c.supplier_company_id.label("supplier_company_id"),
            func.coalesce(func.sum(items.c.qty * items.c.price_snapshot), 0).label("spend"),
        )
        .select_from(items.join(orders, items.c.order_id == orders.c.id))
        .where(
            orders.c.buyer_company_id == company_id,
            orders.c.status == "DELIVERED",
            orders.c.created_at >= since_dt,
        )
        .group_by(orders.c.supplier_company_id)
    ).mappings().all()

    supplier_shares = [float(r.get("spend") or 0) for r in supplier_spend_rows]
    supplier_hhi = _compute_hhi_from_shares(supplier_shares)
    category_hhi = _compute_hhi_from_shares([float(c.get("share_pct") or 0) / 100 for c in category_breakdown])
    risk_level = _hhi_risk_level(max(supplier_hhi, category_hhi))

    return {
        "savings_watchlist": savings_watchlist[:4],
        "supplier_reliability": supplier_reliability,
        "concentration": {
            "supplier_hhi": supplier_hhi,
            "category_hhi": category_hhi,
            "risk_level": risk_level,
        },
    }


def _build_supplier_analytics_modules(
    db: Session,
    *,
    company_id: int,
    since_dt: datetime,
    total_revenue: float,
    total_orders: int,
) -> dict:
    product_rows = db.execute(
        select(
            products.c.id.label("product_id"),
            products.c.name.label("name"),
            products.c.price.label("price"),
            products.c.category_id.label("category_id"),
            products.c.unit.label("unit"),
            products.c.supplier_company_id.label("supplier_company_id"),
            products.c.in_stock.label("in_stock"),
        ).where(
            products.c.category_id.is_not(None),
            products.c.price > 0,
            products.c.unit.is_not(None),
        )
    ).mappings().all()

    by_key: dict[tuple[int, str], list[float]] = {}
    for row in product_rows:
        key = (int(row.get("category_id")), str(row.get("unit") or ""))
        by_key.setdefault(key, []).append(float(row.get("price") or 0))

    own_rows = [r for r in product_rows if int(r.get("supplier_company_id")) == company_id]
    compared_count = 0
    overpriced = 0
    underpriced = 0
    gaps: list[float] = []
    top_overpriced: list[dict] = []

    for row in own_rows:
        key = (int(row.get("category_id")), str(row.get("unit") or ""))
        ref_prices = by_key.get(key) or []
        if len(ref_prices) < 2:
            continue
        median_price = _median(ref_prices)
        own_price = float(row.get("price") or 0)
        if median_price <= 0 or own_price <= 0:
            continue
        compared_count += 1
        gap_pct = ((own_price - median_price) / median_price) * 100
        gaps.append(gap_pct)
        if gap_pct > 8:
            overpriced += 1
            top_overpriced.append(
                {
                    "product_id": int(row.get("product_id")),
                    "name": str(row.get("name") or ""),
                    "gap_pct": round(gap_pct, 2),
                }
            )
        elif gap_pct < -8:
            underpriced += 1

    top_overpriced.sort(key=lambda x: -float(x["gap_pct"]))
    overpriced_share = (overpriced / compared_count) * 100 if compared_count else 0.0
    underpriced_share = (underpriced / compared_count) * 100 if compared_count else 0.0
    median_gap = _median(gaps) if gaps else 0.0

    buyer_rows = db.execute(
        select(
            orders.c.buyer_company_id.label("buyer_company_id"),
            func.min(orders.c.created_at).label("first_delivered_at"),
            func.max(orders.c.created_at).label("last_delivered_at"),
            func.sum(
                case(
                    (orders.c.created_at >= since_dt, 1),
                    else_=0,
                )
            ).label("delivered_in_period"),
        )
        .where(
            orders.c.supplier_company_id == company_id,
            orders.c.status == "DELIVERED",
        )
        .group_by(orders.c.buyer_company_id)
    ).mappings().all()

    now_utc = datetime.now(timezone.utc)
    at_risk_cutoff = now_utc - timedelta(days=60)
    new_buyers = 0
    returning_buyers = 0
    at_risk_buyers = 0
    for row in buyer_rows:
        first_dt = row.get("first_delivered_at")
        last_dt = row.get("last_delivered_at")
        in_period = int(row.get("delivered_in_period") or 0)
        if in_period > 0:
            if isinstance(first_dt, datetime) and first_dt >= since_dt:
                new_buyers += 1
            else:
                returning_buyers += 1
        elif isinstance(last_dt, datetime) and last_dt < at_risk_cutoff:
            at_risk_buyers += 1

    repeat_rate = (
        (returning_buyers / (new_buyers + returning_buyers)) * 100
        if (new_buyers + returning_buyers) > 0
        else 0.0
    )

    status_rows = db.execute(
        select(
            orders.c.status.label("status"),
            func.count().label("count"),
        ).where(
            orders.c.supplier_company_id == company_id,
            orders.c.created_at >= since_dt,
        )
        .group_by(orders.c.status)
    ).mappings().all()
    status_map = {str(r.get("status") or "").upper(): int(r.get("count") or 0) for r in status_rows}
    cancelled_orders = int(status_map.get("CANCELLED", 0) + status_map.get("CANCELED", 0))
    pipeline_orders = int(
        status_map.get("PENDING", 0)
        + status_map.get("CREATED", 0)
        + status_map.get("CONFIRMED", 0)
        + status_map.get("DELIVERING", 0)
    )
    avg_check = (total_revenue / total_orders) if total_orders > 0 else 0.0
    cancelled_estimate = avg_check * cancelled_orders
    pipeline_estimate = avg_check * pipeline_orders
    leakage_total = cancelled_estimate + pipeline_estimate
    leakage_ratio = (leakage_total / total_revenue) if total_revenue > 0 else 0.0
    leakage_score = round(_clamp(leakage_ratio * 100, 0.0, 100.0), 2)

    return {
        "price_competitiveness": {
            "sku_compared": compared_count,
            "overpriced_share_pct": round(overpriced_share, 2),
            "underpriced_share_pct": round(underpriced_share, 2),
            "median_gap_pct": round(median_gap, 2),
            "top_overpriced_skus": top_overpriced[:5],
        },
        "buyer_retention": {
            "new_buyers": new_buyers,
            "returning_buyers": returning_buyers,
            "at_risk_buyers": at_risk_buyers,
            "repeat_rate_pct": round(repeat_rate, 2),
        },
        "revenue_leakage": {
            "cancelled_orders": cancelled_orders,
            "cancelled_value_estimate": round(cancelled_estimate, 2),
            "pipeline_orders": pipeline_orders,
            "pipeline_value_estimate": round(pipeline_estimate, 2),
            "leakage_score": leakage_score,
        },
    }


def _build_alerts_and_actions(
    *,
    role: str,
    total_revenue: float,
    sales_trends: list[dict],
    category_breakdown: list[dict],
    status_funnel: list[dict],
    buyer_modules: dict | None,
    supplier_modules: dict | None,
) -> tuple[list[dict], list[dict]]:
    alerts: list[dict] = []
    actions: list[dict] = []

    def add_alert(
        *,
        alert_id: str,
        severity: str,
        title: str,
        message: str,
        metric_key: str,
        metric_value: float | str,
        threshold: float | str | None = None,
        action_hint: str,
    ) -> None:
        payload = {
            "id": alert_id,
            "severity": severity,
            "title": title,
            "message": message,
            "metric_key": metric_key,
            "metric_value": metric_value,
            "action_hint": action_hint,
        }
        if threshold is not None:
            payload["threshold"] = threshold
        alerts.append(payload)

    def add_action(
        *,
        action_id: str,
        title: str,
        rationale: str,
        owner: str,
        confidence: float,
        impact_score: float,
        urgency_score: float,
        expected_impact_abs: float | None = None,
        expected_impact_pct: float | None = None,
    ) -> None:
        if confidence < 0.55:
            return
        action_payload = {
            "id": action_id,
            "priority": _priority_score(
                impact_score=impact_score,
                urgency_score=urgency_score,
                confidence=confidence,
            ),
            "title": title,
            "rationale": rationale,
            "confidence": round(_clamp(confidence, 0.0, 1.0), 2),
            "owner": owner,
        }
        if expected_impact_abs is not None:
            action_payload["expected_impact_abs"] = round(max(0.0, float(expected_impact_abs)), 2)
        if expected_impact_pct is not None:
            action_payload["expected_impact_pct"] = round(float(expected_impact_pct), 2)
        actions.append(action_payload)

    delivered = sum(int(x.get("count") or 0) for x in status_funnel if str(x.get("status") or "").upper() == "DELIVERED")
    cancelled = sum(
        int(x.get("count") or 0)
        for x in status_funnel
        if str(x.get("status") or "").upper() in {"CANCELLED", "CANCELED"}
    )
    pipeline = sum(
        int(x.get("count") or 0)
        for x in status_funnel
        if str(x.get("status") or "").upper() in {"PENDING", "CREATED", "CONFIRMED", "DELIVERING"}
    )
    total_status = max(1, sum(int(x.get("count") or 0) for x in status_funnel))
    delivery_rate = (delivered / total_status) * 100
    cancel_rate = (cancelled / total_status) * 100
    pipeline_rate = (pipeline / total_status) * 100
    top_cat = category_breakdown[0] if category_breakdown else None
    top_cat_share = float(top_cat.get("share_pct") or 0) if top_cat else 0.0

    mom = None
    if len(sales_trends) >= 2:
        prev = float(sales_trends[-2].get("revenue") or 0)
        cur = float(sales_trends[-1].get("revenue") or 0)
        if prev > 0:
            mom = ((cur - prev) / prev) * 100

    if mom is not None and mom <= -10:
        add_alert(
            alert_id="mom_drop",
            severity="critical",
            title="Резкая просадка",
            message=f"Падение к прошлому месяцу: {abs(mom):.1f}%.",
            metric_key="mom_pct",
            metric_value=round(mom, 2),
            threshold=-10,
            action_hint="Сфокусируйтесь на восстановлении объема топ-SKU.",
        )
    if cancel_rate >= 10:
        add_alert(
            alert_id="cancel_high",
            severity="warning",
            title="Высокая доля отмен",
            message=f"Отмены достигли {cancel_rate:.1f}%.",
            metric_key="cancel_rate_pct",
            metric_value=round(cancel_rate, 2),
            threshold=10,
            action_hint="Усильте SLA подтверждения и доступность товара.",
        )
    if delivery_rate < 75:
        add_alert(
            alert_id="delivery_low",
            severity="warning",
            title="Низкий delivery rate",
            message=f"Текущий delivery rate: {delivery_rate:.1f}%.",
            metric_key="delivery_rate_pct",
            metric_value=round(delivery_rate, 2),
            threshold=75,
            action_hint="Ускорьте прохождение статусов до DELIVERED.",
        )
    if top_cat_share >= 55:
        add_alert(
            alert_id="category_concentration",
            severity="info",
            title="Концентрация в категории",
            message=f"Топ-категория дает {top_cat_share:.1f}% оборота.",
            metric_key="top_category_share_pct",
            metric_value=round(top_cat_share, 2),
            threshold=55,
            action_hint="Добавьте 2-3 SKU в соседних категориях.",
        )

    if role == "buyer":
        buyer_mod = buyer_modules or {}
        concentration = buyer_mod.get("concentration") or {}
        risk_level = str(concentration.get("risk_level") or "low")
        supplier_hhi = float(concentration.get("supplier_hhi") or 0)
        if risk_level in {"medium", "high"}:
            add_alert(
                alert_id="buyer_concentration",
                severity="critical" if risk_level == "high" else "warning",
                title="Риск зависимости от поставщиков",
                message=f"HHI по поставщикам: {supplier_hhi:.2f} ({risk_level}).",
                metric_key="supplier_hhi",
                metric_value=round(supplier_hhi, 4),
                threshold=0.18,
                action_hint="Распределите закупки между 2-3 поставщиками.",
            )
        watchlist = buyer_mod.get("savings_watchlist") or []
        if watchlist:
            best = watchlist[0]
            add_action(
                action_id="buyer_switch_cheaper",
                title=f"Переключить закупку {best.get('anchor_product_name')}",
                rationale=(
                    f"Переведите часть объема к {best.get('alt_supplier_name')} "
                    f"для снижения цены на {float(best.get('savings_pct') or 0):.1f}%."
                ),
                owner="buyer",
                confidence=0.82,
                impact_score=min(95.0, max(45.0, float(best.get("savings_pct") or 0) * 4)),
                urgency_score=68.0,
                expected_impact_pct=float(best.get("savings_pct") or 0),
            )
        reliability = buyer_mod.get("supplier_reliability") or []
        if reliability:
            top_supplier = reliability[0]
            add_action(
                action_id="buyer_shift_reliable",
                title=f"Увеличить долю у {top_supplier.get('supplier_name')}",
                rationale=(
                    f"Надежность {float(top_supplier.get('score') or 0):.1f}/100, "
                    f"delivery {float(top_supplier.get('delivery_rate_pct') or 0):.1f}%."
                ),
                owner="buyer",
                confidence=0.76,
                impact_score=min(90.0, max(40.0, float(top_supplier.get("score") or 0))),
                urgency_score=63.0,
            )
        if risk_level in {"medium", "high"}:
            add_action(
                action_id="buyer_diversify",
                title="Снизить концентрацию закупок",
                rationale="Разбейте закупки по минимум двум альтернативным поставщикам в топ-категориях.",
                owner="buyer",
                confidence=0.72,
                impact_score=74.0 if risk_level == "medium" else 88.0,
                urgency_score=72.0,
            )
    else:
        supplier_mod = supplier_modules or {}
        price = supplier_mod.get("price_competitiveness") or {}
        retention = supplier_mod.get("buyer_retention") or {}
        leakage = supplier_mod.get("revenue_leakage") or {}
        overpriced_share = float(price.get("overpriced_share_pct") or 0)
        at_risk_buyers = int(retention.get("at_risk_buyers") or 0)
        leakage_score = float(leakage.get("leakage_score") or 0)

        if overpriced_share >= 35:
            add_alert(
                alert_id="supplier_overpriced",
                severity="warning",
                title="Низкая ценовая конкурентность",
                message=f"{overpriced_share:.1f}% SKU выше медианы рынка.",
                metric_key="overpriced_share_pct",
                metric_value=round(overpriced_share, 2),
                threshold=35,
                action_hint="Скорректируйте цену на переоцененных SKU.",
            )
        if at_risk_buyers > 0:
            add_alert(
                alert_id="supplier_at_risk_buyers",
                severity="warning",
                title="Риск оттока покупателей",
                message=f"{at_risk_buyers} покупателей без повторных поставок >60 дней.",
                metric_key="at_risk_buyers",
                metric_value=at_risk_buyers,
                threshold=1,
                action_hint="Запустите персональные офферы на возврат.",
            )
        if leakage_score >= 30:
            add_alert(
                alert_id="supplier_leakage",
                severity="critical" if leakage_score >= 55 else "warning",
                title="Утечка выручки",
                message=f"Leakage score: {leakage_score:.1f}/100.",
                metric_key="leakage_score",
                metric_value=round(leakage_score, 2),
                threshold=30,
                action_hint="Снизьте отмены и задержки в pipeline.",
            )

        top_sku = (price.get("top_overpriced_skus") or [None])[0]
        if top_sku:
            add_action(
                action_id="supplier_reprice_top_sku",
                title=f"Скорректировать цену: {top_sku.get('name')}",
                rationale=f"SKU выше медианы рынка на {float(top_sku.get('gap_pct') or 0):.1f}%.",
                owner="supplier",
                confidence=0.8,
                impact_score=min(96.0, max(48.0, float(top_sku.get("gap_pct") or 0) * 4)),
                urgency_score=70.0,
                expected_impact_pct=max(0.0, float(top_sku.get("gap_pct") or 0)),
            )
        if at_risk_buyers > 0:
            add_action(
                action_id="supplier_reactivate_buyers",
                title="Вернуть at-risk покупателей",
                rationale="Сделайте целевой прайс/доставку для неактивных клиентов последних 60 дней.",
                owner="supplier",
                confidence=0.73,
                impact_score=min(90.0, 45.0 + at_risk_buyers * 6),
                urgency_score=66.0,
            )
        leakage_est = float(leakage.get("cancelled_value_estimate") or 0) + float(leakage.get("pipeline_value_estimate") or 0)
        if leakage_est > 0:
            add_action(
                action_id="supplier_reduce_leakage",
                title="Снизить операционные потери",
                rationale="Сфокусируйтесь на отменах и долгих статусах до DELIVERED.",
                owner="supplier",
                confidence=0.78,
                impact_score=min(92.0, 50.0 + leakage_score * 0.5),
                urgency_score=72.0,
                expected_impact_abs=min(leakage_est, max(0.0, total_revenue * 0.2)),
            )

    if not alerts:
        add_alert(
            alert_id="stable_state",
            severity="info",
            title="Стабильное состояние",
            message="Критичных отклонений не найдено в текущем окне.",
            metric_key="status",
            metric_value="stable",
            action_hint="Продолжайте мониторинг ключевых KPI.",
        )

    if not actions:
        add_action(
            action_id="baseline_monitoring",
            title="Поддерживать контроль KPI",
            rationale="Существенных отклонений нет, приоритет — регулярный мониторинг и точечные тесты.",
            owner=role,
            confidence=0.65,
            impact_score=48.0,
            urgency_score=40.0,
        )

    actions_sorted = sorted(actions, key=lambda x: float(x.get("priority") or 0), reverse=True)[:5]
    return alerts[:8], actions_sorted


def _build_analytics_modules(
    db: Session,
    *,
    role: str,
    company_id: int,
    since_dt: datetime,
    total_revenue: float,
    total_orders: int,
    sales_trends: list[dict],
    category_breakdown: list[dict],
    status_funnel: list[dict],
    buyer_recommendations: dict | None,
) -> dict:
    buyer_mod = None
    supplier_mod = None
    if role == "buyer":
        buyer_mod = _build_buyer_analytics_modules(
            db,
            company_id=company_id,
            since_dt=since_dt,
            category_breakdown=category_breakdown,
            buyer_recommendations=buyer_recommendations or {},
        )
    else:
        supplier_mod = _build_supplier_analytics_modules(
            db,
            company_id=company_id,
            since_dt=since_dt,
            total_revenue=total_revenue,
            total_orders=total_orders,
        )

    alerts, actions = _build_alerts_and_actions(
        role=role,
        total_revenue=total_revenue,
        sales_trends=sales_trends,
        category_breakdown=category_breakdown,
        status_funnel=status_funnel,
        buyer_modules=buyer_mod,
        supplier_modules=supplier_mod,
    )

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "alerts": alerts,
        "actions": actions,
    }
    if buyer_mod is not None:
        payload["buyer"] = buyer_mod
    if supplier_mod is not None:
        payload["supplier"] = supplier_mod
    return payload


def _get_cached_insights(company_id: int, role: str, days: int) -> list[str] | None:
    redis_key = make_key("analytics", "insights", company_id, role, days)
    cached_redis = get_json(redis_key)
    if isinstance(cached_redis, list):
        clean = [str(x).strip() for x in cached_redis if str(x).strip()]
        if clean:
            return clean[:3]

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
    redis_key = make_key("analytics", "insights", company_id, role, days)
    set_json(redis_key, insights[:3], settings.CACHE_TTL_ANALYTICS_INSIGHTS)

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


def _analytics_summary_cache_key(*, user_id: int, company_id: int, role: str, days: int) -> str:
    return make_key("analytics", "summary", user_id, company_id, role, days)


def _analytics_assistant_cache_key(
    *,
    user_id: int,
    company_id: int,
    role: str,
    days: int,
    selected_month: str | None,
    question: str,
) -> str:
    q_norm = (question or "").strip().lower()
    q_hash = stable_hash(q_norm, 20)
    return make_key(
        "analytics",
        "assistant",
        user_id,
        company_id,
        role,
        days,
        "v2",
        selected_month or "_",
        q_hash,
    )


def _ndjson_event(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


def _stream_text_chunks(text: str, *, chunk_size: int = 16) -> list[str]:
    clean = (text or "").strip()
    if not clean:
        return []
    return [clean[i : i + chunk_size] for i in range(0, len(clean), chunk_size)]


async def _llm_stream_text(
    *,
    summary: dict,
    question: str,
    selected_month: str | None,
    actor_context: dict | None = None,
) -> AsyncIterator[str]:
    compact = {
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
        "analytics_modules": summary.get("analytics_modules") or {},
        "buyer_recommendations": summary.get("buyer_recommendations") or {},
        "selected_month": selected_month,
        "question": question,
    }

    system_prompt = (
        "Ты AI-ассистент аналитики B2B платформы. "
        "Отвечай ТОЛЬКО на русском, коротко и по делу, опираясь на цифры из контекста. "
        "Если вопрос про аналитику/бизнес, дай понятный вывод и 2-4 практичных шага по приоритету. "
        "Если есть analytics_modules.actions/alerts, используй их первыми и упоминай ожидаемый эффект. "
        "Не возвращай JSON, markdown или служебный текст. Только готовый человеко-понятный ответ."
    )
    payload = {
        "model": settings.OPENAI_MODEL,
        "temperature": 0.45,
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(compact, ensure_ascii=False)},
        ],
    }

    url = f"{settings.OPENAI_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    timeout = httpx.Timeout(
        connect=float(settings.OPENAI_TIMEOUT_SECONDS),
        read=max(60.0, float(settings.OPENAI_TIMEOUT_SECONDS) * 3),
        write=float(settings.OPENAI_TIMEOUT_SECONDS),
        pool=float(settings.OPENAI_TIMEOUT_SECONDS),
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            resp.raise_for_status()
            async for raw_line in resp.aiter_lines():
                line = (raw_line or "").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    parsed = json.loads(data)
                except Exception:
                    continue
                choices = parsed.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    yield str(delta)


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

    summary_cache_key = _analytics_summary_cache_key(
        user_id=u_id,
        company_id=company_id,
        role=role_norm,
        days=days,
    )
    cached_summary = get_json(summary_cache_key)
    if isinstance(cached_summary, dict):
        return cached_summary

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
    buyer_recommendations = (
        _build_buyer_recommendations(db, company_id=company_id, since_dt=since_dt)
        if role_norm == "buyer"
        else None
    )
    analytics_modules = _build_analytics_modules(
        db,
        role=role_norm,
        company_id=company_id,
        since_dt=since_dt,
        total_revenue=total_revenue_f,
        total_orders=int(total_orders or 0),
        sales_trends=sales_trends,
        category_breakdown=category_breakdown,
        status_funnel=status_funnel,
        buyer_recommendations=buyer_recommendations,
    )
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
                "buyer_recommendations": buyer_recommendations or {},
                "analytics_modules": analytics_modules,
                "fallback_insights": base_insights,
            }
        )
        if llm_insights:
            insights = llm_insights[:3]
            _set_cached_insights(company_id=company_id, role=role_norm, days=days, insights=insights)

    response = {
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
        "analytics_modules": analytics_modules,
        **({"buyer_recommendations": buyer_recommendations} if buyer_recommendations is not None else {}),
    }
    set_json(summary_cache_key, response, settings.CACHE_TTL_ANALYTICS_SUMMARY)
    return response


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

    u_id = int(user["id"])
    role_norm = (payload.role or "").strip().lower()
    if role_norm not in {"supplier", "buyer"}:
        role_norm = "supplier"
    assistant_cache_key = _analytics_assistant_cache_key(
        user_id=u_id,
        company_id=payload.company_id,
        role=role_norm,
        days=payload.days,
        selected_month=payload.selected_month,
        question=payload.question,
    )
    cached_answer = get_json(assistant_cache_key)
    if isinstance(cached_answer, dict):
        return cached_answer

    actor_context = _build_actor_context(
        db=db,
        user=user,
        company_id=payload.company_id,
        role=role_norm,
        selected_month=payload.selected_month,
    )
    summary = analytics_summary(
        company_id=payload.company_id,
        role=role_norm,
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
        set_json(assistant_cache_key, llm, settings.CACHE_TTL_ANALYTICS_ASSISTANT)
        return llm
    fallback = _assistant_answer(summary=summary, question=payload.question, selected_month=payload.selected_month)
    set_json(assistant_cache_key, fallback, settings.CACHE_TTL_ANALYTICS_ASSISTANT)
    return fallback


@router.post("/analytics/assistant/query/stream")
async def analytics_assistant_query_stream(
    payload: AnalyticsAssistantRequest,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    u_id = int(user["id"])
    role_norm = (payload.role or "").strip().lower()
    if role_norm not in {"supplier", "buyer"}:
        role_norm = "supplier"

    if payload.company_id not in _company_ids_for_user(db, u_id):
        raise HTTPException(403, detail="Not allowed")

    assistant_cache_key = _analytics_assistant_cache_key(
        user_id=u_id,
        company_id=payload.company_id,
        role=role_norm,
        days=payload.days,
        selected_month=payload.selected_month,
        question=payload.question,
    )
    cached_answer = get_json(assistant_cache_key)

    async def stream_from_cached(answer: dict) -> AsyncIterator[str]:
        yield _ndjson_event({"type": "start"})
        for chunk in _stream_text_chunks(str(answer.get("summary") or ""), chunk_size=14):
            yield _ndjson_event({"type": "delta", "text": chunk})
            await asyncio.sleep(0.02)
        yield _ndjson_event({"type": "done", "data": answer})

    if isinstance(cached_answer, dict):
        return StreamingResponse(
            stream_from_cached(cached_answer),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    actor_context = _build_actor_context(
        db=db,
        user=user,
        company_id=payload.company_id,
        role=role_norm,
        selected_month=payload.selected_month,
    )
    summary = analytics_summary(
        company_id=payload.company_id,
        role=role_norm,
        days=payload.days,
        user=user,
        db=db,
    )

    async def stream_new_answer() -> AsyncIterator[str]:
        if _looks_abusive_minimal(payload.question):
            blocked = _policy_block_response()
            yield _ndjson_event({"type": "start"})
            for chunk in _stream_text_chunks(str(blocked.get("summary") or ""), chunk_size=14):
                yield _ndjson_event({"type": "delta", "text": chunk})
                await asyncio.sleep(0.02)
            yield _ndjson_event({"type": "done", "data": blocked})
            return

        yielded_any = False
        streamed_text = ""
        yield _ndjson_event({"type": "start"})
        if settings.OPENAI_API_KEY:
            try:
                async for piece in _llm_stream_text(
                    summary=summary,
                    question=payload.question,
                    selected_month=payload.selected_month,
                    actor_context=actor_context,
                ):
                    yielded_any = True
                    streamed_text += piece
                    yield _ndjson_event({"type": "delta", "text": piece})
            except Exception:
                yielded_any = False
                streamed_text = ""

        if yielded_any and streamed_text.strip():
            out = _assistant_answer(summary=summary, question=payload.question, selected_month=payload.selected_month)
            out["summary"] = _sanitize_assistant_line(streamed_text.strip())
            set_json(assistant_cache_key, out, settings.CACHE_TTL_ANALYTICS_ASSISTANT)
            yield _ndjson_event({"type": "done", "data": out})
            return

        fallback = _assistant_answer(summary=summary, question=payload.question, selected_month=payload.selected_month)
        set_json(assistant_cache_key, fallback, settings.CACHE_TTL_ANALYTICS_ASSISTANT)
        for chunk in _stream_text_chunks(str(fallback.get("summary") or ""), chunk_size=14):
            yield _ndjson_event({"type": "delta", "text": chunk})
            await asyncio.sleep(0.02)
        yield _ndjson_event({"type": "done", "data": fallback})

    return StreamingResponse(
        stream_new_answer(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
