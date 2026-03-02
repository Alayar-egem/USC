from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from app.cache.redis_cache import get_redis_client
from app.core.config import settings
from app.observability import observe_rate_limit_hit


@dataclass
class RateLimitRule:
    limit: int
    window_seconds: int
    key_suffix: str


class RateLimitError(RuntimeError):
    def __init__(self, retry_after: int):
        self.retry_after = max(1, int(retry_after))
        super().__init__(f"Rate limit exceeded. Retry after {self.retry_after}s")


def _safe(s: str | None) -> str:
    if not s:
        return "_"
    return (
        str(s)
        .strip()
        .lower()
        .replace(" ", "_")
        .replace("/", "_")
        .replace(":", "_")
        .replace("|", "_")
    ) or "_"


class RateLimiter:
    def __init__(self):
        self.prefix = "sec:rl"

    def _key(self, namespace: str, identity: str, suffix: str) -> str:
        return f"{self.prefix}:{_safe(namespace)}:{_safe(identity)}:{_safe(suffix)}"

    def _increment(self, key: str, window_seconds: int) -> tuple[int, int]:
        c = get_redis_client()
        if c is None:
            raise RuntimeError("redis unavailable")

        pipe = c.pipeline()
        pipe.incr(key)
        pipe.ttl(key)
        count, ttl = pipe.execute()
        if int(count) == 1 or int(ttl) <= 0:
            c.expire(key, int(window_seconds))
            ttl = int(window_seconds)
        return int(count), int(ttl)

    def check(self, namespace: str, identity: str, rules: Iterable[RateLimitRule]) -> None:
        if not settings.RATE_LIMIT_ENABLED:
            return
        try:
            for rule in rules:
                key = self._key(namespace, identity, rule.key_suffix)
                count, ttl = self._increment(key, int(rule.window_seconds))
                if count > int(rule.limit):
                    key_type = str(rule.key_suffix).split(":", 1)[0] if rule.key_suffix else "identity"
                    observe_rate_limit_hit(endpoint=namespace, key_type=key_type)
                    raise RateLimitError(retry_after=max(1, ttl))
        except RateLimitError:
            raise
        except Exception:
            if settings.RATE_LIMIT_FAIL_CLOSED:
                observe_rate_limit_hit(endpoint=namespace, key_type="fail_closed")
                raise RateLimitError(retry_after=30)
            return


rate_limit = RateLimiter()
