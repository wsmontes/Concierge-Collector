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
    test_db.curations.insert_many([
        {"_id": "test_c_sp", "curation_id": "test_c_sp", "entity_id": "test_e1",
         "restaurant_name": "Pizzaria Napoli", "status": "draft", "city": "São Paulo", "type": "restaurant",
         "curator": {"id": "test_curator", "name": "Test"}},
        {"_id": "test_c_rio", "curation_id": "test_c_rio", "entity_id": "test_e2",
         "restaurant_name": "Bar do Rio", "status": "draft", "city": "Rio de Janeiro", "type": "bar",
         "curator": {"id": "test_curator", "name": "Test"}},
    ])
    r = client.get("/api/v3/curations/search?city=São Paulo&limit=100")
    ids = [i.get("curation_id") for i in r.json()["items"]]
    assert "test_c_sp" in ids and "test_c_rio" not in ids

    r2 = client.get("/api/v3/curations/search?q=napoli&limit=100")
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
    # Must contain denormalized fields
    assert set_doc.get("city") == "NYC"
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
