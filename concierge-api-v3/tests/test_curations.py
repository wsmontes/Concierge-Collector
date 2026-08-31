"""
Test curation endpoints
"""

import os
import pytest


@pytest.mark.mongo
class TestCurationEndpoints:
    """Test curation CRUD operations"""

    def test_search_curations_default(self, client, auth_headers):
        """Test searching curations with default params"""
        response = client.get("/api/v3/curations/search", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)

    def test_search_curations_with_limit(self, client, auth_headers):
        """Test searching curations with custom limit"""
        response = client.get("/api/v3/curations/search?limit=10", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["limit"] == 10

    def test_search_curations_sort_by_last_modified_default(self, client, auth_headers):
        """Últimas modificações primeiro é o padrão do modo offset (ago/2026)"""
        response = client.get(
            "/api/v3/curations/search?limit=50&sort_by=updated_at&sort_order=desc",
            headers=auth_headers,
        )
        assert response.status_code == 200
        items = response.json()["items"]
        if len(items) >= 2:
            updated = [(item.get("updated_at") or item.get("updatedAt") or "") for item in items]
            assert updated == sorted(updated, reverse=True)

    def test_search_curations_invalid_sort_order_rejected(self, client, auth_headers):
        response = client.get("/api/v3/curations/search?sort_order=sideways", headers=auth_headers)
        assert response.status_code == 422

    def test_search_curations_filter_by_status(self, client, auth_headers):
        """Test filtering curations by status"""
        response = client.get("/api/v3/curations/search?status=draft", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        # All returned items should have pending status (if any)
        for item in data["items"]:
            if "status" in item:
                assert item["status"] == "draft"

    def test_search_curations_filter_by_curator(self, client, auth_headers):
        """Test filtering curations by curator"""
        response = client.get("/api/v3/curations/search?curator_id=test_curator", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["items"], list)

    def test_get_entity_curations(self, client, auth_headers):
        """Test getting curations for specific entity"""
        # Use first entity from list — leitura de entities exige auth
        # (Baseline 1: hardening de leitura)
        entities_response = client.get("/api/v3/entities?limit=1", headers=auth_headers)
        entities = entities_response.json()["items"]

        if entities:
            # Try both _id and entity_id fields
            entity_id = entities[0].get("entity_id") or entities[0].get("_id")
            response = client.get(
                f"/api/v3/curations/entities/{entity_id}/curations",
                headers=auth_headers,
            )

            # May return 404 if entity not found by _id field
            assert response.status_code in [200, 404]

            if response.status_code == 200:
                data = response.json()
                assert isinstance(data, list)

    def test_create_curation_without_auth(self, client, sample_curation):
        """Test creating curation without authentication"""
        response = client.post("/api/v3/curations", json=sample_curation)

        assert response.status_code == 401

    def test_get_curation_not_found(self, client, auth_headers):
        """Test getting non-existent curation"""
        response = client.get("/api/v3/curations/nonexistent_id", headers=auth_headers)

        assert response.status_code == 404

    def test_update_curation_without_auth(self, client):
        """Test updating curation without authentication"""
        response = client.patch("/api/v3/curations/test_id", json={"status": "approved"})

        assert response.status_code == 401

    def test_delete_curation_without_auth(self, client):
        """Test deleting curation without authentication"""
        response = client.delete("/api/v3/curations/test_id")

        # Should fail without auth
        assert response.status_code == 401

    def test_search_long_special_query_no_500(self, client, auth_headers):
        """200 chars ending in a regex-special char; must not 500 (invalid-regex bug)"""
        q = "a" * 199 + "."
        r = client.get("/api/v3/curations/search", params={"q": q, "limit": 5}, headers=auth_headers)
        assert r.status_code == 200, r.text


class TestCurationValidation:
    """Test curation data validation"""

    def test_create_curation_invalid_data(self, client):
        """Test creating curation with invalid data"""
        invalid_curation = {
            "status": "pending"
            # Missing required fields
        }

        response = client.post("/api/v3/curations", json=invalid_curation)
        assert response.status_code == 401  # No auth provided

    def test_search_curations_invalid_status(self, client, auth_headers):
        """Test searching with invalid status"""
        response = client.get("/api/v3/curations/search?status=invalid_status", headers=auth_headers)

        # Should either accept (empty results) or reject
        assert response.status_code in [200, 422]


def _api_headers():
    return {"X-API-Key": os.environ["API_SECRET_KEY"]}


@pytest.mark.mongo
def test_search_filters_by_city_and_text(client, test_db, clean_test_curations, auth_headers):
    # roda no banco HERMÉTICO (conftest força <db>-test), então os únicos
    # docs da busca são os inseridos aqui — sem dependência do volume real
    test_db.curations.insert_many(
        [
            {
                "_id": "test_c_sp",
                "curation_id": "test_c_sp",
                "entity_id": "test_e1",
                "restaurant_name": "Pizzaria Napoli",
                "status": "draft",
                "city": "São Paulo",
                "type": "restaurant",
                "curator": {"id": "test_curator", "name": "Test"},
            },
            {
                "_id": "test_c_rio",
                "curation_id": "test_c_rio",
                "entity_id": "test_e2",
                "restaurant_name": "Bar do Rio",
                "status": "draft",
                "city": "Rio de Janeiro",
                "type": "bar",
                "curator": {"id": "test_curator", "name": "Test"},
            },
        ]
    )
    r = client.get("/api/v3/curations/search?city=São Paulo&limit=100", headers=auth_headers)
    ids = [i.get("curation_id") for i in r.json()["items"]]
    assert "test_c_sp" in ids and "test_c_rio" not in ids

    r2 = client.get("/api/v3/curations/search?q=napoli&limit=100", headers=auth_headers)
    ids2 = [i.get("curation_id") for i in r2.json()["items"]]
    assert "test_c_sp" in ids2 and "test_c_rio" not in ids2
    test_db.curations.delete_many({"_id": {"$in": ["test_c_sp", "test_c_rio"]}})


def test_bulk_upsert_handles_duplicate_key_race():
    """DuplicateKeyError no bulk upsert deve fazer update, não descartar dados."""
    from unittest.mock import patch, MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo
    from pymongo.errors import DuplicateKeyError

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    curation = CurationCreate(
        curation_id="cur_test_001",
        entity_id="ent_001",
        curator_id="curator_001",
        curator=CuratorInfo(id="curator_001", name="Test"),
        status="draft",
    )
    payload = BulkCurationCreate(curations=[curation])

    # Simula: lote não acha existente, insert_one lança DuplicateKeyError
    mock_db.curations.find.return_value = []
    mock_db.curations.find_one.return_value = None  # probe do recovery → None
    mock_db.curations.insert_one.side_effect = DuplicateKeyError("dup")

    mock_db.entities.find.return_value = []

    with patch(
        "app.api.curations.denormalize_curation_location",
        return_value={"city": None, "type": None},
    ):
        result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    # Deve ter chamado update_one (não só incrementar counter)
    mock_db.curations.update_one.assert_called()
    # $set não deve conter createdAt (preservar o original)
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs["$set"] if "$set" in call_kwargs else call_args[1]["$set"]
    assert "createdAt" not in set_doc, "createdAt must not be in $set (preserve original)"
    assert "_id" not in set_doc, "_id must not be in $set"
    # identidade/entidade do vencedor nunca são sobrescritas na corrida
    for field in (
        "createdBy",
        "curator",
        "curator_id",
        "updatedBy",
        "entity_id",
        "city",
        "type",
        "version",
    ):
        assert field not in set_doc, f"{field} não pode ir no $set da corrida"
    # versão avança por $inc atômico (monotônica mesmo sob corrida)
    inc_doc = call_kwargs.get("$inc") or call_args[1].get("$inc")
    assert inc_doc == {"version": 1}
    # Deve ter contabilizado como updated
    assert result.updated == 1
    # Não deve ter erros
    assert len(result.errors) == 0


def test_bulk_upsert_duplicate_key_preserves_created_at():
    """DuplicateKeyError recovery must not overwrite original createdAt."""
    from unittest.mock import patch, MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo
    from pymongo.errors import DuplicateKeyError

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    curation = CurationCreate(
        curation_id="cur_test_002",
        entity_id="ent_002",
        curator_id="curator_002",
        curator=CuratorInfo(id="curator_002", name="Test"),
        status="active",
    )
    payload = BulkCurationCreate(curations=[curation])

    mock_db.curations.find.return_value = []
    mock_db.curations.find_one.return_value = None  # probe do recovery → None
    mock_db.curations.insert_one.side_effect = DuplicateKeyError("dup")
    # Provide a matching entity so denormalization runs
    mock_db.entities.find.return_value = [
        {"_id": "ent_002", "type": "restaurant", "data": {"location": {"city": "NYC"}}}
    ]

    with patch(
        "app.api.curations.denormalize_curation_location",
        return_value={"city": "NYC", "type": "restaurant"},
    ) as mock_denorm:
        result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    mock_denorm.assert_called_once()
    mock_db.curations.update_one.assert_called_once()
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs.get("$set") or call_args[1].get("$set")

    # Must NOT contain createdAt
    assert "createdAt" not in set_doc, "createdAt must NOT be in $set"
    # Must contain the fields from the new document (status update etc.)
    assert set_doc.get("status") == "active"
    # city/type do loser NÃO re-linkam o vencedor para outra entity
    assert "city" not in set_doc, "city do loser não pode ir no $set da corrida"
    assert "type" not in set_doc, "type do loser não pode ir no $set da corrida"
    assert "entity_id" not in set_doc, "entity_id do loser não pode ir no $set da corrida"
    # Must NOT contain _id
    assert "_id" not in set_doc
    assert result.updated == 1
    assert len(result.errors) == 0


def test_bulk_upsert_duplicate_key_reports_recovery_failure():
    """When update_one fails after DuplicateKeyError, error must be reported."""
    from unittest.mock import patch, MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo
    from pymongo.errors import DuplicateKeyError

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    curation = CurationCreate(
        curation_id="cur_test_003",
        entity_id="ent_003",
        curator_id="curator_003",
        curator=CuratorInfo(id="curator_003", name="Test"),
        status="draft",
    )
    payload = BulkCurationCreate(curations=[curation])

    mock_db.curations.find.return_value = []
    mock_db.curations.find_one.return_value = None  # probe do recovery → None
    mock_db.curations.insert_one.side_effect = DuplicateKeyError("dup")
    mock_db.curations.update_one.side_effect = RuntimeError("connection lost")
    mock_db.entities.find.return_value = []

    with patch(
        "app.api.curations.denormalize_curation_location",
        return_value={"city": None, "type": None},
    ):
        result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    # Must report the error instead of silently passing
    assert len(result.errors) == 1
    assert result.errors[0].index == 0
    assert result.errors[0].id == "cur_test_003"
    assert "DuplicateKeyError" in result.errors[0].error
    assert result.updated == 0


def test_bulk_upsert_update_preserves_stored_curator_when_payload_id_empty():
    """Update com curator de payload sem id real não pode destruir a
    identidade armazenada (curator_id + name/email reais)."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    existing = {
        "_id": "cur_test_010",
        "version": 3,
        "createdBy": "real-1",
        "createdAt": "2026-01-01T00:00:00Z",
        "curator_id": "real-1",
        "curator": {"id": "real-1", "name": "Nome Real", "email": "real@example.com"},
    }
    mock_db.curations.find.return_value = [existing]
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_test_010",
        entity_id="ent_010",
        curator_id="",
        curator=CuratorInfo(id="", name="Novo Nome", email=None),
        status="active",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 1
    assert len(result.errors) == 0
    mock_db.curations.update_one.assert_called_once()
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs.get("$set") or call_args[1].get("$set")

    assert set_doc["curator_id"] == "real-1", "curator_id armazenado deve prevalecer"
    assert set_doc["curator"]["id"] == "real-1", "curator.id armazenado deve prevalecer"
    assert set_doc["curator"]["name"] == "Novo Nome", "name real do payload atualiza"
    assert set_doc["curator"]["email"] == "real@example.com", "email=None do payload não destrói o armazenado"
    assert set_doc["version"] == 4


def test_bulk_upsert_update_offline_placeholder_preserves_stored_name_email():
    """O payload REAL do sync offline sem usuário ({id:'unknown',
    name:'unknown', email:null} — syncManagerV3.buildCuratorPayload) não pode
    destruir name/email reais armazenados."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    existing = {
        "_id": "cur_test_011",
        "version": 3,
        "createdBy": "real-1",
        "createdAt": "2026-01-01T00:00:00Z",
        "curator_id": "real-1",
        "curator": {"id": "real-1", "name": "Nome Real", "email": "real@example.com"},
    }
    mock_db.curations.find.return_value = [existing]
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_test_011",
        entity_id="ent_011",
        curator_id="unknown",
        curator=CuratorInfo(id="unknown", name="unknown", email=None),
        status="active",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 1
    assert len(result.errors) == 0
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs.get("$set") or call_args[1].get("$set")
    assert set_doc["curator_id"] == "real-1"
    assert set_doc["curator"]["id"] == "real-1"
    assert set_doc["curator"]["name"] == "Nome Real", "name 'unknown' do payload não destrói o real"
    assert set_doc["curator"]["email"] == "real@example.com", "email null do payload não destrói o real"


def test_bulk_upsert_update_stored_unknown_top_level_does_not_shadow_embedded_real():
    """Estado legado envenenado ({curator_id:'unknown'} com curator.id real)
    NÃO pode desarmar o reparo: o id embutido real prevalece como identidade
    armazenada."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    existing = {
        "_id": "cur_test_012",
        "version": 2,
        "curator_id": "unknown",
        "curator": {"id": "real-1", "name": "Nome Real", "email": "real@example.com"},
    }
    mock_db.curations.find.return_value = [existing]
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_test_012",
        entity_id="ent_012",
        curator_id="",
        curator=CuratorInfo(id="", name="Novo"),
        status="active",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 1
    assert len(result.errors) == 0
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs.get("$set") or call_args[1].get("$set")
    assert set_doc["curator_id"] == "real-1", "top-level 'unknown' não pode sombrear o id embutido real"
    assert set_doc["curator"]["id"] == "real-1"
    assert set_doc["curator"]["email"] == "real@example.com"


def test_bulk_upsert_update_top_real_with_empty_embedded_keeps_payload_id():
    """Payload com curator_id REAL e id embutido vazio não pode ter a
    reatribuição revertida silenciosamente — o id embutido sincroniza com o
    top-level (um id embutido '' some da busca por curator.id)."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    existing = {
        "_id": "cur_test_013",
        "version": 1,
        "curator_id": "joao-1",
        "curator": {"id": "joao-1", "name": "Joao"},
    }
    mock_db.curations.find.return_value = [existing]
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_test_013",
        entity_id="ent_013",
        curator_id="maria-2",
        curator=CuratorInfo(id="", name="Maria"),
        status="active",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 1
    assert len(result.errors) == 0
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs.get("$set") or call_args[1].get("$set")
    assert set_doc["curator_id"] == "maria-2", "reatribuição real do payload não pode ser revertida"
    assert set_doc["curator"]["id"] == "maria-2", "id embutido placeholder sincroniza com o top-level"
    assert set_doc["curator"]["name"] == "Maria"


def test_repair_curator_identity_patch_poison_shape():
    """O formato que o PATCH ainda aceitava e o bulk repara ({curator_id real,
    curator.id vazio}) não pode envenenar o id embutido — o helper único
    sincroniza o id embutido com o top-level real."""
    from app.api.curations import _repair_curator_identity

    update_data = {"curator_id": "real-9", "curator": {"id": "", "name": "x"}}
    stored = {
        "curator_id": "real-9",
        "curator": {"id": "real-9", "name": "Real", "email": "r@x.com"},
    }

    _repair_curator_identity(update_data, stored)

    assert update_data["curator_id"] == "real-9"
    assert update_data["curator"]["id"] == "real-9", "id embutido vazio envenena a busca por curator.id"
    assert update_data["curator"]["name"] == "x"


def test_bulk_upsert_batches_existence_lookup_constant_query_count():
    """O N+1 está morto: existência de N itens custa 2 queries por grupo de
    projeção (probe _id string + probe campo curation_id), não 2 por item.
    3 itens do mesmo grupo → call_count de find == 2."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    existing = {
        "_id": "cur_test_040",
        "version": 1,
        "curator_id": "curator_001",
        "curator": {"id": "curator_001", "name": "Test"},
    }
    # todos os probes em lote retornam o mesmo doc (probe 3 faz setdefault no-op)
    mock_db.curations.find.return_value = [existing]
    mock_db.entities.find.return_value = []

    curations = []
    for i, cid in enumerate(("cur_test_040", "cur_test_041", "cur_test_042")):
        curations.append(
            CurationCreate(
                curation_id=cid,
                entity_id=f"ent_04{i}",
                curator_id="curator_001",
                curator=CuratorInfo(id="curator_001", name="Test"),
                status="draft",
            )
        )
    payload = BulkCurationCreate(curations=curations)

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated + result.created == 3
    assert len(result.errors) == 0
    # 1 grupo (todos com identidade real): probe 1 + probe 3 = 2 queries
    # (hex probe não roda: ids não são ObjectId válidos)
    assert (
        mock_db.curations.find.call_count == 2
    ), f"existência deve custar 2 queries em lote, veio {mock_db.curations.find.call_count}"


def _patch_current():
    """Doc armazenado típico para os testes do PATCH (update_curation)."""
    return {
        "_id": "cur_patch_001",
        "curation_id": "cur_patch_001",
        "version": 3,
        "status": "draft",
        "createdBy": "real-1",
        "updatedBy": "real-1",
        "curator_id": "real-1",
        "curator": {"id": "real-1", "name": "Nome Real", "email": "real@example.com"},
        "categories": {},
    }


def _call_patch(mock_db, updates_dict, current=None, if_match=None, auth=None):
    from app.api.curations import update_curation
    from app.models.schemas import CurationUpdate

    stored = current if current is not None else _patch_current()
    mock_db.curations.find_one.return_value = stored
    # resposta do banco: o doc armazenado + o $set efetivo (o que o Mongo
    # retornaria) — o $set reparado só existe DEPOIS da chamada, então o
    # return_value é remendado a posteriori no helper
    mock_db.curations.find_one_and_update.return_value = {**stored, **updates_dict}
    result = update_curation(
        curation_id="cur_patch_001",
        updates=CurationUpdate(**updates_dict),
        if_match=if_match,
        db=mock_db,
        # admin por padrão: o stored doc pertence a "real-1" e os testes de
        # PATCH focam no write/versão, não no ownership (os testes de IDOR
        # passam auth de curator explicitamente)
        auth=auth if auth is not None else {"role": "admin", "user": "test@test.com"},
    )
    set_doc = mock_db.curations.find_one_and_update.call_args[0][1]["$set"]
    return result, set_doc


def test_patch_returns_404_when_curation_missing():
    from unittest.mock import MagicMock
    from fastapi import HTTPException
    from app.api.curations import update_curation
    from app.models.schemas import CurationUpdate
    import pytest as _pytest

    mock_db = MagicMock()
    mock_db.curations.find_one.return_value = None

    with _pytest.raises(HTTPException) as exc_info:
        update_curation(
            curation_id="cur_patch_999",
            updates=CurationUpdate(status="active"),
            if_match=None,  # chamada direta: default Header(None) não serve
            db=mock_db,
            auth={"role": "curator", "user": "test@test.com"},
        )
    assert exc_info.value.status_code == 404


def test_patch_if_match_conflict_returns_409():
    from fastapi import HTTPException
    from unittest.mock import MagicMock
    import pytest as _pytest

    mock_db = MagicMock()
    with _pytest.raises(HTTPException) as exc_info:
        _call_patch(mock_db, {"status": "active"}, if_match="2")
    assert exc_info.value.status_code == 409
    mock_db.curations.find_one_and_update.assert_not_called()


def test_patch_if_match_invalid_format_returns_400():
    from fastapi import HTTPException
    from unittest.mock import MagicMock
    import pytest as _pytest

    mock_db = MagicMock()
    with _pytest.raises(HTTPException) as exc_info:
        _call_patch(mock_db, {"status": "active"}, if_match="abc")
    assert exc_info.value.status_code == 400


def test_patch_success_bumps_version_and_writes_with_optimistic_lock():
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    result, set_doc = _call_patch(mock_db, {"status": "active"})

    assert result.status == "active"
    write_filter, write_update = mock_db.curations.find_one_and_update.call_args[0]
    assert write_filter == {
        "_id": "cur_patch_001",
        "version": 3,
    }, "optimistic lock pelo _id ESPECÍFICO + versão"
    assert set_doc["version"] == 4
    assert set_doc["updatedBy"] == "test@test.com", "sem identidade no PATCH, updatedBy cai no usuário autenticado"


def test_patch_placeholder_payload_preserves_stored_identity():
    """O reparo roda no PATCH também: payload offline placeholder não destrói
    name/email armazenados e updatedBy é computado DEPOIS do reparo."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    _result, set_doc = _call_patch(
        mock_db,
        {
            "curator_id": "",
            "curator": {"id": "unknown", "name": "unknown", "email": None},
        },
    )

    assert set_doc["curator_id"] == "real-1"
    assert set_doc["curator"]["id"] == "real-1"
    assert set_doc["curator"]["name"] == "Nome Real", "name 'unknown' do payload não destrói o real"
    assert set_doc["curator"]["email"] == "real@example.com", "email None do payload não destrói o real"
    assert set_doc["updatedBy"] == "real-1", "updatedBy DEPOIS do reparo, nunca placeholder"


def test_patch_top_real_with_empty_embedded_syncs_embedded_id():
    """Payload com curator_id real e id embutido vazio: o embutido sincroniza
    (não envenena a busca por curator.id)."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    _result, set_doc = _call_patch(
        mock_db,
        {
            "curator_id": "maria-2",
            "curator": {"id": "", "name": "Maria"},
        },
    )

    assert set_doc["curator_id"] == "maria-2"
    assert set_doc["curator"]["id"] == "maria-2"


def test_patch_conflict_when_doc_disappears_mid_update():
    from fastapi import HTTPException
    from unittest.mock import MagicMock
    import pytest as _pytest

    mock_db = MagicMock()
    current = _patch_current()
    mock_db.curations.find_one.return_value = current
    mock_db.curations.find_one_and_update.return_value = None

    from app.api.curations import update_curation
    from app.models.schemas import CurationUpdate

    with _pytest.raises(HTTPException) as exc_info:
        update_curation(
            curation_id="cur_patch_001",
            updates=CurationUpdate(status="active"),
            if_match=None,  # chamada direta: default Header(None) não serve
            db=mock_db,
            auth={"role": "admin", "user": "test@test.com"},
        )
    assert exc_info.value.status_code == 409


# ── IDOR: ownership (só o dono ou admin edita/deleta) ────────────────────


def test_patch_non_owner_returns_403():
    """IDOR: curator comum NÃO edita curadoria cujo dono armazenado é outro."""
    from fastapi import HTTPException
    from unittest.mock import MagicMock
    import pytest as _pytest

    mock_db = MagicMock()
    with _pytest.raises(HTTPException) as exc_info:
        _call_patch(
            mock_db,
            {"status": "active"},
            auth={"role": "curator", "user": "outro@test.com"},
        )
    assert exc_info.value.status_code == 403
    mock_db.curations.find_one_and_update.assert_not_called()


def test_patch_owner_matches_stored_identity():
    """IDOR: o DONO (JWT user == curator_id armazenado) edita sem bloqueio."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    result, _set_doc = _call_patch(
        mock_db,
        {"status": "active"},
        auth={"role": "curator", "user": "real-1"},
    )
    assert result.status == "active"


def test_patch_placeholder_stored_owner_allows_any_curator():
    """Curadoria legada SEM dono (placeholder 'unknown'/'') é editável por
    qualquer curator logado — o sync offline de registros antigos não trava."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    _result, _set_doc = _call_patch(
        mock_db,
        {"status": "active"},
        current={
            "_id": "cur_patch_001",
            "curation_id": "cur_patch_001",
            "version": 3,
            "status": "draft",
            "curator_id": "unknown",
            "curator": {"id": "", "name": "unknown", "email": None},
        },
        auth={"role": "curator", "user": "test@test.com"},
    )


def test_patch_cannot_reattribute_curation_to_another_curator():
    """IDOR (atribuição): o dono não pode re-atribuir a curadoria a um
    TERCEIRO via payload — o check roda sobre a identidade final do $set."""
    from fastapi import HTTPException
    from unittest.mock import MagicMock
    import pytest as _pytest

    mock_db = MagicMock()
    with _pytest.raises(HTTPException) as exc_info:
        _call_patch(
            mock_db,
            {"curator_id": "maria-2", "curator": {"id": "maria-2", "name": "Maria"}},
            auth={"role": "curator", "user": "real-1"},  # dono do stored doc
        )
    assert exc_info.value.status_code == 403
    mock_db.curations.find_one_and_update.assert_not_called()


def test_patch_admin_can_edit_any_curation():
    """Admin (API key / role admin) atua em nome de qualquer curator."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    result, _set_doc = _call_patch(
        mock_db,
        {"status": "active"},
        auth={"method": "api_key"},  # caminho dos scripts de bulk
    )
    assert result.status == "active"


def test_delete_non_owner_returns_403():
    """IDOR: curator comum não deleta curadoria de outro curator."""
    from fastapi import HTTPException
    from unittest.mock import MagicMock
    import pytest as _pytest
    from app.api.curations import delete_curation

    mock_db = MagicMock()
    mock_db.curations.find_one.return_value = {
        "_id": "cur_del_002",
        "curator_id": "real-1",
        "curator": {"id": "real-1"},
    }
    with _pytest.raises(HTTPException) as exc_info:
        delete_curation(
            curation_id="cur_del_002",
            db=mock_db,
            auth={"role": "curator", "user": "test@test.com"},
        )
    assert exc_info.value.status_code == 403
    mock_db.curations.update_one.assert_not_called()


def test_create_curation_mismatched_curator_returns_403():
    """IDOR: curator comum não cria curadoria em nome de outro curator."""
    from fastapi import HTTPException
    from unittest.mock import MagicMock
    import pytest as _pytest
    from app.api.curations import create_curation
    from app.models.schemas import CurationCreate

    mock_db = MagicMock()
    curation = CurationCreate(
        curation_id="cur_idor_001",
        entity_id=None,
        curator_id="outro-user",
        curator={"id": "outro-user", "name": "Outro"},
        status="active",
    )
    with _pytest.raises(HTTPException) as exc_info:
        create_curation(
            curation=curation,
            db=mock_db,
            auth={"role": "curator", "user": "test@test.com"},
        )
    assert exc_info.value.status_code == 403
    mock_db.curations.insert_one.assert_not_called()


def test_create_curation_placeholder_identity_allows_curator():
    """IDOR: identidade placeholder (sync offline) é permitida para curator
    comum — a curadoria fica sem dono, nunca atribuída a terceiro."""
    from unittest.mock import MagicMock
    from app.api.curations import create_curation
    from app.models.schemas import CurationCreate

    mock_db = MagicMock()
    # find_curation probeia: _id string (None → livre) e, como o id não é
    # ObjectId válido, pula o probe ObjectId e tenta curation_id (None).
    # Após o guard há uma leitura do máximo de catalog_sequence; a última
    # chamada (pós-insert) é o doc de response.
    mock_db.curations.find_one.side_effect = [
        None,
        None,
        None,
        {
            "_id": "cur_idor_002",
            "curation_id": "cur_idor_002",
            "curator_id": "",
            "curator": {"id": "unknown", "name": "unknown", "email": None},
            "categories": {},
            "status": "active",
            "version": 1,
        },
    ]
    mock_db.counters.find_one_and_update.return_value = {"value": 1}
    curation = CurationCreate(
        curation_id="cur_idor_002",
        entity_id=None,
        curator_id="",
        curator={"id": "unknown", "name": "unknown", "email": None},
        status="active",
    )
    result = create_curation(
        curation=curation,
        db=mock_db,
        auth={"role": "curator", "user": "test@test.com"},
    )
    assert result.curation_id == "cur_idor_002"


def test_delete_curation_soft_deletes_and_bumps_version():
    """DELETE é soft: $set status deleted + updatedBy, $inc version — o doc
    continua na coleção (recuperável)."""
    from unittest.mock import MagicMock
    from app.api.curations import delete_curation

    mock_db = MagicMock()
    mock_db.curations.find_one.return_value = {"_id": "cur_del_001"}

    delete_curation(
        curation_id="cur_del_001",
        db=mock_db,
        auth={"role": "curator", "user": "test@test.com"},
    )

    write_filter, write_update = mock_db.curations.update_one.call_args[0]
    assert write_filter == {"_id": "cur_del_001"}
    assert write_update["$set"]["status"] == "deleted"
    assert write_update["$set"]["updatedBy"] == "test@test.com"
    assert write_update["$inc"] == {"version": 1}


def test_delete_curation_404_when_missing():
    from unittest.mock import MagicMock
    from fastapi import HTTPException
    import pytest as _pytest
    from app.api.curations import delete_curation

    mock_db = MagicMock()
    mock_db.curations.find_one.return_value = None

    with _pytest.raises(HTTPException) as exc_info:
        delete_curation(
            curation_id="cur_del_999",
            db=mock_db,
            auth={"role": "curator", "user": "test@test.com"},
        )
    assert exc_info.value.status_code == 404
    mock_db.curations.update_one.assert_not_called()


def test_list_cities_filters_falsy_and_sorts():
    from unittest.mock import MagicMock
    from app.api.curations import list_cities

    mock_db = MagicMock()
    mock_db.curations.distinct.return_value = ["São Paulo", None, "Rio de Janeiro", ""]

    assert list_cities(db=mock_db) == ["Rio de Janeiro", "São Paulo"]


def test_repair_curator_identity_untouched_without_identity_keys():
    """PATCH que não menciona identidade (ex.: só status) não pode ganhar
    campos de curator no $set."""
    from app.api.curations import _repair_curator_identity

    update_data = {"status": "active"}
    stored = {"curator_id": "real-1", "curator": {"id": "real-1", "name": "Real"}}

    _repair_curator_identity(update_data, stored)

    assert update_data == {"status": "active"}


def test_bulk_upsert_duplicate_key_preserves_winner_identity_and_version():
    """Na corrida do DuplicateKeyError, o vencedor é autoritativo: curator,
    createdBy, updatedBy, version e linkage de entity não podem ser
    sobrescritos pelo perdedor; versão avança por $inc atômico."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo
    from pymongo.errors import DuplicateKeyError

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    winner = {
        "_id": "cur_test_004",
        "version": 5,
        "curator_id": "winner-1",
        "curator": {"id": "winner-1", "name": "Winner"},
    }
    # lote não acha existente (vai pro insert); probe do recovery acha o vencedor
    mock_db.curations.find.return_value = []
    mock_db.curations.find_one.return_value = winner
    mock_db.curations.insert_one.side_effect = DuplicateKeyError("dup")
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_test_004",
        entity_id="ent_004",
        curator_id="loser-1",
        curator=CuratorInfo(id="loser-1", name="Perdedor"),
        status="draft",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 1
    assert len(result.errors) == 0
    mock_db.curations.update_one.assert_called_once()
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs.get("$set") or call_args[1].get("$set")
    inc_doc = call_kwargs.get("$inc") or call_args[1].get("$inc")

    for forbidden in (
        "_id",
        "createdAt",
        "createdBy",
        "curator",
        "curator_id",
        "updatedBy",
        "entity_id",
        "city",
        "type",
        "version",
    ):
        assert forbidden not in set_doc, f"{forbidden} não pode ir no $set da corrida"
    assert inc_doc == {"version": 1}, "versão avança por $inc, não por leitura+escrita"
    assert set_doc["status"] == "draft"


def test_bulk_upsert_race_winner_placeholder_adopts_loser_real_identity():
    """Vencedor SEM identidade real (placeholder do sync offline) adota a
    identidade REAL do perdedor — o doc não fica órfão de curator."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo
    from pymongo.errors import DuplicateKeyError

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    winner = {
        "_id": "cur_test_005",
        "version": 2,
        "curator_id": "unknown",
        "curator": {"id": "unknown", "name": "unknown"},
    }
    mock_db.curations.find.return_value = []
    mock_db.curations.find_one.return_value = winner
    mock_db.curations.insert_one.side_effect = DuplicateKeyError("dup")
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_test_005",
        entity_id="ent_005",
        curator_id="maria-1",
        curator=CuratorInfo(id="maria-1", name="Maria", email="maria@example.com"),
        status="draft",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 1
    assert len(result.errors) == 0
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs.get("$set") or call_args[1].get("$set")
    assert set_doc["curator_id"] == "maria-1"
    assert set_doc["curator"]["id"] == "maria-1"
    assert set_doc["curator"]["email"] == "maria@example.com"
    # identidade de entity continua intocada mesmo nesse caso
    assert "entity_id" not in set_doc


def test_bulk_upsert_race_missing_winner_reports_error():
    """matched_count==0 (vencedor deletado no meio da corrida) é erro
    explícito — nunca contabilizar como salvo: o cliente descartaria a cópia
    local com base no contador de erros."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo
    from pymongo.errors import DuplicateKeyError

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    mock_db.curations.find.return_value = []
    mock_db.curations.find_one.return_value = None  # probe do recovery → None
    mock_db.curations.insert_one.side_effect = DuplicateKeyError("dup")
    mock_db.curations.update_one.return_value = MagicMock(matched_count=0)
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_test_006",
        entity_id="ent_006",
        curator_id="curator_006",
        curator=CuratorInfo(id="curator_006", name="Test"),
        status="draft",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 0
    assert len(result.errors) == 1
    assert result.errors[0].id == "cur_test_006"
    assert "vencedor não encontrado" in result.errors[0].error


def test_bulk_upsert_create_denormalizes_city_and_type_from_entity():
    """Caminho de CREATE do bulk: city/type vêm da entity pré-buscada (denorm
    real, sem patch) e o contador created incrementa."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    # entity_id em hex válido exercita a variante ObjectId do $in; o campo
    # entity_id do doc exercita o registro by_slug do pre-fetch
    entity_doc = {
        "_id": "507f1f77bcf86cd799439011",
        "entity_id": "slug-x",
        "type": "restaurant",
        "data": {"location": {"city": "NYC"}},
    }
    mock_db.entities.find.return_value = [entity_doc]
    # lote não acha existente → caminho de create
    mock_db.curations.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_test_020",
        entity_id="507f1f77bcf86cd799439011",
        curator_id="curator_001",
        curator=CuratorInfo(id="curator_001", name="Test"),
        status="draft",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.created == 1
    assert result.updated == 0
    assert len(result.errors) == 0
    inserted = mock_db.curations.insert_one.call_args[0][0]
    assert inserted["city"] == "NYC"
    assert inserted["type"] == "restaurant"
    assert inserted["version"] == 1
    assert inserted["_id"] == "cur_test_020"


def test_bulk_upsert_rejects_role_below_curator():
    """Role sem permissão de curadoria recebe 403 antes de tocar o banco."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo
    from fastapi import HTTPException

    mock_db = MagicMock()

    curation = CurationCreate(
        curation_id="cur_test_022",
        entity_id="ent_022",
        curator_id="curator_001",
        curator=CuratorInfo(id="curator_001", name="Test"),
        status="draft",
    )
    payload = BulkCurationCreate(curations=[curation])

    with pytest.raises(HTTPException) as exc_info:
        bulk_upsert_curations(
            request=MagicMock(),
            payload=payload,
            db=mock_db,
            auth={"role": "viewer", "user": "test@test.com"},
        )
    assert exc_info.value.status_code == 403
    mock_db.curations.insert_one.assert_not_called()


def test_bulk_upsert_records_generic_item_error():
    """Falha genérica em um item vira BulkItemError com index/id — os demais
    itens do payload seguem processando."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    def boom(*args, **kwargs):
        raise RuntimeError("db fora do ar")

    mock_db.curations.find.return_value = [
        {
            "_id": "cur_test_023",
            "version": 1,
            "curator_id": "curator_001",
            "curator": {"id": "curator_001", "name": "Test"},
        }
    ]
    mock_db.curations.update_one.side_effect = boom
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_test_023",
        entity_id="ent_023",
        curator_id="curator_001",
        curator=CuratorInfo(id="curator_001", name="Test"),
        status="draft",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.created == 0
    assert result.updated == 0
    assert len(result.errors) == 1
    assert result.errors[0].id == "cur_test_023"
    assert result.errors[0].index == 0
    assert "db fora do ar" in result.errors[0].error


def test_bulk_upsert_update_denormalizes_city_and_type_from_entity():
    """Caminho de UPDATE do bulk: $set recebe city/type denormalizados da
    entity (limpa campos stale quando a entity linkada mudar)."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    existing = {"_id": "cur_test_021", "version": 2}
    mock_db.curations.find.return_value = [existing]
    entity_doc = {
        "_id": "ent_021",
        "type": "bar",
        "data": {"location": {"city": "Rio de Janeiro"}},
    }
    mock_db.entities.find.return_value = [entity_doc]

    curation = CurationCreate(
        curation_id="cur_test_021",
        entity_id="ent_021",
        curator_id="curator_001",
        curator=CuratorInfo(id="curator_001", name="Test"),
        status="active",
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 1
    assert len(result.errors) == 0
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs.get("$set") or call_args[1].get("$set")
    assert set_doc["city"] == "Rio de Janeiro"
    assert set_doc["type"] == "bar"
    assert set_doc["version"] == 3


def _http_request(ip="127.0.0.1"):
    """Request real do starlette — o decorator do slowapi exige uma instância
    de starlette.requests.Request (não MagicMock)."""
    from starlette.requests import Request

    return Request(
        {
            "type": "http",
            "path": "/api/v3/curations/hybrid-search",
            "method": "POST",
            "query_string": b"",
            "headers": [],
            "client": (ip, 12345),
        }
    )


@pytest.mark.parametrize(
    "location",
    [
        ".*",
        "São Paulo (Centro) $$$",
    ],
)
def test_hybrid_search_escapes_location_regex(location):
    """Location parameter with regex metacharacters must be escaped before $regex."""
    import re
    from app.api.curations import hybrid_search
    from app.models.schemas import HybridSearchRequest
    from unittest.mock import MagicMock, patch
    import numpy as np
    import os

    old_key = os.environ.get("OPENAI_API_KEY")
    if not old_key:
        os.environ["OPENAI_API_KEY"] = "test-key"

    try:
        mock_db = MagicMock()
        mock_db.entities.find.return_value.limit.return_value = []
        mock_db.curations.find.return_value.limit.return_value = []

        body = HybridSearchRequest(query="pizza", location=location)

        with patch("app.api.curations.OpenAI") as mock_openai:
            mock_client = MagicMock()
            mock_emb = MagicMock()
            mock_emb.data = [MagicMock(embedding=[0.1] * 1536)]
            mock_client.embeddings.create.return_value = mock_emb
            mock_openai.return_value = mock_client

            with patch("app.api.curations.np.linalg.norm", return_value=1.0):
                with patch("app.api.curations.np.asarray", return_value=np.array([0.1] * 1536)):
                    response = hybrid_search(request=_http_request("127.0.0.3"), body=body, db=mock_db)

        # Must complete without error (no regex injection crash)
        assert response.total_results >= 0
        assert response.query == "pizza"

        # Verify that find was called with escaped location
        expected = re.escape(location)
        call_kwargs = mock_db.entities.find.call_args[0][0]
        or_clauses = call_kwargs["$or"]
        assert len(or_clauses) > 0, "Expected location $or clauses to be present"
        for clause in or_clauses:
            for field_key, regex_condition in clause.items():
                assert (
                    regex_condition["$regex"] == expected
                ), f"Expected escaped regex {expected!r}, got: {regex_condition['$regex']!r}"
    finally:
        if old_key is None:
            del os.environ["OPENAI_API_KEY"]
        else:
            os.environ["OPENAI_API_KEY"] = old_key


@pytest.mark.mongo
def test_create_curation_denormalizes_city_type(client, test_db, clean_test_entities, clean_test_curations):
    test_db.entities.insert_one(
        {
            "_id": "test_ent_denorm",
            "entity_id": "test_ent_denorm",
            "name": "T",
            "type": "bar",
            "data": {"location": {"city": "São Paulo"}},
        }
    )
    payload = {
        "curation_id": "test_cur_denorm",
        "entity_id": "test_ent_denorm",
        "curator_id": "test_curator",
        "curator": {"id": "test_curator", "name": "Test"},
        "categories": {"cuisine": ["bar"]},
        "status": "draft",
    }
    resp = client.post("/api/v3/curations", json=payload, headers=_api_headers())
    assert resp.status_code == 201, resp.text
    doc = test_db.curations.find_one({"_id": "test_cur_denorm"})
    assert doc["city"] == "São Paulo"
    assert doc["type"] == "bar"
    test_db.curations.delete_one({"_id": "test_cur_denorm"})


@pytest.mark.mongo
def test_bulk_upsert_rejects_foreign_ownership(client, clean_test_curations, test_db):
    """Curator comum NÃO atualiza curation de outro curator via bulk
    (auditoria ago/2026: o bulk validava role mas não ownership por item)."""
    from datetime import datetime, timezone
    from app.core.security import create_access_token

    # seed: curation do dono B
    test_db.curations.insert_one(
        {
            "_id": "test_own_b",
            "curation_id": "test_own_b",
            "entity_id": None,
            "curator_id": "bob@x.com",
            "curator": {"id": "bob@x.com", "name": "bob@x.com"},
            "restaurant_name": "Do Bob",
            "status": "draft",
            "categories": {},
            "sources": {},
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
            "version": 3,
        }
    )

    # token do curator A (curator comum, NÃO admin)
    # require_role revalida o usuário vivo — alice precisa existir no Mongo.
    test_db.users.delete_many({"email": "alice@x.com"})
    test_db.users.insert_one({"_id": "user-alice", "email": "alice@x.com", "authorized": True, "role": "curator"})
    token_a = create_access_token(data={"sub": "alice@x.com", "role": "curator"})

    payload = {
        "curations": [
            {
                "curation_id": "test_own_b",
                "entity_id": None,
                "curator_id": "bob@x.com",
                "curator": {"id": "bob@x.com", "name": "bob@x.com"},
                "restaurant_name": "Roubado pela Alice",
            }
        ]
    }
    r = client.post(
        "/api/v3/curations/bulk",
        json=payload,
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["updated"] == 0
    assert len(data["errors"]) == 1
    assert "ownership violation" in data["errors"][0]["error"]

    stored = test_db.curations.find_one({"_id": "test_own_b"})
    assert stored["restaurant_name"] == "Do Bob"  # nada foi sobrescrito
    assert stored["version"] == 3
    test_db.users.delete_one({"_id": "user-alice"})


def test_bulk_upsert_expected_version_conflict_reports_error():
    """CAS no bulk: payload com expected_version desatualizado NÃO sobrescreve
    (auditoria ago/2026: o update incrementava a versão sem exigir que a
    versão conhecida pelo cliente fosse a atual)."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    existing = {
        "_id": "cur_cas_1",
        "version": 5,
        "createdBy": "owner",
        "createdAt": "2026-01-01T00:00:00Z",
        "curator_id": "owner",
        "curator": {"id": "owner", "name": "owner"},
    }
    mock_db.curations.find.return_value = [existing]
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_cas_1",
        entity_id=None,
        curator_id="owner",
        curator=CuratorInfo(id="owner", name="owner"),
        restaurant_name="Sobrescrita por cliente velho",
        expected_version=3,  # cliente viu v3; servidor está em v5
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 0
    assert len(result.errors) == 1
    assert "version conflict" in result.errors[0].error
    mock_db.curations.update_one.assert_not_called()


def test_bulk_upsert_expected_version_match_updates():
    """CAS no bulk: versão batendo aplica o update normalmente."""
    from unittest.mock import MagicMock
    from app.api.curations import bulk_upsert_curations
    from app.models.schemas import BulkCurationCreate, CurationCreate, CuratorInfo

    mock_db = MagicMock()
    mock_auth = {"role": "admin", "user": "test@test.com"}

    existing = {
        "_id": "cur_cas_2",
        "version": 5,
        "createdBy": "owner",
        "createdAt": "2026-01-01T00:00:00Z",
        "curator_id": "owner",
        "curator": {"id": "owner", "name": "owner"},
    }
    mock_db.curations.find.return_value = [existing]
    mock_db.entities.find.return_value = []

    curation = CurationCreate(
        curation_id="cur_cas_2",
        entity_id=None,
        curator_id="owner",
        curator=CuratorInfo(id="owner", name="owner"),
        restaurant_name="Atualização legítima",
        expected_version=5,
    )
    payload = BulkCurationCreate(curations=[curation])

    result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    assert result.updated == 1
    assert len(result.errors) == 0
    mock_db.curations.update_one.assert_called_once()


def test_filter_by_entity_types_aplica_o_filtro():
    """entity_types era aceito mas NUNCA aplicado (auditoria ago/2026)."""
    from unittest.mock import MagicMock
    from app.api.curations import _filter_by_entity_types

    mock_db = MagicMock()
    mock_db.entities.find.return_value = [
        {"_id": "e1", "type": "restaurant"},
        {"_id": "e2", "type": "bar"},
        {"_id": "e3", "entity_id": "e3", "type": "restaurant"},
    ]

    curations = [
        {"entity_id": "e1"},
        {"entity_id": "e2"},
        {"entity_id": "e3"},
        {"entity_id": None},
    ]
    filtered = _filter_by_entity_types(mock_db, curations, ["restaurant"])
    assert [c.get("entity_id") for c in filtered] == ["e1", "e3"]


def test_semantic_response_expõe_modo_e_parcialidade():
    """A resposta informa search_mode/partial/candidate_count (contrato novo).
    Default = fallback exaustivo: partial=False — nenhuma curadoria elegível
    é omitida por janela de recência (Baseline 1, runbook §5)."""
    from app.models.schemas import SemanticSearchResponse

    r = SemanticSearchResponse(results=[], query="x", query_embedding_time=0.1, search_time=0.2, total_results=0)
    assert r.search_mode == "fallback_exhaustive"
    assert r.partial is False
    assert r.candidate_count == 0

    r2 = SemanticSearchResponse(
        results=[],
        query="x",
        query_embedding_time=0.1,
        search_time=0.2,
        total_results=0,
        search_mode="atlas_vector",
        partial=False,
        candidate_count=2000,
    )
    assert r2.partial is False


# ============================================================================
# Saved views (auditoria UX, ponto 20): build_search_query + params novos
# ============================================================================


def test_build_search_query_unlinked_com_pesquisa_textual():
    """unlinked=true com q: condição de órfã compõe por $and com o $or do
    texto (AND entre texto e vínculo) — nunca mistura as duas condições
    num $or único."""
    from app.api.curations import build_search_query

    query = build_search_query(unlinked=True, q="ritz")
    assert "$and" in query
    assert query["$and"][0]["$or"]  # grupo do texto
    assert query["$and"][1] == {"entity_id": {"$in": [None, ""]}}

    # sem q: condição direta no campo
    query2 = build_search_query(unlinked=True)
    assert query2["entity_id"] == {"$in": [None, ""]}
    assert "$and" not in query2


def test_build_search_query_created_after_e_invalidos():
    """created_after vira createdAt >= ISO; formato inválido → 400."""
    from fastapi import HTTPException
    from app.api.curations import build_search_query

    query = build_search_query(created_after="2026-08-14T00:00:00Z")
    assert "createdAt" in query
    assert query["createdAt"]["$gte"].isoformat().startswith("2026-08-14")

    with pytest.raises(HTTPException) as exc:
        build_search_query(created_after="ontem")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        build_search_query(since="não é data")
    assert exc.value.status_code == 400


def test_build_search_query_preserva_contrato_atual():
    """O refactor para função pura preserva: status default exclui deleted,
    entity_id/curator/city/type mapeiam como antes."""
    from app.api.curations import build_search_query

    q = build_search_query()
    assert q == {"status": {"$ne": "deleted"}}

    q2 = build_search_query(entity_id="e1", curator_id="c1", city="SP", type="restaurant", status="draft")
    assert q2 == {
        "entity_id": "e1",
        "curator.id": "c1",
        "city": "SP",
        "type": "restaurant",
        "status": "draft",
    }

    q3 = build_search_query(include_deleted=True)
    assert "status" not in q3


@pytest.mark.mongo
def test_search_unlinked_e_created_after_hermetico(client, test_db, clean_test_curations, auth_headers):
    """Saved views no banco hermético: unlinked retorna só órfãs;
    created_after corta por createdAt (janela de 24h do frontend)."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    old = (now - timedelta(days=7)).isoformat()
    test_db.curations.insert_many(
        [
            {
                "_id": "test_sv_linked",
                "curation_id": "test_sv_linked",
                "entity_id": "test_e_sv",
                "restaurant_name": "Linked Fresh",
                "status": "draft",
                "curator": {"id": "test_curator", "name": "Test"},
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "_id": "test_sv_orphan",
                "curation_id": "test_sv_orphan",
                "restaurant_name": "Orphan Fresh",
                "status": "draft",
                "curator": {"id": "test_curator", "name": "Test"},
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "_id": "test_sv_old",
                "curation_id": "test_sv_old",
                "entity_id": "test_e_sv",
                "restaurant_name": "Linked Old",
                "status": "draft",
                "curator": {"id": "test_curator", "name": "Test"},
                "createdAt": old,
                "updatedAt": old,
            },
        ]
    )

    r = client.get("/api/v3/curations/search?unlinked=true&limit=100", headers=auth_headers)
    assert r.status_code == 200
    ids = [i.get("curation_id") for i in r.json()["items"]]
    assert "test_sv_orphan" in ids
    assert "test_sv_linked" not in ids
    assert "test_sv_old" not in ids

    # janela: só o que foi criado depois do corte (fresh, não old).
    # Sufixo Z: "+00:00" no query string viraria espaço (URL encoding)
    cutoff = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    r2 = client.get(f"/api/v3/curations/search?created_after={cutoff}&limit=100", headers=auth_headers)
    assert r2.status_code == 200
    ids2 = [i.get("curation_id") for i in r2.json()["items"]]
    assert "test_sv_linked" in ids2 and "test_sv_orphan" in ids2
    assert "test_sv_old" not in ids2

    # combinação: órfã + janela
    r3 = client.get(
        f"/api/v3/curations/search?unlinked=true&created_after={cutoff}&limit=100",
        headers=auth_headers,
    )
    assert r3.status_code == 200
    ids3 = [i.get("curation_id") for i in r3.json()["items"]]
    assert ids3 == ["test_sv_orphan"] or "test_sv_orphan" in ids3 and "test_sv_linked" not in ids3

    # timestamp inválido → 400 (antes de tocar o banco)
    r4 = client.get("/api/v3/curations/search?created_after=ontem", headers=auth_headers)
    assert r4.status_code == 400

    test_db.curations.delete_many({"_id": {"$in": ["test_sv_linked", "test_sv_orphan", "test_sv_old"]}})
