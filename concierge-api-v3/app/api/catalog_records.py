"""Universal read access to stored Curation and Entity documents for the CMS.

Fase 0 of the editorial CMS plan: the Admin must render 100% of a stored
record, so these CMS-boundary routes return the stored document itself —
BSON-only values made JSON-safe, unknown and legacy keys preserved — instead of
the allowlisted projection served by ``/catalog/curations``. Read-only by
design; writes stay on the domain routes.

The same boundary also serves the batch reads the editorial screens need
without a per-row round trip: the Admin list row of many Curations at once
(Collection members, draft diffs) and the aggregate counters of the overview.
"""

from __future__ import annotations

from datetime import date, datetime
import re
from typing import Any

from bson import ObjectId
from bson.decimal128 import Decimal128
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pymongo.database import Database

from app.api.curations import update_curation_document
from app.api.entities import apply_entity_update, find_entity
from app.core.database import get_database
from app.core.query_utils import resolve_after_id
from app.core.security import verify_cms_service
from app.models.catalog_records import (
    CONTENT_HEALTH_MEMBER_LIMIT,
    CatalogRecordResponse,
    CmsCurationUpdate,
    CmsEntityUpdate,
    ContentHealthRequest,
    ContentHealthResponse,
    CurationSummariesRequest,
    CurationSummariesResponse,
    EntityCurationsPage,
    EntityListPage,
    EntityRow,
)
from app.services.catalog_service import (
    content_health,
    curation_summaries,
    require_current_cms_admin,
    utc_iso,
)
from app.services.curation_denorm import denormalize_curation_location
from app.services.curation_service import find_curation

router = APIRouter(prefix="/catalog", tags=["cms-catalog"])

# The list row needs the canonical top-level `city` and the flexible `data`
# blob (the other city shapes are derived from it) plus the inventory columns;
# embeddings and capture payloads stay out of it.
_ENTITY_LIST_PROJECTION = {
    "_id": 1,
    "entity_id": 1,
    "name": 1,
    "type": 1,
    "status": 1,
    "city": 1,
    "data": 1,
    "updatedAt": 1,
    "version": 1,
}
_DELETED_STATUS = "deleted"
_MIN_OBJECT_ID = ObjectId("0" * 24)

# System-managed root keys the CMS edit surface refuses (plan §3). Checked
# against the RAW request body, before any model construction, so a rejected
# key never reaches the update pipeline or a write.
CURATION_SYSTEM_FIELDS = (
    "_id",
    "id",
    "curation_id",
    "version",
    "createdAt",
    "updatedAt",
    "createdBy",
    "updatedBy",
    "catalog_sequence",
    "embeddings",
    "embeddings_metadata",
)
ENTITY_SYSTEM_FIELDS = (
    "_id",
    "id",
    "entity_id",
    "version",
    "createdAt",
    "updatedAt",
    "createdBy",
    "updatedBy",
)

# Root keys that are the API's OWN derived state, not editorial content: the
# CMS neither writes nor sees them. `display_media` is resolved and persisted by
# app/services/display_media_service (the hero of the card), so a CMS write
# would be planting a reference the resolver owns, and the Admin's record
# inspector renders every raw key — an internal fact must not show up there as
# if it were an editable field.
ENTITY_INTERNAL_FIELDS = ("display_media",)

CMS_WRITE_ROLES = ("admin", "curator")
DEFAULT_CMS_WRITE_ROLE = "curator"


def _record_for_cms(document: dict[str, Any]) -> dict[str, Any]:
    """The stored Entity for the CMS record view: JSON-safe, minus the API's own
    derived keys (see ``ENTITY_INTERNAL_FIELDS``)."""
    return json_safe_record({key: value for key, value in document.items() if key not in ENTITY_INTERNAL_FIELDS})


def _reject_system_fields(system_fields: tuple[str, ...]):
    """Dependency factory rejecting a system-managed key on the raw body."""

    async def dependency(request: Request) -> None:
        try:
            body = await request.json()
        except ValueError:
            return
        if not isinstance(body, dict):
            return
        rejected = next((key for key in system_fields if key in body), None)
        if rejected is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Field '{rejected}' is managed by the system and cannot be updated",
            )

    return dependency


def _cms_actor_subject(db: Database, actor: str) -> str:
    """Canonical subject for the asserted CMS actor.

    Payload forwards the opaque operational ``user_id``, while the domain
    binds ownership (``curator_id``) and ``updatedBy`` to the stable email
    subject. Reload the user record — by id or email, the same probe order the
    CMS read boundary uses — and hand its email to the domain helpers, so
    "the actor is the owner" means the same thing on both sides. An actor with
    no operational record stays as asserted: the service key is the trust
    boundary either way.
    """
    actor_ids: list[object] = [actor]
    if ObjectId.is_valid(actor):
        actor_ids.append(ObjectId(actor))
    user = db.users.find_one({"$or": [{"_id": {"$in": actor_ids}}, {"email": actor}]})
    email = (user or {}).get("email")
    return email if isinstance(email, str) and email else actor


def _cms_write_auth(db: Database, actor_id: str | None, actor_role: str | None) -> dict[str, str]:
    """Resolve the CMS write actor into the domain auth dict.

    Admin authority and ownership rules then follow the SAME helpers the
    domain routes use (``is_admin_auth``, ``resolve_ownership_action``) — there
    is no second implementation of either.
    """
    actor = _actor(actor_id)
    role = (actor_role or DEFAULT_CMS_WRITE_ROLE).strip().lower()
    if role not in CMS_WRITE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"CMS actor role '{role}' cannot write",
        )
    return {"user": _cms_actor_subject(db, actor), "role": role, "method": "cms_actor"}


def _actor(actor_id: str | None) -> str:
    if not actor_id or not actor_id.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CMS actor is required")
    return actor_id.strip()


def _binary_summary(value: Any) -> dict[str, Any]:
    """Summary of stored bytes — the payload itself is never returned."""
    subtype = getattr(value, "subtype", None)
    return {
        "format": "binary-float32" if subtype in (0, None) else "binary",
        "byte_length": len(value),
    }


def _is_numeric_vector(value: Any) -> bool:
    return (
        isinstance(value, list)
        and bool(value)
        and all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value)
    )


def _embeddings_list_summary(value: Any) -> dict[str, Any] | None:
    """Shape of a list-of-vectors ``embeddings`` value, derived from the data."""
    if isinstance(value, list) and value and all(_is_numeric_vector(vector) for vector in value):
        return {"format": "float-array", "vector_count": len(value), "dimensions": len(value[0])}
    return None


def json_safe_record(value: Any, key: str | None = None) -> Any:
    """Recursively convert one stored Mongo value into JSON-safe data.

    ``ObjectId``/``Decimal128`` become strings, ``date``/``datetime`` become
    ISO-8601 strings, binary values (packed float32 embedding vectors included)
    become a ``{"format": ..., "byte_length": N}`` summary and the Mongo
    ``_id`` key is renamed to ``id``. Dicts and lists recurse; every other
    value passes through unchanged, so unknown and legacy keys — the guarantee
    the Field Inspector relies on — survive the round trip.
    """
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return utc_iso(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal128):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return _binary_summary(value)
    if key == "embeddings":
        summary = _embeddings_list_summary(value)
        if summary is not None:
            return summary
    if isinstance(value, dict):
        return {("id" if field == "_id" else field): json_safe_record(item, field) for field, item in value.items()}
    if isinstance(value, list):
        return [json_safe_record(item) for item in value]
    return value


def _entity_reference_variants(document: dict[str, Any]) -> list[Any]:
    """Every value a stored Curation may use to reference this Entity.

    Curations reference the Entity by the string ``_id`` (created via the API)
    or by the ``entity_id`` slug; documents imported in bulk may carry an
    ObjectId ``_id`` whose string form is what gets denormalized.
    """
    variants: list[Any] = []
    identifier = document.get("_id")
    if identifier is not None:
        variants.append(identifier)
        if isinstance(identifier, ObjectId):
            variants.append(str(identifier))
    slug = document.get("entity_id")
    if slug and slug not in variants:
        variants.append(slug)
    return variants


def _curations_count_by_entity(db: Database, rows: list[dict[str, Any]]) -> dict[str, int]:
    """Count Curations per Entity with ONE aggregation for the whole page.

    The ``$match`` is restricted to the page's entity references (never a
    per-row query) and skips ``status == "deleted"`` tombstones so the list
    column matches what an editor can actually open.
    """
    variants: list[Any] = []
    for row in rows:
        for variant in _entity_reference_variants(row):
            if variant not in variants:
                variants.append(variant)
    if not variants:
        return {}
    pipeline = [
        {"$match": {"entity_id": {"$in": variants}, "status": {"$ne": _DELETED_STATUS}}},
        {"$group": {"_id": "$entity_id", "count": {"$sum": 1}}},
    ]
    counts: dict[str, int] = {}
    for grouped in db.curations.aggregate(pipeline):
        counts[str(grouped["_id"])] = int(grouped["count"])
    return counts


def _curation_ids_by_entity(db: Database, rows: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Curation ids per Entity row with ONE query for the whole page.

    Companion of ``_curations_count_by_entity``: the Admin cannot join the
    Collection membership ledger from here (it lives in the CMS database), so
    the boundary hands it the page's Curation ids and the BFF counts the
    Collections. The ``$match`` is restricted to the page's entity references
    (never a per-row query) and skips the same ``status == "deleted"``
    tombstones the count skips, so the two fields always agree.
    """
    row_id_by_reference: dict[Any, str] = {}
    for row in rows:
        row_id = str(row.get("_id"))
        for variant in _entity_reference_variants(row):
            row_id_by_reference.setdefault(variant, row_id)
    if not row_id_by_reference:
        return {}
    ids: dict[str, list[str]] = {}
    cursor = db.curations.find(
        {"entity_id": {"$in": list(row_id_by_reference)}, "status": {"$ne": _DELETED_STATUS}},
        {"_id": 1, "entity_id": 1, "curation_id": 1},
    )
    for document in cursor:
        row_id = row_id_by_reference.get(document.get("entity_id"))
        if row_id is not None:
            # The CMS identity of a stored Curation is its ``curation_id`` — the
            # handle every other boundary read and the membership ledger use —
            # with ``_id`` as the fallback for a document that carries no field.
            ids.setdefault(row_id, []).append(str(document.get("curation_id") or document["_id"]))
    return ids


def _entity_city(document: dict[str, Any]) -> str | None:
    """The Entity's city through every shape the domain writes.

    `app/api/entities.py::_city_filter_clauses` documents the chain: a
    top-level `city` (canonical since the 2026-08 backfill), then
    `data.location.city` (bulk OSM/Overture) and `data.address.city` /
    `data.address.street` (Places v3 and legacy address strings) — the last
    three are exactly what `denormalize_curation_location` already parses, so
    this delegates instead of growing a second parser. `data.city` is the
    remaining shape written by the Places enrichment path.
    """
    top_level = document.get("city")
    if isinstance(top_level, str) and top_level.strip():
        return top_level

    derived = denormalize_curation_location(document).get("city")
    if isinstance(derived, str) and derived.strip():
        return derived

    data = document.get("data")
    flat = data.get("city") if isinstance(data, dict) else None
    return flat if isinstance(flat, str) and flat.strip() else None


def _after_updated_at(anchor: dict[str, Any]) -> dict[str, Any]:
    """Keyset clause for the ``updated_at`` desc / ``_id`` desc listing."""
    return {
        "$or": [
            {"updatedAt": {"$lt": anchor["updatedAt"]}},
            {"updatedAt": anchor["updatedAt"], "_id": {"$lt": anchor["_id"]}},
        ]
    }


@router.get("/curations/{curation_id}/record", response_model=CatalogRecordResponse)
def read_curation_record(
    curation_id: str,
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CatalogRecordResponse:
    """Return the complete stored Curation document, JSON-safe."""
    require_current_cms_admin(db, _actor(actor_id))
    document = find_curation(db, curation_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Curation {curation_id} not found")
    return CatalogRecordResponse(record=json_safe_record(document))


@router.patch(
    "/curations/{curation_id}",
    response_model=CatalogRecordResponse,
    dependencies=[Depends(_reject_system_fields(CURATION_SYSTEM_FIELDS))],
)
def update_curation_record(
    curation_id: str,
    updates: CmsCurationUpdate,
    if_match: str | None = Header(None, alias="If-Match"),
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    actor_role: str | None = Header(None, alias="X-CMS-Actor-Role"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CatalogRecordResponse:
    """Update any editable root key of a stored Curation.

    The domain update pipeline runs unchanged — ownership, version CAS,
    entity denormalization and embeddings bookkeeping included — with the CMS
    actor as its author. Returns the complete updated document, JSON-safe.
    """
    auth = _cms_write_auth(db, actor_id, actor_role)
    if not if_match or not if_match.strip():
        raise HTTPException(status_code=status.HTTP_428_PRECONDITION_REQUIRED, detail="If-Match header required")
    document = update_curation_document(db, curation_id, updates, auth, if_match, projection=None)
    return CatalogRecordResponse(record=json_safe_record(document))


@router.post("/curations/summaries", response_model=CurationSummariesResponse)
def read_curation_summaries(
    request: CurationSummariesRequest,
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CurationSummariesResponse:
    """The Admin list row of many Curations in one query, in the requested order.

    Humanizes Collection members and draft diffs. Ids that do not exist are
    omitted instead of rejected, so a stale membership renders as nothing.
    """
    return CurationSummariesResponse(**curation_summaries(db, request.curation_ids, _actor(actor_id)))


@router.post("/content-health", response_model=ContentHealthResponse)
def read_content_health(
    request: ContentHealthRequest,
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> ContentHealthResponse:
    """Editorial counters for the Admin overview, over non-deleted Curations."""
    if len(request.member_curation_ids) > CONTENT_HEALTH_MEMBER_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"At most {CONTENT_HEALTH_MEMBER_LIMIT} member curation ids are accepted",
        )
    return ContentHealthResponse(**content_health(db, request.member_curation_ids, _actor(actor_id)))


@router.get("/entities", response_model=EntityListPage)
def list_stored_entities(
    q: str | None = Query(default=None, max_length=200),
    entity_type: str | None = Query(default=None, alias="type", max_length=80),
    entity_status: str | None = Query(default=None, alias="status", max_length=80),
    limit: int = Query(default=50, ge=1, le=200),
    after_id: str | None = Query(default=None, max_length=200),
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> EntityListPage:
    """Page the stored Entity collection ordered by ``_id`` ascending.

    ``q`` matches ``name``, ``entity_id`` or ``externalId`` case-insensitively.
    ``after_id`` is the ``id`` of the last row of the previous page; when a page
    comes back full, its last ``id`` is returned as ``next_cursor``.
    """
    require_current_cms_admin(db, _actor(actor_id))
    query: dict[str, Any] = {}
    if entity_type:
        query["type"] = entity_type
    if entity_status:
        query["status"] = entity_status
    if q:
        pattern = re.escape(q)
        query["$or"] = [
            {"name": {"$regex": pattern, "$options": "i"}},
            {"entity_id": {"$regex": pattern, "$options": "i"}},
            {"externalId": {"$regex": pattern, "$options": "i"}},
        ]
    total = db.entities.count_documents(query)
    page_query = dict(query)
    if after_id:
        page_query["_id"] = {"$gt": resolve_after_id(db, "entities", after_id)}
    rows = list(db.entities.find(page_query, _ENTITY_LIST_PROJECTION).sort("_id", 1).limit(limit))
    if not rows and after_id and isinstance(page_query["_id"]["$gt"], str):
        # The string segment of ``_id`` is exhausted; comparison operators are
        # type-bracketed, so the ObjectId ``_id`` documents imported in bulk
        # are only reachable from the next segment (same hazard, same fix as
        # the domain entity list).
        transition = dict(page_query)
        transition["_id"] = {"$gt": _MIN_OBJECT_ID}
        rows = list(db.entities.find(transition, _ENTITY_LIST_PROJECTION).sort("_id", 1).limit(limit))
    counts = _curations_count_by_entity(db, rows)
    curation_ids = _curation_ids_by_entity(db, rows)
    items: list[EntityRow] = []
    for row in rows:
        updated_at = row.get("updatedAt")
        items.append(
            EntityRow(
                id=str(row.get("_id")),
                entity_id=row.get("entity_id"),
                name=row.get("name"),
                type=row.get("type"),
                status=row.get("status"),
                city=_entity_city(row),
                # Same rule as the Curation rows: a BSON datetime is UTC, so the
                # serialized value has to carry the offset the driver dropped.
                updated_at=utc_iso(updated_at) if isinstance(updated_at, datetime) else updated_at,
                version=row.get("version"),
                curations_count=sum(counts.get(str(variant), 0) for variant in _entity_reference_variants(row)),
                curation_ids=curation_ids.get(str(row.get("_id")), []),
            )
        )
    return EntityListPage(
        items=items,
        next_cursor=items[-1].id if items and len(items) == limit else None,
        total=total,
    )


@router.get("/entities/{entity_id}/record", response_model=CatalogRecordResponse)
def read_entity_record(
    entity_id: str,
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CatalogRecordResponse:
    """Return the complete stored Entity document, JSON-safe.

    Every stored key is returned except the API's own derived ones
    (``ENTITY_INTERNAL_FIELDS``) — the inspector renders raw fields, and the
    display media fact is not editorial content.
    """
    require_current_cms_admin(db, _actor(actor_id))
    document = find_entity(db, entity_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Entity {entity_id} not found")
    return CatalogRecordResponse(record=_record_for_cms(document))


@router.patch(
    "/entities/{entity_id}",
    response_model=CatalogRecordResponse,
    dependencies=[Depends(_reject_system_fields(ENTITY_SYSTEM_FIELDS + ENTITY_INTERNAL_FIELDS))],
)
def update_entity_record(
    entity_id: str,
    updates: CmsEntityUpdate,
    if_match: str | None = Header(None, alias="If-Match"),
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    actor_role: str | None = Header(None, alias="X-CMS-Actor-Role"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CatalogRecordResponse:
    """Update any editable root key of a stored Entity.

    Same pipeline as the domain PATCH (ordered CAS probe, linked-Curation
    denormalization) and the same ``If-Match`` convention: 428 when the header
    is missing, 409 on a version conflict.
    """
    _cms_write_auth(db, actor_id, actor_role)
    document = apply_entity_update(db, entity_id, updates, if_match)
    return CatalogRecordResponse(record=_record_for_cms(document))


@router.get("/entities/{entity_id}/curations", response_model=EntityCurationsPage)
def list_entity_curations(
    entity_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    after_id: str | None = Query(default=None, max_length=200),
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> EntityCurationsPage:
    """Every stored Curation attached to the Entity, newest ``updatedAt`` first.

    ``after_id`` is the ``id`` of the last Curation of the previous page; the
    anchor is resolved back to its ``(updatedAt, _id)`` position, so paging
    stays consistent while the collection is written to.
    """
    require_current_cms_admin(db, _actor(actor_id))
    entity = find_entity(db, entity_id)
    if entity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Entity {entity_id} not found")
    scope: dict[str, Any] = {"entity_id": {"$in": _entity_reference_variants(entity)}}
    total = db.curations.count_documents(scope)
    query: dict[str, Any] = scope
    if after_id:
        anchor = db.curations.find_one(
            {**scope, "_id": resolve_after_id(db, "curations", after_id)},
            {"_id": 1, "updatedAt": 1},
        )
        if anchor is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid curation cursor")
        query = {"$and": [scope, _after_updated_at(anchor)]}
    rows = list(db.curations.find(query).sort([("updatedAt", -1), ("_id", -1)]).limit(limit))
    return EntityCurationsPage(items=[json_safe_record(row) for row in rows], total=total)
