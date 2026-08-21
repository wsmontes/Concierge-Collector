"""Sensitive writes must use the live Mongo user, not stale JWT role claims."""

from unittest.mock import patch


def _user(email: str, *, role: str, authorized: bool) -> dict:
    return {
        "_id": f"user-{email}",
        "email": email,
        "google_id": f"google-{email}",
        "name": email,
        "picture": None,
        "authorized": authorized,
        "role": role,
    }


def test_stale_curator_token_is_rejected_after_role_downgrade(client, in_memory_db):
    from app.api.capture import _idempotency_cache
    from app.core.security import create_access_token

    email = "downgraded@example.com"
    in_memory_db.users.delete_many({"email": email})
    in_memory_db.users.insert_one(_user(email, role="viewer", authorized=True))
    _idempotency_cache._data.clear()
    token = create_access_token(data={"sub": email, "role": "curator"})

    try:
        with patch("app.api.capture._transcribe", return_value="must not run") as transcribe:
            response = client.post(
                "/api/v3/capture",
                json={"audio": "AA==", "idempotency_key": "stale-role", "curator_id": email},
                headers={"Authorization": f"Bearer {token}"},
            )
    finally:
        in_memory_db.users.delete_many({"email": email})
        _idempotency_cache._data.clear()

    assert response.status_code == 403
    assert response.json()["detail"] == "Requires curator role"
    transcribe.assert_not_called()


def test_stale_curator_token_is_rejected_after_authorization_revoked(client, in_memory_db):
    from app.api.capture import _idempotency_cache
    from app.core.security import create_access_token

    email = "revoked@example.com"
    in_memory_db.users.delete_many({"email": email})
    in_memory_db.users.insert_one(_user(email, role="curator", authorized=False))
    _idempotency_cache._data.clear()
    token = create_access_token(data={"sub": email, "role": "curator"})

    try:
        with patch("app.api.capture._transcribe", return_value="must not run") as transcribe:
            response = client.post(
                "/api/v3/capture",
                json={"audio": "AA==", "idempotency_key": "revoked-auth", "curator_id": email},
                headers={"Authorization": f"Bearer {token}"},
            )
    finally:
        in_memory_db.users.delete_many({"email": email})
        _idempotency_cache._data.clear()

    assert response.status_code == 403
    assert response.json()["detail"] == "User not authorized"
    transcribe.assert_not_called()
