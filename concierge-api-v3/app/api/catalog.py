"""Payload-only, bounded catalog selection endpoints."""

import json

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from pymongo.database import Database

from app.core.database import get_database
from app.core.security import verify_cms_service
from app.core.config import settings
from app.models.catalog import (
    DEFAULT_CURATION_SORT,
    EXCLUDE_CURATION_IDS_MAX,
    AdminFilterCondition,
    CatalogFilters,
    CatalogSearchPage,
    CatalogScanPage,
    CatalogScanPageRequest,
    CatalogScanStart,
    CatalogScanStartRequest,
    ConceptFilter,
    CurationSort,
    ResolveCurationsRequest,
    ResolveCurationsResponse,
)
from app.services.catalog_service import (
    CatalogCursorError,
    catalog_scan_page,
    catalog_search_page,
    resolve_curations,
    start_catalog_scan,
)

router = APIRouter(prefix="/catalog", tags=["cms-catalog"])

# Concepts reach the list as repeated dynamic query keys (`concept.Mood=Casual`),
# so the parameter cannot be declared as a typed one; see `_query_concepts`.
CONCEPT_QUERY_PREFIX = "concept."


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


def _query_concepts(request: Request) -> list[ConceptFilter]:
    """Repeated ``concept.<Category>=<value>`` conditions, validated by the same
    model the scan body uses.

    A rejection reuses FastAPI's own request-validation error shape so the
    dynamic parameter reports exactly like a declared enum one.
    """
    conditions = [
        (key[len(CONCEPT_QUERY_PREFIX) :], value)
        for key, value in request.query_params.multi_items()
        if key.startswith(CONCEPT_QUERY_PREFIX)
    ]
    concepts: list[ConceptFilter] = []
    for category, value in conditions:
        try:
            concepts.append(ConceptFilter(category=category, value=value))
        except ValidationError as exc:
            first = exc.errors()[0]
            raise RequestValidationError(
                [
                    {
                        "type": first["type"],
                        "loc": ("query", f"{CONCEPT_QUERY_PREFIX}{category}"),
                        "msg": first["msg"],
                        "input": first["input"],
                    }
                ]
            ) from None
    return concepts


def _where_conditions(raw_conditions: list[str]) -> list[AdminFilterCondition]:
    """Repeated ``where=<json>`` conditions, validated by the scan body's model.

    Each value is one URL-encoded JSON object. A rejection reuses FastAPI's own
    request-validation error shape, exactly like the dynamic concept keys, so
    the Admin reports a bad condition like any other query parameter.
    """
    conditions: list[AdminFilterCondition] = []
    for raw in raw_conditions:
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            raise _invalid_where(raw, "json_invalid", "Value is not valid JSON") from None
        if not isinstance(payload, dict):
            raise _invalid_where(raw, "dict_type", "Value is not a JSON object") from None
        try:
            conditions.append(AdminFilterCondition(**payload))
        except ValidationError as exc:
            first = exc.errors()[0]
            raise _invalid_where(first["input"], first["type"], first["msg"]) from None
    return conditions


def _invalid_where(value: object, error_type: str, message: str) -> RequestValidationError:
    return RequestValidationError([{"type": error_type, "loc": ("query", "where"), "msg": message, "input": value}])


@router.get(
    "/curations",
    response_model=CatalogSearchPage,
    openapi_extra={
        "parameters": [
            {
                "name": "concept.<Category>",
                "in": "query",
                "required": False,
                "schema": {"type": "string"},
                "description": (
                    "Repeated array-contains condition on the stored `categories.<Category>` array; "
                    "every supplied condition must hold. The category may not contain `$`, `.` or a "
                    "null byte."
                ),
            }
        ]
    },
)
def search_curations(
    request: Request,
    q: str | None = Query(default=None, max_length=200),
    statuses: list[str] = Query(default=[], alias="status"),
    city: str | None = Query(default=None, max_length=120),
    entity_type: str | None = Query(default=None, max_length=80),
    curator_id: str | None = Query(default=None, max_length=200),
    unlinked: bool | None = Query(
        default=None,
        description=(
            "true lists only Curations with no Entity (``entity_id`` missing, null, empty or "
            "whitespace-only); false lists only the ones that have one."
        ),
    ),
    where: list[str] = Query(
        default=[],
        description=(
            "Repeated advanced condition, each value a URL-encoded JSON object "
            '`{"field": "<path>", "op": "<op>", "value": <json>}`; every condition must hold.'
        ),
    ),
    sort: CurationSort = Query(default=DEFAULT_CURATION_SORT),
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
            unlinked=unlinked,
            concepts=_query_concepts(request),
            where=_where_conditions(where),
            sort=sort,
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
    # The exclusion set rides inside the signed scan token, so it is bounded
    # exactly like the member set ``/content-health`` accepts: over the bound the
    # request is refused instead of minting an unbounded token.
    if len(request.filters.exclude_curation_ids) > EXCLUDE_CURATION_IDS_MAX:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"At most {EXCLUDE_CURATION_IDS_MAX} excluded curation ids are accepted",
        )
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
