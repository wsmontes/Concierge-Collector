"""Credentialed, version-bound public Collection pages."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pymongo.database import Database

from app.core.cms_database import CmsReadOnlyDatabase, get_cms_read_database
from app.core.config import settings
from app.core.database import get_database
from app.models.distribution_response import CollectionDistributionEnvelopeV1
from app.services.consumer_auth_service import ConsumerPrincipal, authenticate_consumer, authorize_collection
from app.services.consumer_rate_limit import ConsumerRateLimitService
from app.services.distribution_cursor import CursorError, decode_cursor, encode_cursor
from app.services.distribution_service import hydrate_public_batch

router = APIRouter(prefix="/distribution/collections", tags=["distribution"])


def _cursor_secret() -> str:
    # CMS_SERVICE_KEY has a distinct privilege boundary and must not be used to
    # sign consumer cursors. Production requires the dedicated key.
    value = settings.distribution_cursor_secret
    if value:
        return value
    if settings.environment == "development":
        return "development-distribution-cursor-secret"
    raise RuntimeError("DISTRIBUTION_CURSOR_SECRET not configured")


def _consumer(authorization: str | None, cms_db: CmsReadOnlyDatabase) -> ConsumerPrincipal:
    return authenticate_consumer(cms_db, authorization)


def _membership_query(collection_id: str, version: int, after: str | None) -> dict:
    clauses: list[dict] = [
        {"collectionId": collection_id},
        {"addedInVersion": {"$lte": version}},
        {"$or": [{"removedInVersion": None}, {"removedInVersion": {"$gt": version}}]},
    ]
    if after:
        clauses.append({"curationId": {"$gt": after}})
    return {"$and": clauses}


@router.get("/{slug}", response_model=CollectionDistributionEnvelopeV1)
def current_collection_page(
    slug: str,
    authorization: str | None = Header(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    cms_db: CmsReadOnlyDatabase = Depends(get_cms_read_database),
    operational_db: Database = Depends(get_database),
):
    principal = _consumer(authorization, cms_db)
    rate = ConsumerRateLimitService(operational_db).consume(principal)
    response_headers = {**rate.headers, "Cache-Control": "private, no-store"}
    if not rate.allowed:
        raise HTTPException(status_code=429, detail="Consumer rate limit exceeded", headers=response_headers)

    collection = cms_db.collection("collections").find_one({"slug": slug})
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found", headers=response_headers)
    collection_id = str(collection.get("_id"))
    try:
        authorize_collection(principal, collection_id)
    except HTTPException as exc:
        exc.headers = response_headers
        raise
    if collection.get("lifecycle") == "archived":
        raise HTTPException(status_code=410, detail="Collection archived", headers=response_headers)
    version = collection.get("currentPublishedVersion")
    if collection.get("lifecycle") != "published" or not isinstance(version, int) or version < 1:
        raise HTTPException(status_code=404, detail="Collection not found", headers=response_headers)

    after: str | None = None
    if cursor:
        try:
            decoded = decode_cursor(
                cursor,
                _cursor_secret(),
                expected={
                    "purpose": "collection-items",
                    "applicationId": principal.application_id,
                    "collectionId": collection_id,
                    "publishedVersion": version,
                    "schemaVersion": 1,
                    "filtersHash": "default",
                },
            )
            after = decoded.get("lastCurationId") if isinstance(decoded.get("lastCurationId"), str) else None
        except CursorError as exc:
            raise HTTPException(status_code=409, detail="Invalid collection cursor", headers=response_headers) from exc

    items = []
    unavailable = []
    last_seen: str | None = after
    exhausted = False
    memberships = cms_db.collection("collection_memberships")
    while len(items) < limit and not exhausted:
        batch_limit = min(500, max(1, limit - len(items)))
        rows = list(
            memberships.find(
                _membership_query(collection_id, version, last_seen),
                {"_id": 0, "curationId": 1},
            ).sort("curationId", 1)
            # Never scan beyond the remaining response capacity: otherwise a
            # cursor could advance past hydrated items that were not emitted.
            .limit(batch_limit)
        )
        if not rows:
            exhausted = True
            break
        ids = [row.get("curationId") for row in rows if isinstance(row.get("curationId"), str)]
        last_seen = ids[-1] if ids else last_seen
        batch = hydrate_public_batch(operational_db, ids)
        remaining = limit - len(items)
        items.extend(batch.items[:remaining])
        unavailable.extend(batch.unavailable)
        if len(rows) < batch_limit:
            exhausted = True

    next_cursor = None
    if last_seen and not exhausted:
        next_cursor = encode_cursor(
            {
                "purpose": "collection-items",
                "applicationId": principal.application_id,
                "collectionId": collection_id,
                "publishedVersion": version,
                "schemaVersion": 1,
                "filtersHash": "default",
                "lastCurationId": last_seen,
            },
            _cursor_secret(),
            ttl=timedelta(minutes=15),
        )
    selected_count = int(collection.get("publishedSelectedCount") or 0)
    payload = CollectionDistributionEnvelopeV1(
        collection={"slug": slug, "version": version, "selected_count": selected_count},
        items=items,
        unavailable=unavailable,
        available_count=len(items),
        unavailable_count=len(unavailable),
        next_cursor=next_cursor,
    )
    return JSONResponse(payload.model_dump(mode="json"), headers=response_headers)
