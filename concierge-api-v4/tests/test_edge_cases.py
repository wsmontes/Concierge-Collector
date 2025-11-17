"""
tests/test_edge_cases.py

Purpose: Test edge cases and error handling
Tests: Exception handling, validation errors, database errors
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestEntityEdgeCases:
    """Test edge cases for entity endpoints"""

    async def test_create_entity_with_empty_name(self, client, auth_headers):
        """Test creating entity with empty name"""
        entity_data = {
            "type": "restaurant",
            "name": "",  # Empty name
            "created_by": "test_curator_123"
        }
        
        response = await client.post(
            "/api/v4/entities/",
            json=entity_data,
            headers=auth_headers
        )
        
        # Should fail validation (min_length=1)
        assert response.status_code == 422

    async def test_create_entity_with_very_long_name(self, client, auth_headers):
        """Test creating entity with name exceeding max length"""
        entity_data = {
            "type": "restaurant",
            "name": "A" * 500,  # 500 characters (max is 255)
            "created_by": "test_curator_123"
        }
        
        response = await client.post(
            "/api/v4/entities/",
            json=entity_data,
            headers=auth_headers
        )
        
        # Should fail validation (max_length=255)
        assert response.status_code == 422

    async def test_create_entity_missing_type(self, client, auth_headers):
        """Test creating entity without type field"""
        entity_data = {
            "name": "Test Restaurant",
            "created_by": "test_curator_123"
            # Missing type field
        }
        
        response = await client.post(
            "/api/v4/entities/",
            json=entity_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422

    async def test_create_entity_missing_created_by(self, client, auth_headers):
        """Test creating entity without created_by field"""
        entity_data = {
            "type": "restaurant",
            "name": "Test Restaurant"
            # Missing created_by field
        }
        
        response = await client.post(
            "/api/v4/entities/",
            json=entity_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422

    async def test_list_entities_with_negative_skip(self, client):
        """Test listing entities with negative skip value"""
        response = await client.get("/api/v4/entities/?skip=-1")
        
        # Should fail validation
        assert response.status_code == 422

    async def test_list_entities_with_negative_limit(self, client):
        """Test listing entities with negative limit value"""
        response = await client.get("/api/v4/entities/?limit=-1")
        
        # Should fail validation
        assert response.status_code == 422

    async def test_list_entities_with_excessive_limit(self, client):
        """Test listing entities with limit exceeding maximum"""
        response = await client.get("/api/v4/entities/?limit=2000")
        
        # Should fail validation (max 1000)
        assert response.status_code == 422

    async def test_get_entity_with_malformed_id(self, client):
        """Test getting entity with malformed ID"""
        response = await client.get("/api/v4/entities/malformed__id__")
        
        # Should return 404
        assert response.status_code == 404

    async def test_update_entity_with_empty_body(self, client, sample_entity_data, auth_headers):
        """Test updating entity with empty update body"""
        # Create entity first
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Try to update with empty body (no fields except version)
        update_data = {"version": entity["version"]}
        
        response = await client.put(
            f"/api/v4/entities/{entity['entity_id']}",
            json=update_data,
            headers=auth_headers
        )
        
        # Should succeed but not change anything (version increments)
        assert response.status_code == 200


@pytest.mark.asyncio
class TestCurationEdgeCases:
    """Test edge cases for curation endpoints"""

    async def test_create_curation_without_entity_id(self, client, auth_headers):
        """Test creating curation without entity_id"""
        curation_data = {
            "curator_id": "test_curator_123",
            "category": "michelin",
            "concept": "Test concept"
            # Missing entity_id
        }
        
        response = await client.post(
            "/api/v4/curations/",
            json=curation_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422

    async def test_create_curation_without_curator_id(self, client, sample_entity_data, auth_headers):
        """Test creating curation without curator_id"""
        # Create entity first
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        curation_data = {
            "entity_id": entity["entity_id"],
            "category": "michelin",
            "concept": "Test concept"
            # Missing curator_id
        }
        
        response = await client.post(
            "/api/v4/curations/",
            json=curation_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422

    async def test_create_curation_without_category(self, client, sample_entity_data, auth_headers):
        """Test creating curation without category"""
        # Create entity first
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        curation_data = {
            "entity_id": entity["entity_id"],
            "curator_id": "test_curator_123",
            "concept": "Test concept"
            # Missing category
        }
        
        response = await client.post(
            "/api/v4/curations/",
            json=curation_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422

    async def test_list_curations_with_invalid_params(self, client):
        """Test listing curations with invalid parameters"""
        response = await client.get("/api/v4/curations/?skip=-5&limit=0")
        
        # Should fail validation
        assert response.status_code == 422


@pytest.mark.asyncio
class TestSyncEdgeCases:
    """Test edge cases for sync endpoints"""

    async def test_sync_pull_with_invalid_timestamp(self, client, auth_headers):
        """Test sync pull with malformed timestamp"""
        request_data = {
            "last_sync_timestamp": "not-a-valid-timestamp"
        }
        
        response = await client.post(
            "/api/v4/sync/pull",
            json=request_data,
            headers=auth_headers
        )
        
        # Should fail validation
        assert response.status_code == 422

    async def test_sync_push_with_empty_curator_id(self, client, auth_headers):
        """Test sync push with empty curator_id"""
        request_data = {
            "curator_id": "",  # Empty
            "entities": [],
            "curations": []
        }
        
        response = await client.post(
            "/api/v4/sync/push",
            json=request_data,
            headers=auth_headers
        )
        
        # Should succeed but with empty results (no validation on curator_id)
        assert response.status_code == 200

    async def test_sync_push_with_malformed_entity(self, client, auth_headers):
        """Test sync push with malformed entity data"""
        request_data = {
            "curator_id": "test_curator_123",
            "entities": [
                {
                    "name": "Test",
                    # Missing required fields like 'type', 'created_by'
                }
            ],
            "curations": []
        }
        
        response = await client.post(
            "/api/v4/sync/push",
            json=request_data,
            headers=auth_headers
        )
        
        # Should return 200 but with conflicts
        assert response.status_code == 200
        data = response.json()
        assert len(data["conflicts"]) > 0

    async def test_sync_from_concierge_with_invalid_embeddings(self, client, sample_entity_data, auth_headers):
        """Test sync from concierge with invalid embedding format"""
        # Create entity first
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Send invalid embeddings (should be list of floats)
        embedding_data = {
            "entity_id": entity["entity_id"],
            "embeddings": "not-a-list",  # Invalid
            "analysis": {},
            "generated_at": "2024-01-01T00:00:00"
        }
        
        response = await client.post(
            "/api/v4/sync/from-concierge",
            json=embedding_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422

    async def test_sync_from_concierge_with_empty_embeddings(self, client, sample_entity_data, auth_headers):
        """Test sync from concierge with empty embeddings list"""
        # Create entity first
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        embedding_data = {
            "entity_id": entity["entity_id"],
            "embeddings": [],  # Empty list
            "analysis": {},
            "generated_at": "2024-01-01T00:00:00"
        }
        
        response = await client.post(
            "/api/v4/sync/from-concierge",
            json=embedding_data,
            headers=auth_headers
        )
        
        # Should succeed (empty embeddings is valid)
        assert response.status_code == 200


@pytest.mark.asyncio
class TestAuthenticationEdgeCases:
    """Test edge cases for authentication"""

    async def test_protected_endpoint_without_token(self, client, sample_entity_data):
        """Test accessing protected endpoint without token"""
        response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data
            # No auth headers
        )
        
        assert response.status_code == 403

    async def test_protected_endpoint_with_malformed_token(self, client, sample_entity_data):
        """Test accessing protected endpoint with malformed token"""
        headers = {"Authorization": "Bearer malformed_token_xyz"}
        
        response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=headers
        )
        
        assert response.status_code == 401

    async def test_protected_endpoint_with_empty_token(self, client, sample_entity_data):
        """Test accessing protected endpoint with empty token"""
        headers = {"Authorization": "Bearer "}
        
        response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=headers
        )
        
        # Should fail authentication (403 or 401)
        assert response.status_code in [401, 403]

    async def test_protected_endpoint_without_bearer_prefix(self, client, sample_entity_data, auth_token):
        """Test accessing protected endpoint without 'Bearer' prefix"""
        headers = {"Authorization": auth_token}  # Missing "Bearer "
        
        response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=headers
        )
        
        # Should fail (invalid format)
        assert response.status_code in [401, 403]
