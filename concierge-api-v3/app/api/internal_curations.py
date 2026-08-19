"""Service-key-only availability endpoint for the CMS publish worker."""

from fastapi import APIRouter, Depends
from pymongo.database import Database

from app.core.database import get_database
from app.core.security import verify_cms_service
from app.models.distribution import HydrateCurationsRequest, HydrateCurationsResponse
from app.services.distribution_service import hydrate_public_items

router = APIRouter(prefix="/internal/curations", tags=["cms-distribution"])


@router.post("/hydrate", response_model=HydrateCurationsResponse)
def hydrate_curations(
    request: HydrateCurationsRequest,
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> HydrateCurationsResponse:
    return hydrate_public_items(db, request.curation_ids)
