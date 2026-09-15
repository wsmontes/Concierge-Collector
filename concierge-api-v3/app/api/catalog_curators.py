"""Curator directory on the CMS boundary, for the Curation curator picker.

``curator_id`` is an opaque curator identity the Admin could only render until
now, because there was no directory to choose a value from. This is that
directory, on the same boundary as the other ``/catalog/*`` reads — the CMS
service credential plus a live CMS admin actor — and always bounded and
searched, so no caller can walk the whole curator collection.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pymongo.database import Database

from app.core.database import get_database
from app.core.security import verify_cms_service
from app.models.catalog_curators import (
    CURATOR_SEARCH_DEFAULT_LIMIT,
    CURATOR_SEARCH_MAX_LIMIT,
    CuratorListPage,
    CuratorRow,
)
from app.services.catalog_service import require_current_cms_admin

router = APIRouter(prefix="/catalog", tags=["cms-catalog"])

# The picker renders a name and the identity it writes back; nothing else about
# a person leaves this boundary.
_CURATOR_PROJECTION = {"_id": 0, "curator_id": 1, "name": 1, "email": 1}


def _actor(actor_id: str | None) -> str:
    """The asserted CMS actor, resolved exactly as the sibling ``/catalog/*`` reads do."""
    if not actor_id or not actor_id.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CMS actor is required")
    return actor_id.strip()


@router.get("/curators", response_model=CuratorListPage)
def list_catalog_curators(
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=CURATOR_SEARCH_DEFAULT_LIMIT, ge=1, le=CURATOR_SEARCH_MAX_LIMIT),
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CuratorListPage:
    """Search the curator directory by name or email, ordered by name.

    ``q`` is text, not a pattern: regex metacharacters match themselves. Without
    ``q`` the page is still bounded by ``limit``, so browsing never becomes a
    whole-collection read.
    """
    require_current_cms_admin(db, _actor(actor_id))
    query: dict[str, Any] = {}
    if q:
        pattern = re.escape(q)
        query["$or"] = [
            {"name": {"$regex": pattern, "$options": "i"}},
            {"email": {"$regex": pattern, "$options": "i"}},
        ]
    rows = db.curators.find(query, _CURATOR_PROJECTION).sort("name", 1).limit(limit)

    items: list[CuratorRow] = []
    for row in rows:
        identity = row.get("curator_id")
        # The picker writes this value into a Curation: a row the login flow
        # never finished (no identity) is not a curator anyone can assign.
        if not identity:
            continue
        items.append(CuratorRow(curator_id=str(identity), name=row.get("name"), email=row.get("email")))
    return CuratorListPage(items=items)
