"""Credentialed, version-bound public Collection pages."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pymongo.database import Database

from app.core.cms_database import CmsReadOnlyDatabase, get_cms_read_database
from app.core.config import settings
from app.core.database import get_database
from app.models.distribution_response import (
    CollectionDistributionEnvelopeV1,
    CollectionVersionHistoryEnvelopeV1,
    DistributionVersionInfo,
)
from app.services.consumer_auth_service import ConsumerPrincipal, authenticate_consumer, authorize_collection
from app.services.consumer_rate_limit import ConsumerRateLimitService
from app.services.distribution_cursor import CursorError, decode_cursor, encode_cursor
from app.services.distribution_dump import gzip_iter, iter_ndjson_dump
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


def _authorize_published_collection(
    *, slug: str, principal: ConsumerPrincipal, cms_db: CmsReadOnlyDatabase, response_headers: dict[str, str]
) -> tuple[dict, str]:
    """Resolve a visible Collection after credential scope and archive checks."""

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
    return collection, collection_id


def _response_headers(principal: ConsumerPrincipal, operational_db: Database) -> dict[str, str]:
    rate = ConsumerRateLimitService(operational_db).consume(principal)
    headers = {**rate.headers, "Cache-Control": "private, no-store"}
    if not rate.allowed:
        raise HTTPException(status_code=429, detail="Consumer rate limit exceeded", headers=headers)
    return headers


def _stream_collection_dump(
    *,
    slug: str,
    collection_id: str,
    version: int,
    selected_count: int,
    accept_encoding: str,
    cms_db: CmsReadOnlyDatabase,
    operational_db: Database,
    response_headers: dict[str, str],
) -> StreamingResponse:
    """Stream one resolved publication without retaining membership IDs in memory."""

    def batches():
        pending: list[str] = []
        membership_cursor = (
            cms_db.collection("collection_memberships")
            .find(_membership_query(collection_id, version, None), {"_id": 0, "curationId": 1})
            .sort("curationId", 1)
        )
        for row in membership_cursor:
            curation_id = row.get("curationId")
            if not isinstance(curation_id, str):
                continue
            pending.append(curation_id)
            if len(pending) == 500:
                hydrated = hydrate_public_batch(operational_db, pending)
                yield hydrated.items, hydrated.unavailable
                pending = []
        if pending:
            hydrated = hydrate_public_batch(operational_db, pending)
            yield hydrated.items, hydrated.unavailable

    manifest = {
        "schema_version": 1,
        "collection": {"slug": slug, "version": version},
        "selected_count": selected_count,
    }
    stream = iter_ndjson_dump(manifest, batches())
    if "gzip" in accept_encoding.lower():
        response_headers["Content-Encoding"] = "gzip"
        response_headers["Vary"] = "Accept-Encoding"
        stream = gzip_iter(stream)
    return StreamingResponse(stream, media_type="application/x-ndjson", headers=response_headers)


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
    response_headers = _response_headers(principal, operational_db)
    collection, collection_id = _authorize_published_collection(
        slug=slug, principal=principal, cms_db=cms_db, response_headers=response_headers
    )
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


@router.get("/{slug}/versions", response_model=CollectionVersionHistoryEnvelopeV1)
def published_collection_versions(
    slug: str,
    authorization: str | None = Header(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    cms_db: CmsReadOnlyDatabase = Depends(get_cms_read_database),
    operational_db: Database = Depends(get_database),
):
    principal = _consumer(authorization, cms_db)
    response_headers = _response_headers(principal, operational_db)
    collection, collection_id = _authorize_published_collection(
        slug=slug, principal=principal, cms_db=cms_db, response_headers=response_headers
    )
    current_version = collection.get("currentPublishedVersion")
    if collection.get("lifecycle") != "published" or not isinstance(current_version, int) or current_version < 1:
        raise HTTPException(status_code=404, detail="Collection not found", headers=response_headers)

    last_version: int | None = None
    if cursor:
        try:
            decoded = decode_cursor(
                cursor,
                _cursor_secret(),
                expected={
                    "purpose": "version-list",
                    "applicationId": principal.application_id,
                    "collectionId": collection_id,
                    "schemaVersion": 1,
                    "filtersHash": "default",
                },
            )
            candidate = decoded.get("lastVersion")
            if not isinstance(candidate, int) or candidate < 1:
                raise CursorError("invalid version cursor")
            last_version = candidate
        except CursorError as exc:
            raise HTTPException(status_code=409, detail="Invalid collection cursor", headers=response_headers) from exc

    query: dict = {"collectionId": collection_id, "status": "published"}
    if last_version is not None:
        query["version"] = {"$lt": last_version}
    rows = list(
        cms_db.collection("collection_versions")
        .find(query, {"_id": 0, "version": 1, "selectedCount": 1, "publishedAt": 1})
        .sort("version", -1)
        .limit(limit + 1)
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    versions = [
        DistributionVersionInfo(
            version=int(row["version"]),
            selected_count=int(row.get("selectedCount") or 0),
            published_at=(
                row["publishedAt"].isoformat()
                if hasattr(row.get("publishedAt"), "isoformat")
                else row.get("publishedAt")
            ),
        )
        for row in rows
        if isinstance(row.get("version"), int) and row["version"] > 0
    ]
    next_cursor = None
    if has_more and versions:
        next_cursor = encode_cursor(
            {
                "purpose": "version-list",
                "applicationId": principal.application_id,
                "collectionId": collection_id,
                "schemaVersion": 1,
                "filtersHash": "default",
                "lastVersion": versions[-1].version,
            },
            _cursor_secret(),
            ttl=timedelta(minutes=15),
        )
    payload = CollectionVersionHistoryEnvelopeV1(
        collection={
            "slug": slug,
            "version": current_version,
            "selected_count": int(collection.get("publishedSelectedCount") or 0),
        },
        versions=versions,
        next_cursor=next_cursor,
    )
    return JSONResponse(payload.model_dump(mode="json"), headers=response_headers)


@router.get("/{slug}/versions/{version}", response_model=CollectionDistributionEnvelopeV1)
def exact_collection_version_page(
    slug: str,
    version: int = Path(ge=1),
    authorization: str | None = Header(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=200),
    cms_db: CmsReadOnlyDatabase = Depends(get_cms_read_database),
    operational_db: Database = Depends(get_database),
):
    principal = _consumer(authorization, cms_db)
    response_headers = _response_headers(principal, operational_db)
    _collection, collection_id = _authorize_published_collection(
        slug=slug, principal=principal, cms_db=cms_db, response_headers=response_headers
    )
    version_document = cms_db.collection("collection_versions").find_one(
        {"collectionId": collection_id, "version": version, "status": "published"}
    )
    if not version_document:
        raise HTTPException(status_code=404, detail="Collection version not found", headers=response_headers)

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
            memberships.find(_membership_query(collection_id, version, last_seen), {"_id": 0, "curationId": 1})
            .sort("curationId", 1)
            .limit(batch_limit)
        )
        if not rows:
            exhausted = True
            break
        ids = [row.get("curationId") for row in rows if isinstance(row.get("curationId"), str)]
        last_seen = ids[-1] if ids else last_seen
        batch = hydrate_public_batch(operational_db, ids)
        items.extend(batch.items[: limit - len(items)])
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
    payload = CollectionDistributionEnvelopeV1(
        collection={
            "slug": slug,
            "version": version,
            "selected_count": int(version_document.get("selectedCount") or 0),
        },
        items=items,
        unavailable=unavailable,
        available_count=len(items),
        unavailable_count=len(unavailable),
        next_cursor=next_cursor,
    )
    return JSONResponse(payload.model_dump(mode="json"), headers=response_headers)


@router.get("/{slug}/dump")
def current_collection_dump(
    slug: str,
    authorization: str | None = Header(default=None),
    accept_encoding: str = Header(default=""),
    cms_db: CmsReadOnlyDatabase = Depends(get_cms_read_database),
    operational_db: Database = Depends(get_database),
):
    principal = _consumer(authorization, cms_db)
    response_headers = _response_headers(principal, operational_db)
    collection, collection_id = _authorize_published_collection(
        slug=slug, principal=principal, cms_db=cms_db, response_headers=response_headers
    )
    version = collection.get("currentPublishedVersion")
    if collection.get("lifecycle") != "published" or not isinstance(version, int) or version < 1:
        raise HTTPException(status_code=404, detail="Collection not found", headers=response_headers)

    return _stream_collection_dump(
        slug=slug,
        collection_id=collection_id,
        version=version,
        selected_count=int(collection.get("publishedSelectedCount") or 0),
        accept_encoding=accept_encoding,
        cms_db=cms_db,
        operational_db=operational_db,
        response_headers=response_headers,
    )


@router.get("/{slug}/versions/{version}/dump")
def exact_collection_version_dump(
    slug: str,
    version: int = Path(ge=1),
    authorization: str | None = Header(default=None),
    accept_encoding: str = Header(default=""),
    cms_db: CmsReadOnlyDatabase = Depends(get_cms_read_database),
    operational_db: Database = Depends(get_database),
):
    principal = _consumer(authorization, cms_db)
    response_headers = _response_headers(principal, operational_db)
    _collection, collection_id = _authorize_published_collection(
        slug=slug, principal=principal, cms_db=cms_db, response_headers=response_headers
    )
    version_document = cms_db.collection("collection_versions").find_one(
        {"collectionId": collection_id, "version": version, "status": "published"}
    )
    if not version_document:
        raise HTTPException(status_code=404, detail="Collection version not found", headers=response_headers)
    return _stream_collection_dump(
        slug=slug,
        collection_id=collection_id,
        version=version,
        selected_count=int(version_document.get("selectedCount") or 0),
        accept_encoding=accept_encoding,
        cms_db=cms_db,
        operational_db=operational_db,
        response_headers=response_headers,
    )
