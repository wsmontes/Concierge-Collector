"""
tests/test_sync.py

Purpose: Test sync endpoints
Responsibilities:
  - Test sync pull operations
  - Test sync push operations
  - Test conflict detection
  - Test Concierge embedding integration
Dependencies: pytest, httpx
"""

import pytest
from datetime import datetime, timedelta


@pytest.mark.asyncio
class TestSyncPull:
    """Test sync pull operations"""

    async def test_sync_pull_initial(self, client, auth_headers):
        """Test initial sync pull with no last_sync_timestamp"""
        request_data = {
            "curator_id": "test_curator_123",
            "last_sync_timestamp": None
        }
        
        response = await client.post(
            "/api/v4/sync/pull",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "entities" in data
        assert "curations" in data
        assert "timestamp" in data
        assert isinstance(data["entities"], list)
        assert isinstance(data["curations"], list)

    async def test_sync_pull_with_data(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test sync pull with existing data"""
        # Create entity and curation
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        await client.post(
            "/api/v4/curations/",
            json=curation_data,
            headers=auth_headers
        )
        
        # Perform sync pull
        request_data = {
            "curator_id": "test_curator_123",
            "last_sync_timestamp": None
        }
        
        response = await client.post(
            "/api/v4/sync/pull",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["entities"]) >= 1
        assert len(data["curations"]) >= 1

    async def test_sync_pull_incremental(self, client, sample_entity_data, auth_headers):
        """Test incremental sync pull with timestamp"""
        # Create entity
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        
        # Get timestamp before new changes
        past_timestamp = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
        
        # Perform sync pull with past timestamp
        request_data = {
            "curator_id": "test_curator_123",
            "last_sync_timestamp": past_timestamp
        }
        
        response = await client.post(
            "/api/v4/sync/pull",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["entities"]) >= 1

    async def test_sync_pull_no_new_changes(self, client, auth_headers):
        """Test sync pull with no new changes"""
        # Use future timestamp
        future_timestamp = (datetime.utcnow() + timedelta(hours=1)).isoformat()
        
        request_data = {
            "curator_id": "test_curator_123",
            "last_sync_timestamp": future_timestamp
        }
        
        response = await client.post(
            "/api/v4/sync/pull",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["entities"]) == 0
        assert len(data["curations"]) == 0


@pytest.mark.asyncio
class TestSyncPush:
    """Test sync push operations"""

    async def test_sync_push_new_entities(self, client, sample_entity_data, auth_headers):
        """Test pushing new entities"""
        request_data = {
            "curator_id": "test_curator_123",
            "entities": [sample_entity_data],
            "curations": [],
            "deleted_entity_ids": [],
            "deleted_curation_ids": []
        }
        
        response = await client.post(
            "/api/v4/sync/push",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["entities_created"] == 1
        assert data["entities_updated"] == 0
        assert "conflicts" in data

    async def test_sync_push_update_entities(self, client, sample_entity_data, sample_entity_update_data, auth_headers):
        """Test pushing entity updates"""
        # Create entity first
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Update via sync push
        updated_entity = {
            **sample_entity_data,
            "entity_id": entity["entity_id"],
            "name": sample_entity_update_data["name"],
            "version": entity["version"]
        }
        
        request_data = {
            "curator_id": "test_curator_123",
            "entities": [updated_entity],
            "curations": [],
            "deleted_entity_ids": [],
            "deleted_curation_ids": []
        }
        
        response = await client.post(
            "/api/v4/sync/push",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["entities_updated"] >= 1

    async def test_sync_push_version_conflict(self, client, sample_entity_data, auth_headers):
        """Test sync push with version conflict"""
        # Create entity
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Try to update with wrong version
        conflicting_entity = {
            **sample_entity_data,
            "entity_id": entity["entity_id"],
            "name": "Conflicting Name",
            "version": 999  # Wrong version
        }
        
        request_data = {
            "curator_id": "test_curator_123",
            "entities": [conflicting_entity],
            "curations": [],
            "deleted_entity_ids": [],
            "deleted_curation_ids": []
        }
        
        response = await client.post(
            "/api/v4/sync/push",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["conflicts"]) > 0
        assert data["conflicts"][0]["entity_id"] == entity["entity_id"]
        assert "version" in data["conflicts"][0]["reason"].lower()

    async def test_sync_push_with_curations(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test pushing entities with curations"""
        # Create entity first
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Push curation
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        
        request_data = {
            "curator_id": "test_curator_123",
            "entities": [],
            "curations": [curation_data],
            "deleted_entity_ids": [],
            "deleted_curation_ids": []
        }
        
        response = await client.post(
            "/api/v4/sync/push",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["curations_created"] == 1

    async def test_sync_push_delete_entities(self, client, sample_entity_data, auth_headers):
        """Test pushing entity deletions"""
        # Create entity
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Push deletion
        request_data = {
            "curator_id": "test_curator_123",
            "entities": [],
            "curations": [],
            "deleted_entity_ids": [entity["entity_id"]],
            "deleted_curation_ids": []
        }
        
        response = await client.post(
            "/api/v4/sync/push",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["entities_deleted"] >= 1

    async def test_sync_push_empty(self, client, auth_headers):
        """Test pushing with no changes"""
        request_data = {
            "curator_id": "test_curator_123",
            "entities": [],
            "curations": [],
            "deleted_entity_ids": [],
            "deleted_curation_ids": []
        }
        
        response = await client.post(
            "/api/v4/sync/push",
            json=request_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["entities_created"] == 0
        assert data["entities_updated"] == 0
        assert data["curations_created"] == 0
        assert data["curations_updated"] == 0


@pytest.mark.asyncio
class TestSyncConcierge:
    """Test Concierge integration"""

    async def test_sync_from_concierge_success(self, client, sample_entity_data, sample_concierge_embedding, auth_headers):
        """Test receiving embeddings from Concierge"""
        # Create entity first
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Send embedding
        embedding_data = {**sample_concierge_embedding, "entity_id": entity["entity_id"]}
        
        response = await client.post(
            "/api/v4/sync/from-concierge",
            json=embedding_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Embedding received successfully"
        
        # Verify entity has metadata
        get_response = await client.get(f"/api/v4/entities/{entity['entity_id']}")
        entity_data = get_response.json()
        assert "metadata" in entity_data
        assert len(entity_data["metadata"]) > 0

    async def test_sync_from_concierge_nonexistent_entity(self, client, sample_concierge_embedding, auth_headers):
        """Test receiving embeddings for nonexistent entity"""
        embedding_data = {**sample_concierge_embedding, "entity_id": "nonexistent_entity_123"}
        
        response = await client.post(
            "/api/v4/sync/from-concierge",
            json=embedding_data,
            headers=auth_headers
        )
        
        assert response.status_code == 404
        data = response.json()
        assert "entity" in data["detail"].lower()

    async def test_sync_from_concierge_invalid_embedding(self, client, sample_entity_data, auth_headers):
        """Test receiving invalid embedding data"""
        # Create entity first
        entity_response = await client.post(
            "/api/v4/entities/",
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Send invalid embedding (missing required fields)
        invalid_data = {
            "entity_id": entity["entity_id"]
            # Missing embeddings, analysis, generated_at
        }
        
        response = await client.post(
            "/api/v4/sync/from-concierge",
            json=invalid_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422
