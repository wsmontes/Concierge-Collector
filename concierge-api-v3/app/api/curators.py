"""Curator endpoints — list curator profiles."""

from fastapi import APIRouter, Depends
from pymongo.database import Database

from app.core.database import get_database
from app.core.security import verify_auth

router = APIRouter(prefix="/curators", tags=["curators"])


@router.get("")
def list_curators(db: Database = Depends(get_database), auth: dict = Depends(verify_auth)):
    """List all curator profiles from the curators collection.

    Returns basic profile info for every curator who has logged in at least once.
    Login-gate (2026-08-15): o endpoint vazava email de todos os curadores —
    passou a exigir autenticação como as leituras de curations.
    """
    docs = list(
        db.curators.find(
            {},
            {
                "_id": 0,
                "curator_id": 1,
                "name": 1,
                "email": 1,
                "picture": 1,
            },
        ).sort("name", 1)
    )

    return docs
