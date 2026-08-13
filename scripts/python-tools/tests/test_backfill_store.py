"""
Testes do backfill_embeddings.py — gravação de embeddings com filtro de _id
tipado e checagem de matched_count, o filtro de seleção de curadorias
($or embeddings ausente/vazio + status != deleted) exercitado de verdade,
a construção de embeddings sem vetores vazios (Binary(b'') é lixo) e a
recusa de rodar sem MONGODB_URL no .env (valor obsoleto do shell não vale).
"""
import os

import pytest
from bson import Binary, ObjectId

import backfill_embeddings
from backfill_embeddings import CURATIONS_FILTRO, store_embeddings
from tests.fakes import FakeCollection, FakeDB


def _db_with_curation(curation_id):
    return FakeDB({"curations": FakeCollection([{"_id": curation_id}])})


def test_store_embeddings_filters_by_actual_id_object():
    """ObjectId no _id: o filtro deve usar o valor real, não str(ObjectId)."""
    oid = ObjectId()
    db = _db_with_curation(oid)
    ok, matched = store_embeddings(db, oid, [], {})
    assert ok
    assert matched == 1
    assert db["curations"].last_update_filter == {"_id": oid}


def test_store_embeddings_string_id_never_matches_objectid_doc():
    """O bug antigo: str(ObjectId) passava no filtro e casava 0 docs em silêncio."""
    oid = ObjectId()
    db = _db_with_curation(oid)
    ok, matched = store_embeddings(db, str(oid), [], {})
    assert not ok
    assert matched == 0


def test_store_embeddings_reports_matched_count_zero_as_failure():
    """Curadoria sumiu entre a listagem e o update → falha visível, não 'ok'."""
    db = _db_with_curation("outro-id")
    ok, matched = store_embeddings(db, "cid-ausente-no-banco", [], {})
    assert not ok
    assert matched == 0


def test_store_embeddings_applies_the_set():
    """O $set é aplicado de verdade nos docs casados (fake realista) e
    ATUALIZA updatedAt — os gates de frescor do rebuild dependem disso."""
    oid = ObjectId()
    db = _db_with_curation(oid)
    emb = [{"text": "t", "vector": b"\x00"}]
    ok, _ = store_embeddings(db, oid, emb, {"model": "m"})
    assert ok
    assert db["curations"].docs[0]["embeddings"] == emb
    assert db["curations"].docs[0]["embeddings_metadata"] == {"model": "m"}
    assert "updatedAt" in db["curations"].docs[0]


def test_curations_filtro_selects_only_missing_or_empty_embeddings():
    """Regressão no filtro de seleção (ex.: perder o $ne de deleted) quebraria
    o backfill em produção — o fake aplica o filtro de verdade."""
    docs = [
        {"_id": "sem-embeddings", "status": "active"},
        {"_id": "embeddings-vazio", "status": "active", "embeddings": []},
        {"_id": "ja-tem", "status": "active", "embeddings": [{"text": "x"}]},
        {"_id": "deletada", "status": "deleted"},
    ]
    coll = FakeCollection(docs)
    selecionadas = {d["_id"] for d in coll.find(CURATIONS_FILTRO)}
    assert selecionadas == {"sem-embeddings", "embeddings-vazio"}


def test_build_embeddings_skips_empty_and_missing_vectors():
    """Vetor vazio NÃO pode virar Binary(b'') (lixo 0-dim) — política única."""
    embs, skipped = backfill_embeddings.build_embeddings(
        {"t": []}, [{"text": "t", "category": "c", "concept": "x"}]
    )
    assert embs == []
    assert skipped == 1


def test_build_embeddings_packs_valid_vectors():
    embs, skipped = backfill_embeddings.build_embeddings(
        {"t": [1.0, 2.0]}, [{"text": "t", "category": "c", "concept": "x"}]
    )
    assert skipped == 0
    assert embs[0]["text"] == "t"
    assert isinstance(embs[0]["vector"], Binary)


def test_load_env_backfill_refuses_without_env_mongodb_url(tmp_path, monkeypatch):
    """always_env só protege se o .env CONTÉM a chave — sem ela, recusar em
    vez de herdar MONGODB_URL obsoleto do shell."""
    env_file = tmp_path / ".env"
    env_file.write_text("OPENAI_API_KEY=sk-x\n")
    monkeypatch.setenv("MONGODB_URL", "mongodb://stale-do-shell")
    with pytest.raises(ValueError, match="MONGODB_URL"):
        backfill_embeddings.load_env_backfill(env_file)


def test_load_env_backfill_refuses_without_env_mongodb_db_name(tmp_path, monkeypatch):
    """MONGODB_DB_NAME do shell (setdefault vence) retargetaria o banco do
    backfill — sem a chave no .env, recusar."""
    env_file = tmp_path / ".env"
    env_file.write_text("MONGODB_URL=mongodb://do-env\n")
    monkeypatch.setenv("MONGODB_DB_NAME", "scratch-do-shell")
    with pytest.raises(ValueError, match="MONGODB_DB_NAME"):
        backfill_embeddings.load_env_backfill(env_file)


def test_load_env_backfill_accepts_complete_env(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("MONGODB_URL=mongodb://do-env\nMONGODB_DB_NAME=concierge-collector\n")
    monkeypatch.setenv("MONGODB_URL", "mongodb://stale-do-shell")
    monkeypatch.setenv("MONGODB_DB_NAME", "scratch-do-shell")
    backfill_embeddings.load_env_backfill(env_file)  # não levanta
    assert os.environ["MONGODB_URL"] == "mongodb://do-env"
    assert os.environ["MONGODB_DB_NAME"] == "concierge-collector"
