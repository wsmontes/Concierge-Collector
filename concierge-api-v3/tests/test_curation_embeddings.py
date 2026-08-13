"""
Testes unitários de embeddings nas curadorias:
- compactação na fronteira de escrita (PATCH armazena Binary float32);
- fallback explícito (com log) do semantic/hybrid search quando o índice
  vector do Atlas não está disponível (incidente da cota 2026-08-12).
Sem MongoDB — db mockado (padrão do test_curations.py).
"""
import struct
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from bson import Binary

from app.api import curations as mod
from app.api.curations import (
    _compact_embeddings_for_storage,
    semantic_search_curations,
    update_curation,
)
from app.core.vector_packing import pack_vector
from app.models.schemas import CurationUpdate, SemanticSearchRequest


V1536 = [float(i % 7) / 7.0 for i in range(1536)]  # vetor de dim correta


class IterList:
    """Iterável simples para resultados de find() — list(), .limit() e .sort()
    usáveis. sort() REGISTRA a chamada (os testes pregam a ordenação por
    recência do fallback — sem isso a suíte seria tautológica)."""

    def __init__(self, items):
        self.items = items
        self.sorted_by = []

    def __iter__(self):
        return iter(self.items)

    def sort(self, *args, **kwargs):
        self.sorted_by.append(args)
        return self

    def limit(self, n=None):
        return self.items[:n] if n is not None else self.items


def _curation_doc(entity_id="e1"):
    return {
        "_id": "c1",
        "curation_id": "c1",
        "entity_id": entity_id,
        "categories": {},
        "curator": {"id": "u1", "name": "Teste", "email": None},
        "notes": None,
        "status": "active",
        "restaurant_name": None,
        "createdAt": datetime.now(timezone.utc),
        "updatedAt": datetime.now(timezone.utc),
        "embeddings": [
            {
                "text": "cuisine japonesa",
                "category": "cuisine",
                "concept": "japonesa",
                "vector": V1536,
            }
        ],
    }


def _patch_openai(monkeypatch):
    """Faz OpenAI() retornar um client fake com embedding [0.5, 0.5] e
    configura um índice vector que NÃO existe mais (cenário do incidente:
    env var no Render apontando para índice removido do Atlas)."""
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("MONGODB_CURATIONS_VECTOR_INDEX", "curations_embeddings_vector")
    fake_client = MagicMock()
    fake_client.embeddings.create.return_value = SimpleNamespace(
        data=[SimpleNamespace(embedding=V1536)]
    )
    monkeypatch.setattr(mod, "OpenAI", lambda **kw: fake_client)
    return fake_client


# ── Compactação na fronteira de escrita ────────────────────────────────

def test_compact_embeddings_packs_list_vectors():
    embs = [
        {
            "text": "cuisine japonesa",
            "category": "cuisine",
            "concept": "japonesa",
            "vector": V1536,
        }
    ]
    out = _compact_embeddings_for_storage(embs)
    v = out[0]["vector"]
    assert isinstance(v, Binary)
    assert struct.unpack("<1536f", v)[:4] == tuple(struct.unpack("<f", struct.pack("<f", x))[0] for x in V1536[:4])


def test_compact_embeddings_keeps_text_only_entries_and_binary():
    packed = Binary(struct.pack("<2f", 1.0, 2.0))
    embs = [
        {"text": "sem vetor"},
        {"text": "com vetor", "vector": packed},
        {"text": "vetor nulo", "vector": None},
    ]
    out = _compact_embeddings_for_storage(embs)
    assert out[0] == {"text": "sem vetor"}
    assert out[1]["vector"] is packed
    # vetor nulo: ENTRADA removida — se ficasse só com texto, o filtro de
    # backfill ($or: embeddings ausente ou []) nunca a re-selecionaria
    assert len(out) == 2


def test_compact_embeddings_does_not_pack_empty_vector():
    """vector: [] não pode virar Binary(b'') (0 dims, lixo persistido) nem
    re-entrar como lista de doubles (o formato que estourou a cota)."""
    embs = [{"text": "vazio", "vector": []}]
    out = _compact_embeddings_for_storage(embs)
    assert out == []


def test_compact_embeddings_strips_out_of_range_vector():
    """Float >3.4e38 estoura float32 (OverflowError) — entrada removida com
    warning, nunca persistida no formato caro."""
    embs = [{"text": "gigante", "vector": [1e300]}]
    out = _compact_embeddings_for_storage(embs)
    assert out == []


def test_compact_embeddings_uses_shared_pack_vector():
    """O formato tem implementação única (app/core/vector_packing) — a saída
    da API bate byte a byte com a função compartilhada."""
    vals = V1536
    out = _compact_embeddings_for_storage([{"text": "t", "vector": vals}])
    assert out[0]["vector"] == pack_vector(vals)


def test_compact_embeddings_strips_dict_vector_with_warning(caplog):
    """dict de vetor (JSON legal no schema) não vira Binary de lixo nem 500:
    entrada removida com warning — o formato caro nunca re-entra no Mongo."""
    embs = [{"text": "t", "vector": {"0": 0.31, "1": -0.2}}]
    out = _compact_embeddings_for_storage(embs)
    assert out == []
    assert any("sem compactar" in r.getMessage() for r in caplog.records)


def test_compact_embeddings_strips_ndarray_vector():
    """ndarray não é list/tuple — entrada removida, sem ValueError de truthiness."""
    import numpy as np

    embs = [{"text": "t", "vector": np.array(V1536)}]
    out = _compact_embeddings_for_storage(embs)
    assert out == []


def test_compact_embeddings_rejects_wrong_dimension():
    """Vetor de dimensão ≠ 1536 morreria no np.dot na hora da busca — a
    fronteira de escrita rejeita antes."""
    embs = [{"text": "t", "vector": [0.1] * 100}]
    out = _compact_embeddings_for_storage(embs)
    assert out == []


def test_vector_to_array_reads_little_endian_explicitly():
    """np.frombuffer com dtype nativo trocaria bytes em host big-endian —
    o formato é little-endian explícito ('<f4')."""
    import struct as st

    from app.api.curations import _vector_to_array

    raw = st.pack("<2f", 1.0, 2.0)
    arr = _vector_to_array(raw)
    assert arr.tolist() == [1.0, 2.0]
    assert arr.dtype.byteorder in ("<", "=")


def test_update_curation_compacts_embeddings_on_write():
    db = MagicMock()
    db.curations.find_one.return_value = _curation_doc()
    db.curations.find_one_and_update.return_value = dict(_curation_doc())
    updates = CurationUpdate(
        embeddings=[
            {"text": "t", "category": "c", "concept": "x", "vector": V1536}
        ]
    )
    update_curation("c1", updates, if_match=None, db=db, auth={})
    stored = db.curations.find_one_and_update.call_args.args[1]["$set"][
        "embeddings"
    ][0]["vector"]
    assert isinstance(stored, Binary)
    assert struct.unpack("<1536f", stored)[:4] == tuple(struct.unpack("<f", struct.pack("<f", x))[0] for x in V1536[:4])


# ── Fallback do vector search com log ──────────────────────────────────

def test_semantic_search_falls_back_with_warning(caplog, monkeypatch):
    _patch_openai(monkeypatch)
    db = MagicMock()
    db.curations.aggregate.side_effect = Exception(
        "index not found: curations_embeddings_vector"
    )
    # fallback faz list(find(...).sort().limit()) — IterList registra o sort
    curation_find = IterList([_curation_doc()])
    db.curations.find.return_value = curation_find
    db.entities.find.return_value = IterList([])

    response = semantic_search_curations(
        request=SemanticSearchRequest(query="japonesa"), db=db
    )
    assert response.total_results >= 1
    assert any("vectorSearch" in r.getMessage() for r in caplog.records)
    # o viés de recência do fallback faz parte do contrato — remover o sort
    # deve quebrar o teste, não passar idêntico
    assert curation_find.sorted_by == [("updatedAt", -1)]


def test_hybrid_search_falls_back_with_warning(caplog, monkeypatch):
    _patch_openai(monkeypatch)
    db = MagicMock()
    db.curations.aggregate.side_effect = Exception(
        "index not found: curations_embeddings_vector"
    )
    curation_find = IterList([_curation_doc()])
    db.curations.find.return_value = curation_find
    entity_doc = {"_id": "e1", "name": "Restaurante Teste"}

    def fake_find(*args, **kw):
        # 1ª chamada: busca textual de entities (chamada encadeada .limit);
        # 2ª chamada: batch dos entity_ids ausentes (list() direto).
        if "$text" in args[0]:
            m = MagicMock()
            m.limit.return_value = []
            return m
        return [entity_doc]

    db.entities.find.side_effect = fake_find

    from app.models.schemas import HybridSearchRequest

    response = mod.hybrid_search(
        request=HybridSearchRequest(query="japonesa"), db=db
    )
    assert response.total_results >= 1
    assert any("vectorSearch" in r.getMessage() for r in caplog.records)
    assert curation_find.sorted_by == [("updatedAt", -1)]
