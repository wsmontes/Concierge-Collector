"""
Test curation endpoints
"""
import os
import pytest


@pytest.mark.mongo
class TestCurationEndpoints:
    """Test curation CRUD operations"""
    
    def test_search_curations_default(self, client):
        """Test searching curations with default params"""
        response = client.get("/api/v3/curations/search")
        
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
    
    def test_search_curations_with_limit(self, client):
        """Test searching curations with custom limit"""
        response = client.get("/api/v3/curations/search?limit=10")
        
        assert response.status_code == 200
        data = response.json()
        assert data["limit"] == 10
    
    def test_search_curations_filter_by_status(self, client):
        """Test filtering curations by status"""
        response = client.get("/api/v3/curations/search?status=draft")
        
        assert response.status_code == 200
        data = response.json()
        # All returned items should have pending status (if any)
        for item in data["items"]:
            if "status" in item:
                assert item["status"] == "draft"
    
    def test_search_curations_filter_by_curator(self, client):
        """Test filtering curations by curator"""
        response = client.get("/api/v3/curations/search?curator_id=test_curator")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["items"], list)
    
    def test_get_entity_curations(self, client):
        """Test getting curations for specific entity"""
        # Use first entity from list
        entities_response = client.get("/api/v3/entities?limit=1")
        entities = entities_response.json()["items"]
        
        if entities:
            # Try both _id and entity_id fields
            entity_id = entities[0].get("entity_id") or entities[0].get("_id")
            response = client.get(f"/api/v3/curations/entities/{entity_id}/curations")
            
            # May return 404 if entity not found by _id field
            assert response.status_code in [200, 404]
            
            if response.status_code == 200:
                data = response.json()
                assert isinstance(data, list)
    
    def test_create_curation_without_auth(self, client, sample_curation):
        """Test creating curation without authentication"""
        response = client.post("/api/v3/curations", json=sample_curation)
        
        assert response.status_code == 401
    
    def test_get_curation_not_found(self, client):
        """Test getting non-existent curation"""
        response = client.get("/api/v3/curations/nonexistent_id")
        
        assert response.status_code == 404
    
    def test_update_curation_without_auth(self, client):
        """Test updating curation without authentication"""
        response = client.patch(
            "/api/v3/curations/test_id",
            json={"status": "approved"}
        )
        
        assert response.status_code == 401
    
    def test_delete_curation_without_auth(self, client):
        """Test deleting curation without authentication"""
        response = client.delete("/api/v3/curations/test_id")

        # Should fail without auth
        assert response.status_code == 401

    def test_search_long_special_query_no_500(self, client):
        """200 chars ending in a regex-special char; must not 500 (invalid-regex bug)"""
        q = "a" * 199 + "."
        r = client.get("/api/v3/curations/search", params={"q": q, "limit": 5})
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
    
    def test_search_curations_invalid_status(self, client):
        """Test searching with invalid status"""
        response = client.get("/api/v3/curations/search?status=invalid_status")

        # Should either accept (empty results) or reject
        assert response.status_code in [200, 422]


def _api_headers():
    return {"X-API-Key": os.environ["API_SECRET_KEY"]}


@pytest.mark.mongo
def test_search_filters_by_city_and_text(client, test_db, clean_test_curations):
    # _ids com prefixo "0-" ordenam ANTES de todos os ids reais de produção
    # (curation-research-*) na busca por _id ascendente — sem isso, o volume
    # de curadorias reais (900+) empurra os docs de teste para fora da
    # primeira página (limit=100) e o assert falha por dado externo.
    test_db.curations.insert_many([
        {"_id": "0-test_c_sp", "curation_id": "0-test_c_sp", "entity_id": "test_e1",
         "restaurant_name": "Pizzaria Napoli", "status": "draft", "city": "São Paulo", "type": "restaurant",
         "curator": {"id": "test_curator", "name": "Test"}},
        {"_id": "0-test_c_rio", "curation_id": "0-test_c_rio", "entity_id": "test_e2",
         "restaurant_name": "Bar do Rio", "status": "draft", "city": "Rio de Janeiro", "type": "bar",
         "curator": {"id": "test_curator", "name": "Test"}},
    ])
    r = client.get("/api/v3/curations/search?city=São Paulo&limit=100")
    ids = [i.get("curation_id") for i in r.json()["items"]]
    assert "0-test_c_sp" in ids and "0-test_c_rio" not in ids

    r2 = client.get("/api/v3/curations/search?q=napoli&limit=100")
    ids2 = [i.get("curation_id") for i in r2.json()["items"]]
    assert "0-test_c_sp" in ids2 and "0-test_c_rio" not in ids2
    test_db.curations.delete_many({"_id": {"$in": ["0-test_c_sp", "0-test_c_rio"]}})


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

    # Simula: find_one retorna None (não existe), insert_one lança DuplicateKeyError
    mock_db.curations.find_one.return_value = None
    mock_db.curations.insert_one.side_effect = DuplicateKeyError("dup")

    mock_db.entities.find.return_value = []

    with patch("app.api.curations.denormalize_curation_location", return_value={"city": None, "type": None}):
        result = bulk_upsert_curations(request=MagicMock(), payload=payload, db=mock_db, auth=mock_auth)

    # Deve ter chamado update_one (não só incrementar counter)
    mock_db.curations.update_one.assert_called()
    # $set não deve conter createdAt (preservar o original)
    call_args, call_kwargs = mock_db.curations.update_one.call_args
    set_doc = call_kwargs["$set"] if "$set" in call_kwargs else call_args[1]["$set"]
    assert "createdAt" not in set_doc, "createdAt must not be in $set (preserve original)"
    assert "_id" not in set_doc, "_id must not be in $set"
    # identidade/entidade do vencedor nunca são sobrescritas na corrida
    for field in ("createdBy", "curator", "curator_id", "updatedBy",
                  "entity_id", "city", "type", "version"):
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

    mock_db.curations.find_one.return_value = None
    mock_db.curations.insert_one.side_effect = DuplicateKeyError("dup")
    # Provide a matching entity so denormalization runs
    mock_db.entities.find.return_value = [
        {"_id": "ent_002", "type": "restaurant", "data": {"location": {"city": "NYC"}}}
    ]

    with patch("app.api.curations.denormalize_curation_location", return_value={"city": "NYC", "type": "restaurant"}) as mock_denorm:
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

    mock_db.curations.find_one.return_value = None
    mock_db.curations.insert_one.side_effect = DuplicateKeyError("dup")
    mock_db.curations.update_one.side_effect = RuntimeError("connection lost")
    mock_db.entities.find.return_value = []

    with patch("app.api.curations.denormalize_curation_location", return_value={"city": None, "type": None}):
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
    mock_db.curations.find_one.return_value = existing
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
    mock_db.curations.find_one.return_value = existing
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
    mock_db.curations.find_one.return_value = existing
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
    mock_db.curations.find_one.return_value = existing
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
    stored = {"curator_id": "real-9",
              "curator": {"id": "real-9", "name": "Real", "email": "r@x.com"}}

    _repair_curator_identity(update_data, stored)

    assert update_data["curator_id"] == "real-9"
    assert update_data["curator"]["id"] == "real-9", "id embutido vazio envenena a busca por curator.id"
    assert update_data["curator"]["name"] == "x"


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

    winner = {"_id": "cur_test_004", "version": 5,
              "curator_id": "winner-1", "curator": {"id": "winner-1", "name": "Winner"}}
    # probes do loop principal (_id string, curation_id) → None;
    # probe do recovery do vencedor → winner
    mock_db.curations.find_one.side_effect = [None, None, winner]
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

    for forbidden in ("_id", "createdAt", "createdBy", "curator", "curator_id",
                      "updatedBy", "entity_id", "city", "type", "version"):
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

    winner = {"_id": "cur_test_005", "version": 2,
              "curator_id": "unknown", "curator": {"id": "unknown", "name": "unknown"}}
    mock_db.curations.find_one.side_effect = [None, None, winner]
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

    mock_db.curations.find_one.return_value = None
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
    entity_doc = {"_id": "507f1f77bcf86cd799439011", "entity_id": "slug-x",
                  "type": "restaurant", "data": {"location": {"city": "NYC"}}}
    mock_db.entities.find.return_value = [entity_doc]
    # probes do find_curation (_id string, campo curation_id) → não existe
    mock_db.curations.find_one.side_effect = [None, None]

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
            request=MagicMock(), payload=payload, db=mock_db,
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

    mock_db.curations.find_one.side_effect = boom
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
    mock_db.curations.find_one.return_value = existing
    entity_doc = {"_id": "ent_021", "type": "bar",
                  "data": {"location": {"city": "Rio de Janeiro"}}}
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


@pytest.mark.parametrize("location", [
    ".*",
    "São Paulo (Centro) $$$",
])
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

        request = HybridSearchRequest(query="pizza", location=location)

        with patch("app.api.curations.OpenAI") as mock_openai:
            mock_client = MagicMock()
            mock_emb = MagicMock()
            mock_emb.data = [MagicMock(embedding=[0.1] * 1536)]
            mock_client.embeddings.create.return_value = mock_emb
            mock_openai.return_value = mock_client

            with patch("app.api.curations.np.linalg.norm", return_value=1.0):
                with patch("app.api.curations.np.asarray",
                           return_value=np.array([0.1] * 1536)):
                    response = hybrid_search(request, mock_db)

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
                assert regex_condition["$regex"] == expected, (
                    f"Expected escaped regex {expected!r}, got: {regex_condition['$regex']!r}"
                )
    finally:
        if old_key is None:
            del os.environ["OPENAI_API_KEY"]
        else:
            os.environ["OPENAI_API_KEY"] = old_key


def test_create_curation_denormalizes_city_type(client, test_db, clean_test_entities, clean_test_curations):
    test_db.entities.insert_one({
        "_id": "test_ent_denorm", "entity_id": "test_ent_denorm", "name": "T", "type": "bar",
        "data": {"location": {"city": "São Paulo"}},
    })
    payload = {
        "curation_id": "test_cur_denorm", "entity_id": "test_ent_denorm",
        "curator_id": "test_curator", "curator": {"id": "test_curator", "name": "Test"},
        "categories": {"cuisine": ["bar"]},
        "status": "draft",
    }
    resp = client.post("/api/v3/curations", json=payload, headers=_api_headers())
    assert resp.status_code == 201, resp.text
    doc = test_db.curations.find_one({"_id": "test_cur_denorm"})
    assert doc["city"] == "São Paulo"
    assert doc["type"] == "bar"
    test_db.curations.delete_one({"_id": "test_cur_denorm"})
