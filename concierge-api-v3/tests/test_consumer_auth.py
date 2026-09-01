from datetime import datetime, timezone
import hashlib

import pytest
from bson import ObjectId
from fastapi import HTTPException

from app.services.consumer_auth_service import authenticate_consumer, authorize_collection


class Collection:
    def __init__(self, document):
        self.document = document
        self.query = None

    def find_one(self, query):
        self.query = query
        if self.document is None:
            return None
        if "status" in query and self.document.get("status") != query["status"]:
            return None
        # Type-sensitive _id comparison: a 24-hex string must not match an
        # ObjectId (the production CMS stores ObjectId _ids).
        if "_id" in query and self.document.get("_id") != query["_id"]:
            return None
        return self.document


class CmsDb:
    def __init__(self, credential, application):
        self.credentials = Collection(credential)
        self.applications = Collection(application)

    def collection(self, name):
        return self.credentials if name == "consumer_credentials" else self.applications


def seeded():
    raw = "cck_" + "a" * 12 + "_" + "Z" * 43
    return raw, CmsDb(
        {
            "_id": "cred-1",
            "applicationId": "app-1",
            "prefix": "a" * 12,
            "secretHash": hashlib.sha256(raw.encode()).hexdigest(),
            "status": "active",
            "expiresAt": None,
        },
        {
            "_id": "app-1",
            "status": "active",
            "allowedCollectionIds": [{"collectionId": "collection-a"}],
            "defaultRequestsPerMinute": 120,
        },
    )


def test_authentication_is_hash_only_and_allowlist_is_enforced():
    raw, db = seeded()
    principal = authenticate_consumer(db, f"Bearer {raw}", datetime(2026, 8, 20, tzinfo=timezone.utc))
    assert principal.credential_id == "cred-1"
    assert db.credentials.query["secretHash"] == hashlib.sha256(raw.encode()).hexdigest()
    authorize_collection(principal, "collection-a")
    with pytest.raises(HTTPException) as error:
        authorize_collection(principal, "collection-b")
    assert error.value.status_code == 404


def test_application_lookup_accepts_hex_string_application_ids():
    # The Admin stores applicationId on the credential as a 24-hex string
    # while consumer_applications documents use ObjectId _ids. The lookup must
    # normalize the string so a valid credential still authenticates.
    raw, db = seeded()
    hex_id = "6a967b39d537f3a5e5c0aec3"
    db.credentials.document["applicationId"] = hex_id
    db.applications.document["_id"] = ObjectId(hex_id)
    principal = authenticate_consumer(db, f"Bearer {raw}", datetime(2026, 8, 20, tzinfo=timezone.utc))
    assert principal.application_id == hex_id


def test_revoked_or_malformed_credential_is_rejected_without_cache():
    raw, db = seeded()
    db.credentials.document["status"] = "revoked"
    with pytest.raises(HTTPException) as revoked:
        authenticate_consumer(db, f"Bearer {raw}")
    assert revoked.value.status_code == 401
    with pytest.raises(HTTPException) as malformed:
        authenticate_consumer(db, "Bearer not-a-consumer-key")
    assert malformed.value.status_code == 401
