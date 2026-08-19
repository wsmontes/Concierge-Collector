"""Fixed-window, Mongo-backed quota for consumer credentials."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument

from app.services.consumer_auth_service import ConsumerPrincipal


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    status_code: int
    headers: dict[str, str]


class ConsumerRateLimitService:
    def __init__(self, database):
        self._windows = database["consumer_rate_limit_windows"]

    def consume(self, principal: ConsumerPrincipal, now: datetime | None = None) -> RateLimitResult:
        now = now or datetime.now(timezone.utc)
        minute = now.replace(second=0, microsecond=0)
        reset = minute + timedelta(minutes=1)
        result = self._windows.find_one_and_update(
            {"credentialId": principal.credential_id, "minuteWindow": minute},
            {
                "$setOnInsert": {"credentialId": principal.credential_id, "minuteWindow": minute, "expiresAt": reset},
                "$inc": {"requests": 1},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        requests = int((result or {}).get("requests", 1))
        remaining = max(0, principal.requests_per_minute - requests)
        headers = {
            "X-RateLimit-Limit": str(principal.requests_per_minute),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(int(reset.timestamp())),
        }
        if requests > principal.requests_per_minute:
            headers["Retry-After"] = str(max(1, int((reset - now).total_seconds())))
            return RateLimitResult(False, 429, headers)
        return RateLimitResult(True, 200, headers)
