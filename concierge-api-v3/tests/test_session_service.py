"""Refresh-session rotation regressions."""

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
