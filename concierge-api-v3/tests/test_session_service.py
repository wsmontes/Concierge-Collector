"""Refresh-session rotation regressions."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest


@pytest.mark.mongo
def test_consume_session_allows_exactly_one_concurrent_winner(test_db):
    """Two refresh requests for one jti cannot both mint descendants."""
    from app.services.session_service import consume_session, register_session

    jti = "concurrent-refresh-jti"
    sub = "refresh@example.com"
    test_db.auth_sessions.delete_many({"jti": jti})
    register_session(test_db, jti, sub, datetime.now(timezone.utc))

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: consume_session(test_db, jti, sub), range(2)))

    assert sum(result is not None for result in results) == 1
    assert test_db.auth_sessions.find_one({"jti": jti}) is None


@pytest.mark.mongo
def test_consume_session_is_scoped_to_subject(test_db):
    from app.services.session_service import consume_session, register_session

    jti = "subject-scoped-refresh-jti"
    test_db.auth_sessions.delete_many({"jti": jti})
    register_session(test_db, jti, "alice@example.com", datetime.now(timezone.utc))

    assert consume_session(test_db, jti, "bob@example.com") is None
    assert consume_session(test_db, jti, "alice@example.com") is not None


@pytest.mark.asyncio
async def test_refresh_endpoint_allows_exactly_one_concurrent_rotation(async_client, in_memory_db, monkeypatch):
    """The HTTP refresh boundary must atomically consume the old jti.

    The verifier is synchronized so both requests finish JWT validation before
    either request reaches the rotation step.  A find-then-delete endpoint lets
    both requests mint descendants; an atomic consume produces one 200 and one
    replay rejection.
    """
    from app.services.session_service import register_session

    email = "refresh-race@example.com"
    jti = "refresh-endpoint-race-jti"
    users = in_memory_db.users
    sessions = in_memory_db.auth_sessions
    users.delete_many({"email": email})
    sessions.delete_many({"sub": email})
    users.insert_one(
        {
            "_id": "refresh-race-user",
            "email": email,
            "google_id": "refresh-race-google-id",
            "name": "Refresh Race",
            "picture": None,
            "authorized": True,
            "role": "curator",
            "created_at": datetime.now(timezone.utc),
            "last_login": datetime.now(timezone.utc),
            "refresh_token": None,
        }
    )
    register_session(in_memory_db, jti, email, datetime.now(timezone.utc))

    # The hermetic in-memory collection intentionally implements only the
    # PyMongo surface needed by ordinary unit tests. Add the CAS primitive here
    # so this regression exercises the production session-service contract.
    def find_one_and_delete(query):
        document = sessions.find_one(query)
        if document is None:
            return None
        sessions.delete_one({"_id": document["_id"]})
        return document

    monkeypatch.setattr(sessions, "find_one_and_delete", find_one_and_delete, raising=False)

    validation_barrier = asyncio.Barrier(2)

    async def synchronized_verify(_token, db=None):
        assert db is in_memory_db
        await validation_barrier.wait()
        return {"sub": email, "jti": jti, "type": "refresh"}

    monkeypatch.setattr("app.core.security.verify_refresh_token", synchronized_verify)

    try:
        first, second = await asyncio.gather(
            async_client.post("/api/v3/auth/refresh", json={"refresh_token": "same-refresh-token"}),
            async_client.post("/api/v3/auth/refresh", json={"refresh_token": "same-refresh-token"}),
        )
        assert sorted([first.status_code, second.status_code]) == [200, 401]
    finally:
        users.delete_many({"email": email})
        sessions.delete_many({"sub": email})
