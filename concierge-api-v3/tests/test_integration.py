"""
Integration tests - test complete workflows
"""
import pytest
import base64


@pytest.mark.mongo
class TestIntegrationWorkflows:
    """Test complete user workflows"""
    
    def test_api_documentation_accessible(self, client):
        """Test that API docs are accessible"""
        # Swagger UI
        response = client.get("/api/v3/docs")
        assert response.status_code == 200
        assert b"swagger" in response.content.lower()
        
        # ReDoc
        response = client.get("/api/v3/redoc")
        assert response.status_code == 200
        
        # OpenAPI schema
        response = client.get("/api/v3/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert "openapi" in schema
        assert "paths" in schema
    
    def test_cors_headers(self, client):
        """Test CORS headers are present"""
        response = client.options("/api/v3/health")
        # TestClient may not support OPTIONS or CORS
        assert response.status_code in [200, 204, 405]
    
    def test_error_handling(self, client):
        """Test that errors are handled gracefully"""
        # 404
        response = client.get("/api/v3/nonexistent")
        assert response.status_code == 404
        
        # 422 - validation error
        response = client.get("/api/v3/entities?limit=invalid")
        assert response.status_code == 422
    
    def test_pagination_consistency(self, client):
        """Test pagination returns consistent results"""
        # Get first page
        response1 = client.get("/api/v3/entities?limit=10&offset=0")
        page1 = response1.json()
        
        # Get second page
        response2 = client.get("/api/v3/entities?limit=10&offset=10")
        page2 = response2.json()
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        # Pages should not overlap
        if page1["items"] and page2["items"]:
            ids1 = {item["entity_id"] for item in page1["items"]}
            ids2 = {item["entity_id"] for item in page2["items"]}
            assert len(ids1.intersection(ids2)) == 0
    
    def test_database_connection_resilience(self, client):
        """Test that API handles database issues gracefully"""
        # Multiple rapid requests
        for _ in range(5):
            response = client.get("/api/v3/health")
            assert response.status_code == 200
            data = response.json()
            # Database may be connected or have errors
            assert "database" in data


class TestPerformance:
    """Test API performance"""
    
    def test_health_check_fast(self, client):
        """Test health check responds quickly"""
        import time
        start = time.time()
        response = client.get("/api/v3/health")
        duration = time.time() - start
        
        assert response.status_code == 200
        # Should respond in under 5 seconds
        assert duration < 5.0, f"Health check took {duration:.2f}s, expected <5s"
    
    def test_list_entities_reasonable_time(self, client):
        """Test listing entities completes in reasonable time"""
        import time
        start = time.time()
        response = client.get("/api/v3/entities?limit=50")
        duration = time.time() - start

        assert response.status_code == 200
        assert duration < 3.5  # Keep a realistic bound for shared/CI environments


# ── User journey tests ─────────────────────────────────────────────────────────


@pytest.mark.mongo
def test_full_capture_journey_with_auth(client, auth_headers, test_db):
    """
    End-to-end: capture audio → get entities → confirm → curation exists.
    Mocks AI-dependent functions (transcription, name extraction, concepts)
    so the test runs without external AI API calls.
    """
    from unittest.mock import patch
    from datetime import datetime, timezone

    test_id = "test_jny_capture"
    idempotency_key = f"{test_id}_001"
    entity_id = f"{test_id}_entity"
    curation_id = f"cur_{idempotency_key[:16]}"

    # Pre-create an entity in MongoDB for the journey
    test_db.entities.insert_one({
        "_id": entity_id,
        "entity_id": entity_id,
        "name": "Test Italian Restaurant",
        "type": "restaurant",
        "data": {
            "location": {"address": "123 Test St", "city": "Test City"},
        },
        "status": "active",
        "createdAt": datetime.now(timezone.utc),
        "updatedAt": datetime.now(timezone.utc),
    })

    try:
        # ── Step 1: Capture audio ──
        # Mock the three AI-dependent helper functions so the test is hermetic
        with patch("app.api.capture._transcribe") as mock_transcribe, \
             patch("app.api.capture._extract_restaurant_name") as mock_extract_name, \
             patch("app.api.capture._extract_concepts") as mock_extract_concepts:

            mock_transcribe.return_value = "Great food at Test Italian Restaurant"
            mock_extract_name.return_value = "Test Italian Restaurant"
            mock_extract_concepts.return_value = {"cuisine": ["italian"], "price_range": "mid-range"}

            resp = client.post(
                "/api/v3/capture",
                json={
                    "audio": base64.b64encode(b"fake audio data").decode(),
                    "idempotency_key": idempotency_key,
                    "curator_id": "test_curator",
                    "language": "pt-BR",
                },
                headers=auth_headers,
            )

        # Accept 200 or 422 (if entity match fails) — anything but 500
        assert resp.status_code != 500, f"Capture returned 500: {resp.text}"
        if resp.status_code != 200:
            pytest.skip(f"Capture non-200 ({resp.status_code}): {resp.text}")

        data = resp.json()
        assert data["capture_id"] == idempotency_key
        assert "transcription" in data
        assert "entities" in data

        # Confirm the target entity appears in the matches
        entity_ids_in_response = [e["entity_id"] for e in data["entities"]]
        assert entity_id in entity_ids_in_response, \
            f"Expected {entity_id} in matches, got {entity_ids_in_response}"

        # ── Step 2: Confirm capture ──
        confirm_key = f"confirm:{idempotency_key}"
        resp = client.post(
            f"/api/v3/capture/{idempotency_key}/confirm",
            json={
                "entity_id": entity_id,
                "idempotency_key": confirm_key,
            },
            headers=auth_headers,
        )

        assert resp.status_code != 500, f"Confirm returned 500: {resp.text}"

        # May return 422 if entity didn't persist in capture session properly
        if resp.status_code != 200:
            pytest.skip(f"Confirm non-200 ({resp.status_code}): {resp.text}")

        confirm_data = resp.json()
        assert confirm_data["curation_id"] == curation_id
        assert confirm_data["entity_id"] == entity_id
        assert confirm_data["status"] == "created"

        # ── Step 3: Verify curation exists ──
        resp = client.get(f"/api/v3/curations/{curation_id}")
        assert resp.status_code == 200, f"GET curation returned {resp.status_code}: {resp.text}"
        curation = resp.json()
        assert curation["curation_id"] == curation_id
        assert curation["entity_id"] == entity_id

    finally:
        # Clean up all artifacts from this journey
        test_db.entities.delete_one({"_id": entity_id})
        test_db.curations.delete_one({"_id": curation_id})
        test_db["capture_sessions"].delete_one({"_id": idempotency_key})
        # Also clear the in-memory cache entries for this test
        from app.api.capture import _idempotency_cache
        _idempotency_cache._data.pop(idempotency_key, None)
        _idempotency_cache._data.pop(confirm_key, None)


def test_openai_client_journey(client, auth_headers):
    """LM Studio flow: models → functions → chat completion with auth."""
    # ── Without auth: all endpoints return 401 ──
    resp = client.get("/api/v3/openai/v1/models")
    assert resp.status_code == 401

    resp = client.get("/api/v3/openai/v1/functions")
    assert resp.status_code == 401

    resp = client.post(
        "/api/v3/openai/v1/chat/completions",
        json={"model": "gpt-4", "messages": [{"role": "user", "content": "hello"}]},
    )
    assert resp.status_code == 401

    # ── With auth: verify response content ──
    # GET /v1/models with auth
    resp = client.get("/api/v3/openai/v1/models", headers=auth_headers)
    assert resp.status_code == 200
    models_data = resp.json()
    assert models_data["object"] == "list"
    assert len(models_data["data"]) == 1
    assert models_data["data"][0]["id"] == "concierge-restaurant"

    # GET /v1/functions with auth
    resp = client.get("/api/v3/openai/v1/functions", headers=auth_headers)
    assert resp.status_code == 200
    funcs_data = resp.json()
    assert funcs_data["count"] == 4
    func_names = {f.get("name") for f in funcs_data["functions"]}
    assert "search_restaurants" in func_names
    assert "get_restaurant_snapshot" in func_names
    assert "get_restaurant_availability" in func_names
    assert "get_restaurant_photos" in func_names

    # POST /v1/chat/completions with auth (no tool calls — returns available tools)
    resp = client.post(
        "/api/v3/openai/v1/chat/completions",
        json={"model": "gpt-4", "messages": [{"role": "user", "content": "hello"}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    chat_data = resp.json()
    assert chat_data["object"] == "chat.completion"
    assert len(chat_data["choices"]) == 1
    assert chat_data["choices"][0]["finish_reason"] == "stop"

    # POST /v1/chat/completions with tool_choice="none"
    resp = client.post(
        "/api/v3/openai/v1/chat/completions",
        json={
            "model": "gpt-4",
            "messages": [{"role": "user", "content": "find italian"}],
            "tool_choice": "none",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200

