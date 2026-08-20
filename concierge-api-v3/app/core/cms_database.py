"""Read-only CMS projection boundary used by consumer distribution only."""

from __future__ import annotations

from pymongo import MongoClient
from pymongo.database import Database

from app.core.config import settings

_cms_client: MongoClient | None = None
_ALLOWED_COLLECTIONS = frozenset(
    {
        "collections",
        "collection_versions",
        "collection_memberships",
        "consumer_applications",
        "consumer_credentials",
    }
)


class CmsReadOnlyCollection:
    """Expose exactly query methods; write helpers are deliberately absent."""

    def __init__(self, collection):
        self._collection = collection

    def find_one(self, *args, **kwargs):
        return self._collection.find_one(*args, **kwargs)

    def find(self, *args, **kwargs):
        return self._collection.find(*args, **kwargs)

    def aggregate(self, pipeline, **kwargs):
        if any("$out" in stage or "$merge" in stage for stage in pipeline):
            raise ValueError("write stage forbidden on CMS projection")
        return self._collection.aggregate(pipeline, **kwargs)


class CmsReadOnlyDatabase:
    def __init__(self, database: Database):
        self._database = database

    def collection(self, name: str) -> CmsReadOnlyCollection:
        if name not in _ALLOWED_COLLECTIONS:
            raise ValueError("CMS collection is outside the consumer projection")
        return CmsReadOnlyCollection(self._database[name])


def connect_cms_mongo() -> None:
    global _cms_client
    if _cms_client is not None:
        return
    _cms_client = MongoClient(settings.cms_mongodb_read_url_value)
    _cms_client.admin.command("ping")


def close_cms_mongo_connection() -> None:
    global _cms_client
    if _cms_client is not None:
        _cms_client.close()
        _cms_client = None


def get_cms_read_database() -> CmsReadOnlyDatabase:
    if _cms_client is None:
        raise RuntimeError("CMS MongoDB not connected")
    return CmsReadOnlyDatabase(_cms_client[settings.cms_mongodb_db_name])
