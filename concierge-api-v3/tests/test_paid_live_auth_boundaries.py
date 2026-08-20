"""Paid provider boundaries must revalidate the live user before spending."""

from unittest.mock import AsyncMock, patch


def _user(email: str, *, role: str = "viewer", authorized: bool = False) -> dict:
    return {
        "_id": f"user-{email}",
        "email": email,
        "google_id": f"google-{email}",
        "name": email,
        "authorized": authorized,
        "role": role,
    }


def _revoked_headers(in_memory_db, email: str) -> dict[str, str]:
    from app.core.security import create_access_token

    in_memory_db.users.delete_many({"email": email})
    in_memory_db.users.insert_one(_user(email, authorized=False))
    token = create_access_token(data={"sub": email, "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


def test_revoked_user_cannot_spend_semantic_embedding(client, in_memory_db):
    email = "revoked-semantic@example.com"
    headers = _revoked_headers(in_memory_db, email)
    try:
        with patch("app.api.curations.OpenAI") as provider:
            response = client.post(
                "/api/v3/curations/semantic-search",
                json={"query": "romantic dinner"},
                headers=headers,
            )
    finally:
        in_memory_db.users.delete_many({"email": email})

    assert response.status_code == 403
    assert response.json()["detail"] == "User not authorized"
    provider.assert_not_called()


def test_revoked_user_cannot_spend_google_places_search(client, in_memory_db):
    email = "revoked-places@example.com"
    headers = _revoked_headers(in_memory_db, email)
    try:
        with patch(
            "app.api.places._nearby_search",
            new=AsyncMock(return_value={"results": [], "status": "ZERO_RESULTS"}),
        ) as provider:
            response = client.get(
                "/api/v3/places/nearby?latitude=48.4284&longitude=-123.3656&radius=1000",
                headers=headers,
            )
    finally:
        in_memory_db.users.delete_many({"email": email})

    assert response.status_code == 403
    assert response.json()["detail"] == "User not authorized"
    provider.assert_not_awaited()
