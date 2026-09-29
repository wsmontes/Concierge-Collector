"""Payload-only, bounded catalog selection endpoints."""

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import TypeAdapter, ValidationError
from pymongo.database import Database
from pymongo.errors import OperationFailure, WriteError

from app.api.entities import find_entity
from app.core.database import get_database
from app.core.security import verify_cms_service
from app.core.config import settings
from app.models.catalog import (
    CatalogFilters,
    CatalogSearchPage,
    CatalogScanPage,
    CatalogScanPageRequest,
    CatalogScanStart,
    CatalogScanStartRequest,
    ResolveCurationsRequest,
    ResolveCurationsResponse,
)
from app.models.content import ContentRecordResponse, CurationFieldPatch
from app.models.schemas import CurationStatus
from app.services.catalog_service import (
    CatalogCursorError,
    catalog_scan_page,
    catalog_search_page,
    resolve_curations,
    start_catalog_scan,
)
from app.services.cms_auth_service import load_cms_authorization
from app.services.curation_service import find_curation
from app.services.record_serialization import curation_record, entity_record

router = APIRouter(prefix="/catalog", tags=["cms-catalog"])

# Server-owned Curation fields the editorial writer must never patch: identity
# and bookkeeping feed the CAS fence, and replacing embeddings bypasses the
# vector store's own write path.
_IMMUTABLE_PATCH_FIELDS = frozenset(
    {
        "_id",
        "id",
        "curation_id",
        "version",
        "createdAt",
        "updatedAt",
        "createdBy",
        "updatedBy",
        "embeddings",
        "embeddings_metadata",
        "catalog_sequence",
    }
)
# city/type are denormalized projections of the Entity. Accepting them here
# would let a second, drifting city exist on the Curation — the editor must be
# sent to the Entity instead.
_ENTITY_PROJECTION_PATCH_FIELDS = frozenset({"city", "type"})
_STATUS_VALIDATOR = TypeAdapter(CurationStatus)
_MISSING = object()


def _invalid_request() -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_request")


def _assign_patch_value(container: Any, segments: list[str], value: Any) -> None:
    """Set ``value`` at the dotted ``segments`` inside ``container``, in place.

    Reproduces Mongo's ``$set`` traversal (creating intermediate objects,
    indexing arrays with a numeric segment) so an impossible path — writing
    into an existing scalar — is rejected here instead of surfacing a driver
    WriteError as a 500.
    """
    head, tail = segments[0], segments[1:]
    if isinstance(container, list):
        if not head.isdigit():
            raise _invalid_request()
        index = int(head)
        if index >= len(container):
            container.extend([None] * (index + 1 - len(container)))
            child: Any = _MISSING
        else:
            child = container[index]
        if not tail:
            container[index] = value
            return
        if child is _MISSING:
            child = {}
            container[index] = child
        elif not isinstance(child, (dict, list)):
            raise _invalid_request()
        _assign_patch_value(child, tail, value)
        return

    child = container.get(head, _MISSING)
    if not tail:
        container[head] = value
        return
    if child is _MISSING:
        child = {}
        container[head] = child
    elif not isinstance(child, (dict, list)):
        raise _invalid_request()
    _assign_patch_value(child, tail, value)


def _patch_set_document(current: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any]:
    """Validate the patch paths and build the ``$set`` payload.

    Each touched root field is written as a merged copy of its stored container,
    which preserves the unknown sibling fields a dotted ``$set`` would keep.
    """
    set_document: dict[str, Any] = {}
    for path, value in fields.items():
        segments = path.split(".")
        if any(not segment or segment.startswith("$") for segment in segments):
            raise _invalid_request()
        head, tail = segments[0], segments[1:]
        if head in _IMMUTABLE_PATCH_FIELDS or head in _ENTITY_PROJECTION_PATCH_FIELDS:
            raise _invalid_request()
        if head == "status":
            try:
                _STATUS_VALIDATOR.validate_python(value)
            except ValidationError as exc:
                raise _invalid_request() from exc
        if not tail:
            set_document[head] = value
            continue
        if head in set_document:
            container = set_document[head]
        else:
            stored = current.get(head, _MISSING)
            if stored is _MISSING:
                container = {}
            elif isinstance(stored, (dict, list)):
                container = deepcopy(stored)
            else:
                raise _invalid_request()
            set_document[head] = container
        _assign_patch_value(container, tail, value)
    return set_document


@router.post("/curations/resolve", response_model=ResolveCurationsResponse)
def resolve_curation_selection(
    request: ResolveCurationsRequest,
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> ResolveCurationsResponse:
    """Resolve an explicit selection for a currently authorized CMS admin."""

    if not actor_id or not actor_id.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CMS actor is required")
    return resolve_curations(db, request.curation_ids, actor_id.strip())


def _actor(actor_id: str | None) -> str:
    if not actor_id or not actor_id.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CMS actor is required")
    return actor_id.strip()


@router.get("/curations", response_model=CatalogSearchPage)
def search_curations(
    q: str | None = Query(default=None, max_length=200),
    statuses: list[str] = Query(default=[], alias="status"),
    city: str | None = Query(default=None, max_length=120),
    entity_type: str | None = Query(default=None, max_length=80),
    curator_id: str | None = Query(default=None, max_length=200),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CatalogSearchPage:
    try:
        filters = CatalogFilters(
            q=q,
            status=statuses,
            city=city,
            entity_type=entity_type,
            curator_id=curator_id,
        )
        return CatalogSearchPage(
            **catalog_search_page(
                db,
                _actor(actor_id),
                filters.model_dump(mode="python"),
                cursor,
                limit,
                settings.catalog_cursor_secret_value,
            )
        )
    except CatalogCursorError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid catalog cursor") from exc


@router.post("/curations/scan/start", response_model=CatalogScanStart)
def start_scan(
    request: CatalogScanStartRequest,
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CatalogScanStart:
    return CatalogScanStart(
        **start_catalog_scan(
            db, _actor(actor_id), request.filters.model_dump(mode="json"), settings.catalog_cursor_secret_value
        )
    )


@router.post("/curations/scan/page", response_model=CatalogScanPage)
def scan_page(
    request: CatalogScanPageRequest,
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CatalogScanPage:
    try:
        return CatalogScanPage(
            **catalog_scan_page(
                db,
                _actor(actor_id),
                request.scan_token,
                request.cursor,
                request.limit,
                settings.catalog_cursor_secret_value,
            )
        )
    except CatalogCursorError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invalid catalog cursor") from exc


@router.get("/curations/{curation_id}", response_model=ContentRecordResponse)
def get_curation_record(
    curation_id: str,
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> ContentRecordResponse:
    """Return the whole curation document for the Admin record inspector.

    Declared after the literal ``/curations`` search route so the parameterized
    path never shadows the search page.
    """
    doc = find_curation(db, curation_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Curation {curation_id} not found")
    return ContentRecordResponse(
        kind="curation",
        id=str(doc.get("curation_id") or doc.get("_id")),
        record=curation_record(doc),
    )


@router.get("/entities/{entity_id}", response_model=ContentRecordResponse)
def get_entity_record(
    entity_id: str,
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> ContentRecordResponse:
    """Return the whole entity document for the Admin record inspector."""
    doc = find_entity(db, entity_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Entity {entity_id} not found")
    return ContentRecordResponse(
        kind="entity",
        id=str(doc.get("entity_id") or doc.get("_id")),
        record=entity_record(doc),
    )


@router.patch("/curations/{curation_id}", response_model=ContentRecordResponse)
def patch_curation_record(
    curation_id: str,
    patch: CurationFieldPatch,
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    if_match: str | None = Header(None, alias="If-Match"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> ContentRecordResponse:
    """Apply a dotted-field patch under a mandatory version fence.

    The CMS holds a Payload session, not a FastAPI JWT, so this is the
    service-credentialed writer: authorization is the live CMS-admin reload
    (401/403 propagate), and ``If-Match`` is required because an unfenced write
    would silently overwrite whichever version the editor last saw.
    """
    actor = _actor(actor_id)
    raw_version = if_match.strip().strip('"') if if_match else ""
    if not raw_version.isdigit():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid If-Match header format")
    expected_version = int(raw_version)

    authorization = load_cms_authorization(db, actor)
    current = find_curation(db, curation_id)
    if not current:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Curation {curation_id} not found")

    set_document = _patch_set_document(current, patch.fields)
    set_document["updatedAt"] = datetime.now(timezone.utc)
    set_document["updatedBy"] = str(authorization.email)

    if "version" in current:
        write_filter: dict[str, Any] = {"_id": current["_id"], "version": expected_version}
    else:
        # Legacy documents carry no version, but they still CAS: only one
        # writer may claim the absent-version snapshot.
        write_filter = {"_id": current["_id"], "version": {"$exists": False}}

    try:
        result = db.curations.find_one_and_update(
            write_filter,
            {"$set": set_document, "$inc": {"version": 1}},
            return_document=True,
        )
    except (OperationFailure, WriteError) as exc:
        raise _invalid_request() from exc
    if not result:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Version conflict")

    return ContentRecordResponse(
        kind="curation",
        id=str(result.get("curation_id") or result.get("_id")),
        record=curation_record(result),
    )
