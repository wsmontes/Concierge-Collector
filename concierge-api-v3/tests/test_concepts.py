"""
Tests for Concepts API endpoints

Tests concept category management including:
- GET /concepts/{entity_type} - Get categories for entity type
- GET /concepts/ - List all concepts
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_get_concepts_restaurant(client: AsyncClient, test_db):
    """Test getting restaurant concepts"""
    # Setup: Create concepts document
    await test_db.concepts.insert_one({
        "entity_type": "restaurant",
        "categories": ["cuisine", "menu", "food_style", "drinks", "setting", 
                      "mood", "crowd", "suitable_for", "special_features", 
                      "covid_specials", "price_and_payment", "price_range"],
        "description": "Concept categories for restaurant entities",
        "version": 2,
        "active": True
    })
    
    response = await client.get("/api/v3/concepts/restaurant")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["entity_type"] == "restaurant"
    assert "categories" in data
    assert len(data["categories"]) == 12
    assert "cuisine" in data["categories"]
    assert "menu" in data["categories"]
    assert data["version"] == 2
    assert data["active"] is True


@pytest.mark.asyncio
async def test_get_concepts_fallback_to_restaurant(client: AsyncClient, test_db):
    """Test fallback to restaurant concepts when entity_type not found"""
    # Setup: Only create restaurant concepts
    await test_db.concepts.insert_one({
        "entity_type": "restaurant",
        "categories": ["cuisine", "menu", "food_style"],
        "active": True
    })
    
    # Request hotel concepts (doesn't exist)
    response = await client.get("/api/v3/concepts/hotel")
    
    assert response.status_code == 200
    data = response.json()
    
    # Should return restaurant categories
    assert data["entity_type"] == "restaurant"
    assert "cuisine" in data["categories"]


@pytest.mark.asyncio
async def test_get_concepts_not_found(client: AsyncClient, test_db):
    """Test 404 when no concepts exist"""
    response = await client.get("/api/v3/concepts/restaurant")
    
    assert response.status_code == 404
    assert "No active concepts found" in response.json()["detail"]


@pytest.mark.asyncio
async def test_list_all_concepts(client: AsyncClient, test_db):
    """Test listing all available concepts"""
    # Setup: Create multiple concept documents
    await test_db.concepts.insert_many([
        {
            "entity_type": "restaurant",
            "categories": ["cuisine", "menu", "food_style"],
            "version": 2,
            "active": True
        },
        {
            "entity_type": "hotel",
            "categories": ["amenities", "room_type", "location"],
            "version": 1,
            "active": True
        },
        {
            "entity_type": "bar",
            "categories": ["drinks", "atmosphere", "music"],
            "version": 1,
            "active": True
        }
    ])
    
    response = await client.get("/api/v3/concepts/")
    
    assert response.status_code == 200
    data = response.json()
    
    assert "concepts" in data
    assert "count" in data
    assert data["count"] == 3
    assert len(data["concepts"]) == 3
    
    # Check entity types
    entity_types = [c["entity_type"] for c in data["concepts"]]
    assert "restaurant" in entity_types
    assert "hotel" in entity_types
    assert "bar" in entity_types


@pytest.mark.asyncio
async def test_list_concepts_only_active(client: AsyncClient, test_db):
    """Test that only active concepts are returned"""
    # Setup: Create active and inactive concepts
    await test_db.concepts.insert_many([
        {
            "entity_type": "restaurant",
            "categories": ["cuisine"],
            "active": True
        },
        {
            "entity_type": "hotel",
            "categories": ["amenities"],
            "active": False  # Inactive
        }
    ])
    
    response = await client.get("/api/v3/concepts/")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["count"] == 1
    assert data["concepts"][0]["entity_type"] == "restaurant"


@pytest.mark.asyncio
async def test_concepts_mongodb_id_conversion(client: AsyncClient, test_db):
    """Test that MongoDB _id is converted to string"""
    await test_db.concepts.insert_one({
        "entity_type": "restaurant",
        "categories": ["cuisine"],
        "active": True
    })
    
    response = await client.get("/api/v3/concepts/restaurant")
    
    assert response.status_code == 200
    data = response.json()
    
    # _id should be converted to string
    assert "_id" in data
    assert isinstance(data["_id"], str)
    assert len(data["_id"]) == 24  # MongoDB ObjectId string length
