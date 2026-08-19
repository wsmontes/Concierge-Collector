"""Payload-only, bounded catalog selection endpoints."""

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pymongo.database import Database

from app.core.database import get_database
from app.core.security import verify_cms_service
from app.models.catalog import ResolveCurationsRequest, ResolveCurationsResponse
from app.services.catalog_service import resolve_curations

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
