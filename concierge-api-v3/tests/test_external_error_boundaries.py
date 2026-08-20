"""Unexpected provider/database failures must not be reflected to API clients."""


class _FailingOrchestrator:
    async def orchestrate(self, *_args, **_kwargs):
        raise RuntimeError("mongodb://secret-user:secret-pass@internal-host/catalog")


class _FailingOpenAIService:
    async def extract_restaurant_name_from_text(self, *_args, **_kwargs):
        raise RuntimeError("sk-secret-provider-detail")


class _FailingLLMService:
    def search_restaurants(self, **_kwargs):
        raise RuntimeError("mongodb://secret-user:secret-pass@internal-host/catalog")

    def get_restaurant_snapshot(self, **_kwargs):
        raise RuntimeError("internal-google-api-key=secret")

    def get_restaurant_availability(self, **_kwargs):
        raise RuntimeError("private-provider-stack-detail")


def _override(app, dependency, value):
    sentinel = object()
    previous = app.dependency_overrides.get(dependency, sentinel)
    app.dependency_overrides[dependency] = lambda: value

    def restore():
        if previous is sentinel:
            app.dependency_overrides.pop(dependency, None)
        else:
            app.dependency_overrides[dependency] = previous

    return restore


def test_ai_orchestrate_hides_unexpected_exception_detail(client, auth_headers):
    from app.api.ai import get_ai_orchestrator

    restore = _override(client.app, get_ai_orchestrator, _FailingOrchestrator())
    try:
        response = client.post(
            "/api/v3/ai/orchestrate",
            json={"text": "test"},
            headers=auth_headers,
        )
    finally:
        restore()

    assert response.status_code == 500
    assert response.json()["detail"] == "AI orchestration failed"
    assert "secret" not in response.text.lower()


def test_ai_name_extraction_hides_unexpected_exception_detail(client, auth_headers):
    from app.api.ai import get_openai_service

    restore = _override(client.app, get_openai_service, _FailingOpenAIService())
    try:
        response = client.post(
            "/api/v3/ai/extract-restaurant-name",
            json={"text": "Boundary Bistro"},
            headers=auth_headers,
        )
    finally:
        restore()

    assert response.status_code == 500
    assert response.json()["detail"] == "Restaurant name extraction failed"
    assert "secret" not in response.text.lower()


def test_llm_gateway_hides_unexpected_service_details(client, auth_headers):
    from app.api.llm_gateway import get_llm_service

    restore = _override(client.app, get_llm_service, _FailingLLMService())
    try:
        search = client.post(
            "/api/v3/llm/search-restaurants",
            json={"query": "Boundary Bistro"},
            headers=auth_headers,
        )
        snapshot = client.post(
            "/api/v3/llm/get-restaurant-snapshot",
            json={"entity_id": "ent_boundary"},
            headers=auth_headers,
        )
        availability = client.post(
            "/api/v3/llm/get-restaurant-availability",
            json={"entity_id": "ent_boundary"},
            headers=auth_headers,
        )
    finally:
        restore()

    assert search.status_code == 500
    assert search.json()["detail"] == "Restaurant search failed"
    assert snapshot.status_code == 500
    assert snapshot.json()["detail"] == "Restaurant snapshot failed"
    assert availability.status_code == 500
    assert availability.json()["detail"] == "Restaurant availability failed"
    combined = search.text + snapshot.text + availability.text
    assert "secret" not in combined.lower()
    assert "private-provider" not in combined.lower()
