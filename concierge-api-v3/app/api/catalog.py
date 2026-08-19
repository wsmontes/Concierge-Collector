"""Payload-only, bounded catalog selection endpoints."""

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pymongo.database import Database

from app.core.database import get_database
from app.core.security import verify_cms_service
from app.core.config import settings
from app.models.catalog import (
    CatalogScanPage,
    CatalogScanPageRequest,
    CatalogScanStart,
    CatalogScanStartRequest,
    ResolveCurationsRequest,
    ResolveCurationsResponse,
)
from app.services.catalog_service import CatalogCursorError, catalog_scan_page, resolve_curations, start_catalog_scan

router = APIRouter(prefix="/catalog", tags=["cms-catalog"])


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
