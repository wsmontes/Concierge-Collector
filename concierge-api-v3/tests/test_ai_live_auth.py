"""Paid AI endpoints must honor live Mongo authorization and roles."""

from unittest.mock import AsyncMock, patch


def _user(email: str, *, role: str, authorized: bool) -> dict:
    return {
        "_id": f"user-{email}",
        "email": email,
        "google_id": f"google-{email}",
        "name": email,
        "authorized": authorized,
        "role": role,
    }


def test_revoked_user_cannot_call_paid_name_extraction(client, in_memory_db):
    from app.core.security import create_access_token

    email = "revoked-ai@example.com"
    in_memory_db.users.delete_many({"email": email})
    in_memory_db.users.insert_one(_user(email, role="viewer", authorized=False))
    token = create_access_token(data={"sub": email, "role": "viewer"})

    with patch(
        "app.services.openai_service.OpenAIService.extract_restaurant_name_from_text",
        new=AsyncMock(return_value={"restaurant_name": "Must Not Run", "service": "test"}),
    ) as provider:
        response = client.post(
            "/api/v3/ai/extract-restaurant-name",
            json={"text": "Boundary Bistro"},
            headers={"Authorization": f"Bearer {token}"},
        )

    in_memory_db.users.delete_many({"email": email})
    assert response.status_code == 403
    assert response.json()["detail"] == "User not authorized"
    provider.assert_not_awaited()


def test_stale_curator_claim_cannot_save_ai_results_after_live_downgrade(client, in_memory_db):
    from app.api.ai import get_ai_orchestrator
    from app.core.security import create_access_token

    email = "downgraded-ai@example.com"
    in_memory_db.users.delete_many({"email": email})
    in_memory_db.users.insert_one(_user(email, role="viewer", authorized=True))
    token = create_access_token(data={"sub": email, "role": "curator"})

    orchestrator = AsyncMock()
    previous = client.app.dependency_overrides.get(get_ai_orchestrator)
    client.app.dependency_overrides[get_ai_orchestrator] = lambda: orchestrator
    try:
        response = client.post(
            "/api/v3/ai/orchestrate",
            json={"text": "test", "output": {"save_to_db": True}},
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        if previous is None:
            client.app.dependency_overrides.pop(get_ai_orchestrator, None)
        else:
            client.app.dependency_overrides[get_ai_orchestrator] = previous
        in_memory_db.users.delete_many({"email": email})

    assert response.status_code == 403
    orchestrator.orchestrate.assert_not_awaited()
