"""Curator endpoints — list curator profiles."""
from fastapi import APIRouter, Depends
from typing import List
from pymongo.database import Database

from app.core.database import get_database

router = APIRouter(prefix="/curators", tags=["curators"])


@router.get("")
def list_curators(db: Database = Depends(get_database)):
    """List all curator profiles from the curators collection.

    Returns basic profile info for every curator who has logged in at least once.
    No authentication required (consistent with /entities and /curations/search).
    """
    docs = list(db.curators.find(
        {},
        {
            "_id": 0,
            "curator_id": 1,
            "name": 1,
            "email": 1,
            "picture": 1,
        }
    ).sort("name", 1))

    return docs
