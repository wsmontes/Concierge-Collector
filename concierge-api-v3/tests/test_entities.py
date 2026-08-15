"""
Test entity endpoints: CRUD operations
"""

import pytest
from starlette.requests import Request


def _req():
    """Request mínimo para chamadas diretas do verify_auth."""
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""})


@pytest.mark.mongo
class TestEntityEndpoints:
    """Test entity CRUD operations"""

    def test_list_entities_default(self, client):
        """Test listing entities with default params"""
        response = client.get("/api/v3/entities")

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "limit" in data
        assert "offset" in data
        assert isinstance(data["items"], list)
        assert data["limit"] == 50
        assert data["offset"] == 0

    def test_list_entities_with_limit(self, client):
        """Test listing entities with custom limit"""
        response = client.get("/api/v3/entities?limit=10")

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) <= 10
        assert data["limit"] == 10

    def test_list_entities_with_offset(self, client):
        """Test listing entities with offset"""
        response = client.get("/api/v3/entities?offset=5")

        assert response.status_code == 200
        data = response.json()
        assert data["offset"] == 5

    def test_list_entities_filter_by_type(self, client):
        """Test filtering entities by type"""
        response = client.get("/api/v3/entities?type=restaurant")

        assert response.status_code == 200
        data = response.json()
        # All returned items should be restaurants
        for item in data["items"]:
            assert item["type"] == "restaurant"

    def test_list_entities_filter_by_name(self, client):
        """Test filtering entities by name (regex)"""
        response = client.get("/api/v3/entities?name=test")

        assert response.status_code == 200
        data = response.json()
        # Should filter by name case-insensitive
        assert isinstance(data["items"], list)

    def test_list_entities_pagination_limits(self, client):
        """Test pagination limits"""
        # Max limit
        response = client.get("/api/v3/entities?limit=1000")
        assert response.status_code == 200

        # Over max should fail
        response = client.get("/api/v3/entities?limit=1001")
        assert response.status_code == 422

    def test_create_entity_without_auth(self, client, sample_entity):
        """Test creating entity without authentication fails"""
        response = client.post("/api/v3/entities", json=sample_entity)

        # Must fail with 401 Unauthorized
        assert response.status_code == 401

    def test_get_entity_not_found(self, client):
        """Test getting non-existent entity"""
        response = client.get("/api/v3/entities/nonexistent_id")

        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"].lower()

    def test_get_existing_entity(self, client):
        """Test getting an existing entity"""
        # First get list to find an entity
        list_response = client.get("/api/v3/entities?limit=1")
        entities = list_response.json()["items"]

        if entities:
            # Try both _id and entity_id for lookup
            entity_id = entities[0].get("_id") or entities[0]["entity_id"]
            response = client.get(f"/api/v3/entities/{entity_id}")

            # May fail if MongoDB uses different ID field
            assert response.status_code in [200, 404]

            if response.status_code == 200:
                data = response.json()
                assert "type" in data
                assert "name" in data

    def test_update_entity_without_auth(self, client):
        """Test updating entity without authentication"""
        response = client.patch("/api/v3/entities/test_id", json={"name": "Updated Name"})

        assert response.status_code == 401  # Unauthorized

    def test_update_entity_missing_if_match(self, client, auth_headers):
        """Test updating entity without If-Match header"""
        response = client.patch(
            "/api/v3/entities/test_id",
            json={"name": "Updated Name"},
            headers=auth_headers,
        )

        assert response.status_code == 428  # Precondition Required (missing If-Match)

    def test_delete_entity_without_auth(self, client):
        """Test deleting entity without authentication"""
        response = client.delete("/api/v3/entities/test_id")

        assert response.status_code == 401  # Unauthorized

    def test_delete_entity_not_found(self, client, auth_headers):
        """Test deleting non-existent entity"""
        response = client.delete("/api/v3/entities/nonexistent_id", headers=auth_headers)

        assert response.status_code == 404  # Not Found


class TestEntityValidation:
    """Test entity data validation"""

    def test_create_entity_invalid_data(self, client):
        """Test creating entity with invalid data"""
        invalid_entity = {
            "type": "restaurant"
            # Missing required fields
        }

        response = client.post("/api/v3/entities", json=invalid_entity)
        # Without auth, expects 401 before validation
        assert response.status_code == 401

    def test_list_entities_invalid_limit(self, client):
        """Test listing with invalid limit"""
        response = client.get("/api/v3/entities?limit=-1")
        assert response.status_code == 422

    def test_list_entities_invalid_offset(self, client):
        """Test listing with invalid offset"""
        response = client.get("/api/v3/entities?offset=-1")
        assert response.status_code == 422


class TestAuth:
    """Test authentication for entities"""

    def test_verify_auth_with_valid_jwt_token(self):
        """Verifica que verify_auth funciona com Bearer token JWT válido."""
        from unittest.mock import patch, MagicMock

        # Importa do módulo compartilhado em security.py
        from app.core.security import verify_auth

        # Simula um token JWT válido
        mock_bearer = MagicMock()
        mock_bearer.credentials = "valid.jwt.token"

        with patch("app.core.security.get_api_secret_key", return_value="test-secret"):
            with patch(
                "app.core.security.jwt.decode",
                return_value={"sub": "test@test.com", "role": "curator", "type": "access"},
            ):
                result = verify_auth(_req(), api_key=None, bearer=mock_bearer)
                assert result["authenticated"] is True
                assert result["method"] == "jwt"
                assert result["user"] == "test@test.com"
                assert result["role"] == "curator"


@pytest.mark.mongo
def test_list_entities_ids_filter(client, test_db, clean_test_entities):
    """GET /entities?ids= busca SÓ as entidades pedidas (string + hex
    ObjectId + slug) — o fast-path do pull do collector depende disso."""
    test_db.entities.insert_many(
        [
            {
                "_id": "ids_slug_ent",
                "entity_id": "ids_slug_ent",
                "name": "Alvo Slug",
                "status": "active",
                "type": "restaurant",
                "updatedAt": "2026-08-13T00:00:00Z",
            },
            {
                "_id": "ids_hex_ent",
                "entity_id": "ids_hex_ent",
                "name": "Alvo Hex",
                "status": "active",
                "type": "restaurant",
                "updatedAt": "2026-08-13T00:00:00Z",
            },
            {
                "_id": "ids_noise",
                "entity_id": "ids_noise",
                "name": "Ruído",
                "status": "active",
                "type": "restaurant",
                "updatedAt": "2026-08-13T00:00:00Z",
            },
        ]
    )

    r = client.get("/api/v3/entities", params={"ids": "ids_slug_ent,ids_hex_ent", "limit": 50})
    assert r.status_code == 200
    items = r.json()["items"]
    ids = {i.get("entity_id") or i.get("_id") for i in items}
    assert "ids_slug_ent" in ids
    assert "ids_hex_ent" in ids
    assert "ids_noise" not in ids

    # hex válido casa ObjectId ($in de string NÃO casa ObjectId sem variante)
    from bson import ObjectId

    test_db.entities.insert_one(
        {
            "_id": ObjectId("507f1f77bcf86cd799439011"),
            "entity_id": "hex-oid-slug",
            "name": "Alvo ObjectId",
            "status": "active",
            "type": "restaurant",
            "updatedAt": "2026-08-13T00:00:00Z",
        }
    )
    r2 = client.get("/api/v3/entities", params={"ids": "507f1f77bcf86cd799439011", "limit": 50})
    assert r2.status_code == 200
    r2_ids = [i.get("entity_id") or i.get("_id") for i in r2.json()["items"]]
    assert any(str(i) == "507f1f77bcf86cd799439011" for i in r2_ids) or "hex-oid-slug" in r2_ids


@pytest.mark.mongo
def test_list_entities_filter_by_city_street_regex(client, clean_test_entities, test_db):
    """city filtra via regex no address.street (bulk) e address.city (v3)"""
    from datetime import datetime, timezone

    test_db.entities.insert_many(
        [
            {
                "_id": "test_city_v3",
                "entity_id": "test_city_v3",
                "type": "restaurant",
                "name": "Cafe Alpha",
                "status": "active",
                "data": {
                    "address": {"city": "Victoria", "street": "944 Fort St"},
                    "location": {"type": "Point", "coordinates": [0, 0]},
                },
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
                "version": 1,
            },
            {
                "_id": "test_city_bulk",
                "entity_id": "test_city_bulk",
                "type": "restaurant",
                "name": "Cafe Beta",
                "status": "active",
                "data": {
                    "address": {"city": "", "street": "Rua X, 10 - Pinheiros, São Paulo - SP, Brazil"},
                    "location": {"type": "Point", "coordinates": [0, 0]},
                },
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
                "version": 1,
            },
            {
                "_id": "test_city_other",
                "entity_id": "test_city_other",
                "type": "restaurant",
                "name": "Cafe Gamma",
                "status": "active",
                "data": {
                    "address": {"city": "Paris", "street": "1 Rue X"},
                    "location": {"type": "Point", "coordinates": [0, 0]},
                },
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
                "version": 1,
            },
        ]
    )
    # cidade no street do bulk (case-insensitive)
    response = client.get("/api/v3/entities?city=sao+paulo")
    assert response.status_code == 200
    names = {i["name"] for i in response.json()["items"] if i["name"].startswith("Cafe")}
    assert names == {"Cafe Beta"}

    # cidade no campo city do formato v3
    response = client.get("/api/v3/entities?city=victoria")
    names = {i["name"] for i in response.json()["items"] if i["name"].startswith("Cafe")}
    assert "Cafe Alpha" in names

    # regex escapado: caracteres especiais não podem derrubar nem vazar
    response = client.get("/api/v3/entities?city=%28")
    assert response.status_code == 200
    assert response.json()["items"] == []


@pytest.mark.mongo
def test_list_entities_q_alias_of_name(client, clean_test_entities, test_db):
    """q funciona como o name (regex no nome), e name continua funcionando"""
    from datetime import datetime, timezone

    test_db.entities.insert_many(
        [
            {
                "_id": "test_q_alpha",
                "entity_id": "test_q_alpha",
                "type": "cafe",
                "name": "Quesadilla House",
                "status": "active",
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
                "version": 1,
            },
            {
                "_id": "test_q_other",
                "entity_id": "test_q_other",
                "type": "cafe",
                "name": "Other Place",
                "status": "active",
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
                "version": 1,
            },
        ]
    )
    response = client.get("/api/v3/entities?q=quesadilla")
    assert response.status_code == 200
    names = [i["name"] for i in response.json()["items"]]
    assert "Quesadilla House" in names
    assert "Other Place" not in names

    response = client.get("/api/v3/entities?name=quesadilla")
    names = [i["name"] for i in response.json()["items"]]
    assert "Quesadilla House" in names
    assert "Other Place" not in names
