"""Fixtures for the read-only CMS projection boundary (consumer distribution).

Only this module may write to the CMS test database. Application code is
strictly read-only toward the CMS namespace (CmsReadOnlyDatabase has no write
helpers); the privileged ``cms_writer`` exists solely inside tests.

Opt-in convention mirrors ``hermetic_test_database`` in ``tests/conftest.py``:
without ``CMS_MONGODB_TEST_URL`` the fixtures skip, so the default unit gate
never touches a real MongoDB.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib

import pytest
from pymongo import MongoClient
from pymongo.database import Database

from app.core.cms_database import CmsReadOnlyDatabase
from app.core.config import settings


@dataclass
class SeededConsumerCredential:
    """Application + credential seeded hash-only; the raw secret exists only
    in the test that requests this fixture."""

    id: str
    raw: str
    writer: Database  # privileged writer; production never holds one


@pytest.fixture
def cms_writer():
    """Sole fixture with CMS write permission: cleans the CMS test database
    before AND after the test.

    Requires ``CMS_MONGODB_TEST_URL`` (opt-in) and a database name ending in
    ``-test`` (fail-closed otherwise).
    """
    url = settings.cms_mongodb_test_url
    if not url:
        pytest.skip("CMS Mongo tests require CMS_MONGODB_TEST_URL")
    name = settings.cms_mongodb_test_db_name
    if not name.endswith("-test"):
        raise RuntimeError("CMS_MONGODB_TEST_DB_NAME must end with '-test'")
    client = MongoClient(url)
    client.drop_database(name)
    try:
        yield client[name]
    finally:
        client.drop_database(name)
        client.close()


@pytest.fixture
def cms_db(cms_writer) -> CmsReadOnlyDatabase:
    """Wrap the test database in the same read-only facade the app uses."""
    return CmsReadOnlyDatabase(cms_writer)


@pytest.fixture
def seeded_consumer_credential(cms_writer) -> SeededConsumerCredential:
    """Insert an active application + credential (hash/prefix only); return
    the raw secret exclusively to the requesting test."""
    raw = "cck_" + "a" * 12 + "_" + "Z" * 43
    application_id = "app-1"
    credential_id = "cred-1"
    cms_writer.consumer_applications.insert_one(
        {
            "_id": application_id,
            "status": "active",
            "allowedCollectionIds": [{"collectionId": "collection-a"}],
            "defaultRequestsPerMinute": 60,
        }
    )
    cms_writer.consumer_credentials.insert_one(
        {
            "_id": credential_id,
            "applicationId": application_id,
            "name": "production",
            "prefix": "a" * 12,
            "secretHash": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
            "status": "active",
            "expiresAt": None,
        }
    )
    return SeededConsumerCredential(id=credential_id, raw=raw, writer=cms_writer)
