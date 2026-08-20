"""Stateless authentication for credentialed Collection consumers."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import re
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.cms_database import CmsReadOnlyDatabase

_CREDENTIAL_RE = re.compile(r"^Bearer\s+(cck_([a-f0-9]{12})_([A-Za-z0-9_-]{32,}))$", re.IGNORECASE)


@dataclass(frozen=True)
class ConsumerPrincipal:
    credential_id: str
    application_id: str
    allowed_collection_ids: frozenset[str] = frozenset()
    requests_per_minute: int = 60


def _as_id(value: object) -> str:
    return str(value)


def _allowed_ids(application: dict) -> frozenset[str]:
    values = application.get("allowedCollectionIds")
    if not isinstance(values, list):
        return frozenset()
    return frozenset(
        _as_id(value.get("collectionId")) for value in values if isinstance(value, dict) and value.get("collectionId")
    )


def authenticate_consumer(
    cms_db: CmsReadOnlyDatabase, authorization: str | None, now: datetime | None = None
) -> ConsumerPrincipal:
    match = _CREDENTIAL_RE.fullmatch(authorization or "")
    if not match:
        raise HTTPException(status_code=401, detail="Consumer credential required")
    raw, prefix = match.group(1), match.group(2).lower()
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    now = now or datetime.now(timezone.utc)
    credential = cms_db.collection("consumer_credentials").find_one(
        {
            "prefix": prefix,
            "secretHash": digest,
            "status": "active",
            "$or": [{"expiresAt": None}, {"expiresAt": {"$gt": now}}],
        }
    )
    if not credential:
        raise HTTPException(status_code=401, detail="Consumer credential required")
    application = cms_db.collection("consumer_applications").find_one(
        {"_id": credential.get("applicationId"), "status": "active"}
    )
    if not application:
        raise HTTPException(status_code=401, detail="Consumer credential required")
    return ConsumerPrincipal(
        credential_id=_as_id(credential.get("_id")),
        application_id=_as_id(application.get("_id")),
        allowed_collection_ids=_allowed_ids(application),
        requests_per_minute=int(application.get("defaultRequestsPerMinute") or 60),
    )


def authorize_collection(principal: ConsumerPrincipal, collection_id: str) -> None:
    # Out-of-scope is deliberately indistinguishable from a missing slug.
    if collection_id not in principal.allowed_collection_ids:
        raise HTTPException(status_code=404, detail="Collection not found")
