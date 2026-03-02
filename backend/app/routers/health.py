from fastapi import APIRouter, HTTPException, Response

from app.cache.redis_cache import cache_status, quick_write_probe
from app.core.config import settings
from app.observability import get_metrics_payload
from app.services.llm import llm_chat_json

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/health/cache")
def health_cache():
    status = cache_status()
    status["cache_write_test"] = quick_write_probe() if status["redis_enabled"] else False
    return status


@router.get("/health/llm")
def health_llm():
    base_url = (settings.OPENAI_BASE_URL or "").lower()
    provider = "gemini" if "generativelanguage.googleapis.com" in base_url else "openai"
    out = llm_chat_json(
        system_prompt="Return strict JSON with key ok:boolean",
        user_content="ping",
        temperature=0,
    )
    return {
        "provider": provider,
        "model": settings.OPENAI_MODEL,
        "configured": bool(settings.OPENAI_API_KEY),
        "ok": isinstance(out, dict),
    }


@router.get("/metrics", include_in_schema=False)
def metrics():
    if not settings.METRICS_ENABLED:
        raise HTTPException(status_code=404, detail="Metrics disabled")
    payload, content_type = get_metrics_payload()
    return Response(content=payload, media_type=content_type)
