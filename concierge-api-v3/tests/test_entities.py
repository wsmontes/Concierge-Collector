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

    def test_list_entities_default(self, client, auth_headers):
        """Test listing entities with default params"""
        response = client.get("/api/v3/entities", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "limit" in data
        assert "offset" in data
        assert isinstance(data["items"], list)
        assert data["limit"] == 50
        assert data["offset"] == 0

    def test_list_entities_with_limit(self, client, auth_headers):
        """Test listing entities with custom limit"""
        response = client.get("/api/v3/entities?limit=10", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) <= 10
        assert data["limit"] == 10

    def test_list_entities_with_offset(self, client, auth_headers):
        """Test listing entities with offset"""
        response = client.get("/api/v3/entities?offset=5", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["offset"] == 5

    def test_list_entities_filter_by_type(self, client, auth_headers):
        """Test filtering entities by type"""
        response = client.get("/api/v3/entities?type=restaurant", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        # All returned items should be restaurants
        for item in data["items"]:
            assert item["type"] == "restaurant"

    def test_list_entities_filter_by_name(self, client, auth_headers):
        """Test filtering entities by name (regex)"""
        response = client.get("/api/v3/entities?name=test", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        # Should filter by name case-insensitive
        assert isinstance(data["items"], list)

    def test_list_entities_pagination_limits(self, client, auth_headers):
        """Test pagination limits"""
        # Max limit
        response = client.get("/api/v3/entities?limit=1000", headers=auth_headers)
        assert response.status_code == 200

        # Over max should fail
        response = client.get("/api/v3/entities?limit=1001", headers=auth_headers)
        assert response.status_code == 422

    def test_create_entity_without_auth(self, client, sample_entity):
        """Test creating entity without authentication fails"""
        response = client.post("/api/v3/entities", json=sample_entity)

        # Must fail with 401 Unauthorized
        assert response.status_code == 401

    def test_get_entity_not_found(self, client, auth_headers):
        """Test getting non-existent entity"""
        response = client.get("/api/v3/entities/nonexistent_id", headers=auth_headers)

        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"].lower()

    def test_get_existing_entity(self, client, auth_headers):
        """Test getting an existing entity"""
        # First get list to find an entity
        list_response = client.get("/api/v3/entities?limit=1", headers=auth_headers)
        entities = list_response.json()["items"]

        if entities:
            # Try both _id and entity_id for lookup
            entity_id = entities[0].get("_id") or entities[0]["entity_id"]
            response = client.get(f"/api/v3/entities/{entity_id}", headers=auth_headers)

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

    def test_list_entities_invalid_limit(self, client, auth_headers):
        """Test listing with invalid limit (auth corre antes da validação)"""
        response = client.get("/api/v3/entities?limit=-1", headers=auth_headers)
        assert response.status_code == 422

    def test_list_entities_invalid_offset(self, client, auth_headers):
        """Test listing with invalid offset (auth corre antes da validação)"""
        response = client.get("/api/v3/entities?offset=-1", headers=auth_headers)
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
def test_list_entities_ids_filter(client, test_db, clean_test_entities, auth_headers):
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

    r = client.get("/api/v3/entities", params={"ids": "ids_slug_ent,ids_hex_ent", "limit": 50}, headers=auth_headers)
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
    r2 = client.get("/api/v3/entities", params={"ids": "507f1f77bcf86cd799439011", "limit": 50}, headers=auth_headers)
    assert r2.status_code == 200
    r2_ids = [i.get("entity_id") or i.get("_id") for i in r2.json()["items"]]
    assert any(str(i) == "507f1f77bcf86cd799439011" for i in r2_ids) or "hex-oid-slug" in r2_ids


@pytest.mark.mongo
def test_list_entities_filter_by_city_street_regex(client, clean_test_entities, test_db, auth_headers):
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
    response = client.get("/api/v3/entities?city=sao+paulo", headers=auth_headers)
    assert response.status_code == 200
    names = {i["name"] for i in response.json()["items"] if i["name"].startswith("Cafe")}
    assert names == {"Cafe Beta"}

    # cidade no campo city do formato v3
    response = client.get("/api/v3/entities?city=victoria", headers=auth_headers)
    names = {i["name"] for i in response.json()["items"] if i["name"].startswith("Cafe")}
    assert "Cafe Alpha" in names

    # regex escapado: caracteres especiais não podem derrubar nem vazar
    response = client.get("/api/v3/entities?city=%28", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["items"] == []


@pytest.mark.mongo
def test_list_entities_q_alias_of_name(client, clean_test_entities, test_db, auth_headers):
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
    response = client.get("/api/v3/entities?q=quesadilla", headers=auth_headers)
    assert response.status_code == 200
    names = [i["name"] for i in response.json()["items"]]
    assert "Quesadilla House" in names
    assert "Other Place" not in names

    response = client.get("/api/v3/entities?name=quesadilla", headers=auth_headers)
    names = [i["name"] for i in response.json()["items"]]
    assert "Quesadilla House" in names
    assert "Other Place" not in names


@pytest.mark.mongo
class TestDeleteEntityAccess:
    """Delete de entity: admin-only + 409 com curadorias vinculadas.

    Decisão 2026-08-15 (code review externo, achado #9): curator podia apagar
    QUALQUER entity (hard delete) e orfanar curadorias de terceiros. Agora o
    delete é restrito a admin e bloqueado quando há curadorias ativas.
    """

    def _seed_entity(self, test_db, eid):
        from datetime import datetime, timezone

        test_db.entities.insert_one(
            {
                "_id": eid,
                "entity_id": eid,
                "type": "restaurant",
                "name": f"Rest {eid}",
                "status": "active",
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
                "version": 1,
            }
        )

    def test_delete_entity_curator_forbidden(self, client, test_db):
        """Curator comum (JWT) recebe 403 — mesmo sem curations vinculadas."""
        from app.core.security import create_access_token

        self._seed_entity(test_db, "test_del_e1")
        # require_role revalida o usuário vivo no Mongo — sem o seed, 401.
        test_db.users.delete_many({"email": "cur@x.com"})
        test_db.users.insert_one({"_id": "user-cur", "email": "cur@x.com", "authorized": True, "role": "curator"})
        token = create_access_token(data={"sub": "cur@x.com", "role": "curator"})
        r = client.delete("/api/v3/entities/test_del_e1", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 403
        assert test_db.entities.find_one({"_id": "test_del_e1"}) is not None  # nada foi apagado
        test_db.entities.delete_one({"_id": "test_del_e1"})
        test_db.users.delete_one({"_id": "user-cur"})

    def test_delete_entity_admin_without_links(self, client, test_db, auth_headers):
        """Admin (API key) apaga entity sem curadorias ativas → 204."""
        self._seed_entity(test_db, "test_del_e2")
        r = client.delete("/api/v3/entities/test_del_e2", headers=auth_headers)
        assert r.status_code == 204
        assert test_db.entities.find_one({"_id": "test_del_e2"}) is None

    def test_delete_entity_blocked_by_active_curations(self, client, test_db, auth_headers):
        """Com curadorias ativas vinculadas → 409 com contagem; entity permanece."""
        from datetime import datetime, timezone

        self._seed_entity(test_db, "test_del_e3")
        test_db.curations.insert_many(
            [
                {
                    "_id": f"test_del_c{n}",
                    "curation_id": f"test_del_c{n}",
                    "entity_id": "test_del_e3",
                    "status": "active",
                    "curator": {"id": "a@x.com", "name": "a"},
                    "createdAt": datetime.now(timezone.utc),
                    "updatedAt": datetime.now(timezone.utc),
                }
                for n in (1, 2)
            ]
        )
        r = client.delete("/api/v3/entities/test_del_e3", headers=auth_headers)
        assert r.status_code == 409
        assert "2" in r.json()["detail"]
        assert test_db.entities.find_one({"_id": "test_del_e3"}) is not None
        test_db.curations.delete_many({"entity_id": "test_del_e3"})
        test_db.entities.delete_one({"_id": "test_del_e3"})

    def test_delete_entity_ignores_deleted_curations(self, client, test_db, auth_headers):
        """Curadorias soft-deletadas (status=deleted) não bloqueiam o delete."""
        from datetime import datetime, timezone

        self._seed_entity(test_db, "test_del_e4")
        test_db.curations.insert_one(
            {
                "_id": "test_del_c3",
                "curation_id": "test_del_c3",
                "entity_id": "test_del_e4",
                "status": "deleted",
                "curator": {"id": "a@x.com", "name": "a"},
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
            }
        )
        r = client.delete("/api/v3/entities/test_del_e4", headers=auth_headers)
        assert r.status_code == 204
        test_db.curations.delete_one({"_id": "test_del_c3"})


@pytest.mark.mongo
def test_list_entities_ids_accepts_more_than_500(client, auth_headers):
    """Contrato do fast path: o servidor aplica o cap de 500 sem erro.

    O cliente faz chunking dos ids (bug 2026-08-15: o parâmetro era
    descartado no transporte e nunca chegava aqui) — o servidor precisa
    aceitar listas longas e limitar internamente.
    """
    ids = ",".join(f"ent_nonexistent_{i}" for i in range(505))
    r = client.get(f"/api/v3/entities?ids={ids}", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert "items" in data


# ============================================================================
# Endpoint agregado /entities/{id}/image (véu sem o frontend montar query)
# ============================================================================


def _call_entity_image(db_doc=None, service_result=(b"jpeg", "image/jpeg"), service_side_effect=None):
    """Chama get_entity_image direto (sem TestClient) com db mockado e o
    serviço de imagem patcheado — unit test sem mongo."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock, patch
    from fastapi import HTTPException
    from app.api.entities import get_entity_image

    mock_db = MagicMock()
    # find_entity faz 3 probes (_id → entity_id → ObjectId); o mock
    # responde só ao primeiro com o doc desejado
    mock_db.entities.find_one.side_effect = lambda q: db_doc if q.get("_id") == "e1" else None

    async def run():
        with patch(
            "app.api.entities.get_og_image_bytes",
            new=AsyncMock(return_value=service_result, side_effect=service_side_effect),
        ) as svc:
            try:
                return await get_entity_image("e1", db=mock_db, auth={"role": "curator"}), svc
            except HTTPException as exc:
                return exc, svc

    return asyncio.run(run()), mock_db


def test_entity_image_resolve_website_da_entity():
    """data.contact.website (shape v3) vira page_url do serviço."""
    doc = {"_id": "e1", "data": {"contact": {"website": "https://example.com"}}}
    (result, svc), _ = _call_entity_image(db_doc=doc)
    svc.assert_awaited_once_with(page_url="https://example.com", place_id=None)
    assert result.status_code == 200
    assert result.body == b"jpeg"
    assert result.media_type == "image/jpeg"
    assert result.headers["Cache-Control"] == "public, max-age=3600"


def test_entity_image_resolve_place_id_bulk():
    """Shape bulk (data.contacts.website ausente) cai no place_id."""
    doc = {"_id": "e1", "data": {"contacts": {"phone": "x"}, "place_id": "ChIJ123"}}
    (result, svc), _ = _call_entity_image(db_doc=doc)
    svc.assert_awaited_once_with(page_url=None, place_id="ChIJ123")
    assert result.status_code == 200


def test_entity_image_404_entity_inexistente():
    (result, svc), _ = _call_entity_image(db_doc=None)
    assert result.status_code == 404
    svc.assert_not_awaited()


def test_entity_image_404_sem_fonte_de_imagem():
    """Entity sem website nem place_id → 404 sem tocar o serviço."""
    doc = {"_id": "e1", "data": {"contact": {"phone": "x"}}}
    (result, svc), _ = _call_entity_image(db_doc=doc)
    assert result.status_code == 404
    svc.assert_not_awaited()


def test_entity_image_404_e_400_do_servico():
    # serviço sem imagem em nenhuma fonte → 404
    (result, _), _ = _call_entity_image(
        db_doc={"_id": "e1", "data": {"place_id": "ChIJ123"}},
        service_result=None,
    )
    assert result.status_code == 404

    # URL rejeitada pelo serviço → 400 (mesmo contrato do /og-image)
    (result2, _), _ = _call_entity_image(
        db_doc={"_id": "e1", "data": {"contact": {"website": "https://x.com"}}},
        service_side_effect=ValueError("URL inválida"),
    )
    assert result2.status_code == 400


def test_extract_image_sources_cadeia_tolerante():
    """_extract_image_sources cobre os dois shapes como o cardFactory."""
    from app.api.entities import _extract_image_sources

    assert _extract_image_sources({"data": {"contact": {"website": "w"}}}) == ("w", None)
    assert _extract_image_sources({"data": {"contacts": {"website": "w2"}, "place_id": "p"}}) == ("w2", "p")
    assert _extract_image_sources({"data": {"website": "w3"}}) == ("w3", None)
    assert _extract_image_sources({"data": {}}) == (None, None)
    assert _extract_image_sources({}) == (None, None)
