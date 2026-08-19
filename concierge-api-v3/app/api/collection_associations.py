"""Read-only published Collection associations for an authenticated Collector."""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pymongo.database import Database

from app.core.database import get_cms_database, get_database
from app.core.security import verify_auth
from app.models.collection_associations import PublishedCollectionAssociationResponse


router = APIRouter(prefix="/curations", tags=["collections"])


def _interactive_subject(auth: dict) -> str:
    if auth.get("method") not in {"jwt", "cookie"} or not isinstance(auth.get("user"), str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Interactive authentication required")
    return auth["user"]


@router.get("/{curation_id}/collections", response_model=PublishedCollectionAssociationResponse)
def published_associations(
    curation_id: str,
    auth: dict = Depends(verify_auth),
    operational_db: Database = Depends(get_database),
    cms_db: Database = Depends(get_cms_database),
) -> JSONResponse:
    """List only the currently published associations of a Curation.

    The curation must still exist, while association visibility is solely
    governed by the version interval and the Collection publication state.
    """
    _interactive_subject(auth)
    if operational_db.curations.find_one({"curation_id": curation_id}, {"_id": 1}) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Curation not found")

    memberships = cms_db.collection_memberships.find({"curationId": curation_id})
    collection_ids = sorted({str(item.get("collectionId")) for item in memberships if item.get("collectionId")})
    items = []
    for collection_id in collection_ids:
        collection = cms_db.collections.find_one(
            {"_id": collection_id, "lifecycle": "published"},
            {"slug": 1, "title": 1, "currentPublishedVersion": 1},
        )
        if not collection or not isinstance(collection.get("currentPublishedVersion"), int):
            continue
        version = collection["currentPublishedVersion"]
        membership = cms_db.collection_memberships.find_one(
            {
                "collectionId": collection_id,
                "curationId": curation_id,
                "addedInVersion": {"$lte": version},
                "$or": [{"removedInVersion": None}, {"removedInVersion": {"$gt": version}}],
            },
            {"_id": 1},
        )
        if membership is None:
            continue
        items.append(
            {
                "collection_id": collection_id,
                "slug": collection.get("slug", ""),
                "title": collection.get("title", ""),
                "current_published_version": version,
            }
        )
    return JSONResponse({"items": items}, headers={"Cache-Control": "private, no-store"})
