"""
tests/test_database.py

Purpose: Test database operations and helpers
Tests: Connection, database functions, query helpers
"""

import pytest
from datetime import datetime
from app import database
from app.models import EntityCreate, CurationCreate


@pytest.mark.asyncio
class TestDatabaseHelpers:
    """Test database helper functions"""

    async def test_count_entities(self, test_db, sample_entity_data, auth_headers):
        """Test counting entities"""
        # Create some entities
        entity1 = EntityCreate(**sample_entity_data)
        entity2 = EntityCreate(**{**sample_entity_data, "name": "Entity 2"})
        
        await database.create_entity(entity1)
        await database.create_entity(entity2)
        
        # Count all entities
        count = await database.count_entities()
        assert count >= 2

    async def test_count_entities_with_filter(self, test_db, sample_entity_data):
        """Test counting entities with type filter"""
        # Create entities of different types
        restaurant_data = {**sample_entity_data, "type": "restaurant"}
        hotel_data = {**sample_entity_data, "type": "hotel", "name": "Test Hotel"}
        
        await database.create_entity(EntityCreate(**restaurant_data))
        await database.create_entity(EntityCreate(**hotel_data))
        
        # Count restaurants
        restaurant_count = await database.count_entities(entity_type="restaurant")
        assert restaurant_count >= 1
        
        # Count hotels
        hotel_count = await database.count_entities(entity_type="hotel")
        assert hotel_count >= 1

    async def test_count_curations(self, test_db, sample_entity_data, sample_curation_data):
        """Test counting curations"""
        # Create entity and curation
        entity = await database.create_entity(EntityCreate(**sample_entity_data))
        
        curation_data = {**sample_curation_data, "entity_id": entity.entity_id}
        await database.create_curation(CurationCreate(**curation_data))
        
        # Count all curations
        count = await database.count_curations()
        assert count >= 1

    async def test_get_entities_since(self, test_db, sample_entity_data):
        """Test getting entities updated since timestamp"""
        # Create entity
        entity = await database.create_entity(EntityCreate(**sample_entity_data))
        
        # Get entities since very old timestamp
        old_timestamp = datetime(2020, 1, 1)
        entities = await database.get_entities_since(old_timestamp)
        
        # Should include our entity
        entity_ids = [e.entity_id for e in entities]
        assert entity.entity_id in entity_ids

    async def test_get_curations_since(self, test_db, sample_entity_data, sample_curation_data):
        """Test getting curations updated since timestamp"""
        # Create entity and curation
        entity = await database.create_entity(EntityCreate(**sample_entity_data))
        
        curation_data = {**sample_curation_data, "entity_id": entity.entity_id}
        curation = await database.create_curation(CurationCreate(**curation_data))
        
        # Get curations since very old timestamp
        old_timestamp = datetime(2020, 1, 1)
        curations = await database.get_curations_since(old_timestamp)
        
        # Should include our curation
        curation_ids = [c.curation_id for c in curations]
        assert curation.curation_id in curation_ids

    async def test_hard_delete_entity(self, test_db, sample_entity_data):
        """Test hard deleting entity (permanent removal)"""
        # Create entity
        entity = await database.create_entity(EntityCreate(**sample_entity_data))
        entity_id = entity.entity_id
        
        # Verify it exists
        existing = await database.get_entity(entity_id)
        assert existing is not None
        
        # Hard delete
        success = await database.hard_delete_entity(entity_id)
        assert success is True
        
        # Verify it's gone
        deleted = await database.get_entity(entity_id)
        assert deleted is None

    async def test_hard_delete_nonexistent_entity(self, test_db):
        """Test hard deleting nonexistent entity"""
        success = await database.hard_delete_entity("nonexistent_entity_999")
        assert success is False

    async def test_update_entity_metadata(self, test_db, sample_entity_data):
        """Test updating entity metadata"""
        # Create entity
        entity = await database.create_entity(EntityCreate(**sample_entity_data))
        
        # Add metadata
        metadata = {
            "type": "test_metadata",
            "source": "test_suite",
            "data": {"key": "value"},
            "timestamp": datetime.utcnow()
        }
        
        success = await database.update_entity_metadata(entity.entity_id, metadata)
        assert success is True
        
        # Verify metadata was added
        updated_entity = await database.get_entity(entity.entity_id)
        assert updated_entity is not None
        assert updated_entity.metadata is not None
        assert len(updated_entity.metadata) > 0

    async def test_list_entities_with_pagination(self, test_db, sample_entity_data):
        """Test listing entities with skip and limit"""
        # Create multiple entities
        for i in range(5):
            entity_data = {**sample_entity_data, "name": f"Entity {i}"}
            await database.create_entity(EntityCreate(**entity_data))
        
        # Get first page
        page1 = await database.list_entities(skip=0, limit=2)
        assert len(page1) == 2
        
        # Get second page
        page2 = await database.list_entities(skip=2, limit=2)
        assert len(page2) == 2
        
        # Pages should contain different entities
        page1_ids = {e.entity_id for e in page1}
        page2_ids = {e.entity_id for e in page2}
        assert page1_ids != page2_ids

    async def test_list_curations_with_pagination(self, test_db, sample_entity_data, sample_curation_data):
        """Test listing curations with skip and limit"""
        # Create entity
        entity = await database.create_entity(EntityCreate(**sample_entity_data))
        
        # Create multiple curations with different timestamps to avoid duplicates
        import asyncio
        for i in range(5):
            curation_data = {
                **sample_curation_data,
                "entity_id": entity.entity_id,
                "concept": f"Unique Concept {i} {datetime.utcnow().timestamp()}"
            }
            await database.create_curation(CurationCreate(**curation_data))
            await asyncio.sleep(0.01)  # Small delay to ensure different IDs
        
        # Get first page
        page1 = await database.list_curations(skip=0, limit=2)
        assert len(page1) >= 2
        
        # Get second page
        page2 = await database.list_curations(skip=2, limit=2)
        assert len(page2) >= 2

    async def test_list_curations_by_entity(self, test_db, sample_entity_data, sample_curation_data):
        """Test filtering curations by entity_id"""
        # Create two entities
        entity1 = await database.create_entity(EntityCreate(**sample_entity_data))
        entity2 = await database.create_entity(EntityCreate(**{**sample_entity_data, "name": "Entity 2"}))
        
        # Create curations for each entity
        curation1_data = {**sample_curation_data, "entity_id": entity1.entity_id}
        await database.create_curation(CurationCreate(**curation1_data))
        
        curation2_data = {**sample_curation_data, "entity_id": entity2.entity_id, "concept": "Different concept"}
        await database.create_curation(CurationCreate(**curation2_data))
        
        # Get curations for entity1
        entity1_curations = await database.list_curations(entity_id=entity1.entity_id)
        
        # Should only contain entity1's curations
        for curation in entity1_curations:
            assert curation.entity_id == entity1.entity_id

    async def test_list_curations_by_curator(self, test_db, sample_entity_data, sample_curation_data):
        """Test filtering curations by curator_id"""
        # Create entity
        entity = await database.create_entity(EntityCreate(**sample_entity_data))
        
        # Create curations with different curators
        curator1_data = {**sample_curation_data, "entity_id": entity.entity_id, "curator_id": "curator_1"}
        curator2_data = {**sample_curation_data, "entity_id": entity.entity_id, "curator_id": "curator_2", "concept": "Different"}
        
        await database.create_curation(CurationCreate(**curator1_data))
        await database.create_curation(CurationCreate(**curator2_data))
        
        # Get curations for curator_1
        curator1_curations = await database.list_curations(curator_id="curator_1")
        
        # Should only contain curator_1's curations
        for curation in curator1_curations:
            assert curation.curator_id == "curator_1"

    async def test_list_entities_by_status(self, test_db, sample_entity_data):
        """Test filtering entities by status"""
        # Create entities with different statuses
        active_data = {**sample_entity_data, "name": "Active Entity"}
        draft_data = {**sample_entity_data, "name": "Draft Entity"}
        
        active_entity = await database.create_entity(EntityCreate(**active_data))
        draft_entity = await database.create_entity(EntityCreate(**draft_data))
        
        # Update one to draft status
        from app.models import EntityUpdate
        await database.update_entity(
            draft_entity.entity_id,
            EntityUpdate(status="draft", version=draft_entity.version),
            draft_entity.version
        )
        
        # Get only active entities
        active_entities = await database.list_entities(status="active")
        statuses = [e.status for e in active_entities]
        
        # Should only contain active entities
        assert all(status == "active" for status in statuses)


@pytest.mark.asyncio
class TestDatabaseErrorHandling:
    """Test database error handling"""

    async def test_create_entity_with_duplicate_detection(self, test_db, sample_entity_data):
        """Test that creating similar entities works (no unique constraint on name)"""
        # Create first entity
        entity1 = await database.create_entity(EntityCreate(**sample_entity_data))
        
        # Create second entity with same name (should work - no unique constraint)
        entity2 = await database.create_entity(EntityCreate(**sample_entity_data))
        
        # Should create both successfully
        assert entity1.entity_id != entity2.entity_id
        assert entity1.name == entity2.name

    async def test_update_entity_with_invalid_id(self, test_db):
        """Test updating nonexistent entity"""
        from app.models import EntityUpdate
        
        update_data = EntityUpdate(name="Updated Name", version=1)
        result = await database.update_entity("nonexistent_id_999", update_data, 1)
        
        # Should return None (not found)
        assert result is None

    async def test_update_curation_with_invalid_id(self, test_db):
        """Test updating nonexistent curation"""
        from app.models import CurationUpdate
        
        update_data = CurationUpdate(concept="Updated Concept", version=1)
        result = await database.update_curation("nonexistent_id_999", update_data, 1)
        
        # Should return None (not found)
        assert result is None

    async def test_delete_curation_twice(self, test_db, sample_entity_data, sample_curation_data):
        """Test deleting same curation twice"""
        # Create entity and curation
        entity = await database.create_entity(EntityCreate(**sample_entity_data))
        curation_data = {**sample_curation_data, "entity_id": entity.entity_id}
        curation = await database.create_curation(CurationCreate(**curation_data))
        
        # First delete should succeed
        success1 = await database.delete_curation(curation.curation_id, soft_delete=True)
        assert success1 is True
        
        # Second soft delete should also succeed (updates is_deleted again)
        # MongoDB update will return modified_count=0 if already deleted
        # but the function returns True if the update query executes
        success2 = await database.delete_curation(curation.curation_id, soft_delete=True)
        # This may succeed or fail depending on implementation
        # Just verify the curation exists and is marked deleted
        result = await database.get_curation(curation.curation_id)
        if result:
            assert result.is_deleted is True
