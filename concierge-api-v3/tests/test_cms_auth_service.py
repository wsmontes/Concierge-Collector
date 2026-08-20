from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from pymongo import ReturnDocument

from app.services.cms_auth_service import consume_handoff_code, issue_handoff_code


def _db(role="admin", authorized=True):
    db = MagicMock()
    db.users.find_one.return_value = {
        "_id": "user-1",
        "email": "admin@example.com",
        "name": "Admin",
        "picture": None,
        "role": role,
        "authorized": authorized,
    }
    return db


def test_handoff_code_is_hash_only_and_one_time():
    db = _db()
    issued_at = datetime.now(timezone.utc)

    raw = issue_handoff_code(
        db,
        subject="admin@example.com",
        state="state-1",
        target_origin="https://admin.concierge-collector.com",
        now=issued_at,
    )

    inserted = db.cms_auth_codes.insert_one.call_args[0][0]
    assert raw not in repr(inserted)
    assert inserted["audience"] == "cms"
    assert inserted["expires_at"] == issued_at + timedelta(seconds=120)
    assert inserted["consumed_at"] is None


def test_exchange_rejects_role_downgrade_before_consumption():
    db = _db(role="curator")
    db.cms_auth_codes.find_one_and_update.return_value = {
        "audience": "cms",
        "subject": "admin@example.com",
        "state": "state-1",
        "target_origin": "https://admin.concierge-collector.com",
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=30),
    }

    with pytest.raises(HTTPException) as error:
        consume_handoff_code(
            db,
            code="raw",
            state="state-1",
            target_origin="https://admin.concierge-collector.com",
        )

    assert error.value.status_code == 403


def test_exchange_replay_is_unauthorized():
    db = _db()
    db.cms_auth_codes.find_one_and_update.return_value = None

    with pytest.raises(HTTPException) as error:
        consume_handoff_code(
            db,
            code="already-consumed",
            state="state-1",
            target_origin="https://admin.concierge-collector.com",
        )

    assert error.value.status_code == 401


def test_consumed_code_cannot_be_exchanged_twice():
    db = _db()
    now = datetime.now(timezone.utc)
    valid_document = {
        "audience": "cms",
        "subject": "admin@example.com",
        "state": "state-1",
        "target_origin": "https://admin.concierge-collector.com",
        "expires_at": now + timedelta(seconds=30),
    }
    db.cms_auth_codes.find_one_and_update.side_effect = [valid_document, None]

    first = consume_handoff_code(
        db,
        code="single-use-code",
        state="state-1",
        target_origin="https://admin.concierge-collector.com",
        now=now,
    )

    assert first.user_id == "user-1"
    with pytest.raises(HTTPException) as error:
        consume_handoff_code(
            db,
            code="single-use-code",
            state="state-1",
            target_origin="https://admin.concierge-collector.com",
            now=now,
        )
    assert error.value.status_code == 401
    assert db.cms_auth_codes.find_one_and_update.call_count == 2


def test_loads_current_authorization_after_atomic_consumption():
    db = _db()
    now = datetime.now(timezone.utc)
    db.cms_auth_codes.find_one_and_update.return_value = {
        "audience": "cms",
        "subject": "admin@example.com",
        "state": "state-1",
        "target_origin": "https://admin.concierge-collector.com",
        "expires_at": now + timedelta(seconds=30),
    }

    authorization = consume_handoff_code(
        db,
        code="raw",
        state="state-1",
        target_origin="https://admin.concierge-collector.com",
        now=now,
    )

    assert authorization.user_id == "user-1"
    assert authorization.role == "admin"
    assert authorization.authorized is True
    query = db.cms_auth_codes.find_one_and_update.call_args.args[0]
    assert query["consumed_at"] is None
    assert query["expires_at"]["$gt"] == now
    call_kwargs = db.cms_auth_codes.find_one_and_update.call_args.kwargs
    assert call_kwargs["return_document"] is ReturnDocument.AFTER
