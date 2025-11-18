"""
Integration tests - End-to-end workflows
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_complete_entity_lifecycle(client: AsyncClient, auth_headers):
    """Test complete entity lifecycle"""
    entity_id = "rest_lifecycle_001"
    
    create_data = {
        "entity_id": entity_id,
        "type": "restaurant",
        "name": "Lifecycle Restaurant"
    }
    create_response = await client.post("/api/v3/entities", json=create_data, headers=auth_headers)
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["version"] == 1
    
    read_response = await client.get(f"/api/v3/entities/{entity_id}")
    assert read_response.status_code == 200
    
    update_response = await client.patch(
        f"/api/v3/entities/{entity_id}",
        json={"name": "Updated"},
        headers={**auth_headers, "If-Match": f'"{created["version"]}"'}
    )
    assert update_response.status_code == 200
    
    delete_response = await client.delete(f"/api/v3/entities/{entity_id}", headers=auth_headers)
    assert delete_response.status_code == 204
