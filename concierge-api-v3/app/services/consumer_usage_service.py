"""Aggregated consumer usage, written ONLY to the operational database.

The CMS (Payload) holds credentials hash-only and never receives usage
writes from FastAPI: a scheduled Payload job reads paged usage from
``GET /api/v3/internal/consumer-usage`` and syncs the maximum ``lastUsedAt``
back into the CMS. This module is the single write frontier for that
operational aggregation.
"""

from __future__ import annotations

from datetime import datetime

from pymongo.database import Database

from app.services.consumer_auth_service import ConsumerPrincipal


def record_consumer_usage(database: Database, principal: ConsumerPrincipal, now: datetime) -> None:
    """Record one usage observation for an authenticated consumer.

    One document per credential: ``lastUsedAt`` is the max observed instant,
    ``updatedAt`` the last sync-relevant mutation (the page key of the
    Payload sync job), and ``requestCount`` the total observations. The
    upsert is idempotent and safe to retry.
    """
    database["consumer_credential_usage"].update_one(
        {"credentialId": principal.credential_id},
        {
            "$max": {"lastUsedAt": now},
            "$set": {"applicationId": principal.application_id, "updatedAt": now},
            "$inc": {"requestCount": 1},
        },
        upsert=True,
    )
