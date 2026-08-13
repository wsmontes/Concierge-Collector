"""
Testes do db_rebuild.py (export/verify/wipe/restore do MongoDB).
Cobre: stream BSON estrito, export atômico com manifest, verify guiado pelo
dump com decodificação completa (gate pré-wipe), restore com confirmação,
pré-validação antes de dropar, lotes por bytes (limite de 48MB do servidor),
dedupe de chaves únicas e criação de índices tolerante a falhas individuais.
"""
import os
import struct
from datetime import datetime, timedelta, timezone

import pytest
from bson import Binary
from pymongo.errors import PyMongoError

import db_rebuild
from db_rebuild import (
    compact_doc,
    dedupe_entities,
    ensure_indexes,
    export_dump,
    insert_in_byte_batches,
    read_bson_stream,
    read_manifest,
    restore_dump,
    verify_dump,
    wipe_db,
    write_bson_stream,
)
from tests.fakes import FakeClient, FakeCollection, FakeDB


V1536 = [float(i % 7) / 7.0 for i in range(1536)]  # vetor de dim correta


def _write_dump(dump_dir, coll, docs):
    write_bson_stream(os.path.join(str(dump_dir), f"{coll}.bson"), iter(docs))


def _export_from(dump_dir, colls):
    """Exporta um banco fake para o dump dir e retorna o manifest."""
    return export_dump(FakeClient(), FakeDB(colls), str(dump_dir))


def _manifest_colls(manifest):
    return set(manifest["collections"])


# ── Stream BSON ────────────────────────────────────────────────────────────

def test_write_bson_stream_roundtrip_returns_count(tmp_path):
    docs = [{"_id": 1, "x": "a"}, {"_id": 2, "x": "b"}]
    path = tmp_path / "c.bson"
    n = write_bson_stream(str(path), iter(docs))
    assert n == 2
    assert [d for d in read_bson_stream(str(path))] == docs


def test_write_bson_stream_keeps_previous_file_when_iterator_fails(tmp_path):
    path = tmp_path / "c.bson"
    write_bson_stream(str(path), iter([{"_id": 1}]))
    before = path.read_bytes()

    def bad_iter():
        yield {"_id": 2}
        raise RuntimeError("falha simulada no meio do export")

    with pytest.raises(RuntimeError):
        write_bson_stream(str(path), bad_iter())
    assert path.read_bytes() == before
    assert not list(tmp_path.glob("*.tmp"))


def test_read_bson_stream_raises_with_filename_on_truncation(tmp_path):
    path = tmp_path / "t.bson"
    write_bson_stream(str(path), iter([{"_id": 1}]))
    path.write_bytes(path.read_bytes()[:-3])
    with pytest.raises(ValueError, match="t.bson"):
        list(read_bson_stream(str(path)))


def test_read_bson_stream_raises_on_truncated_header(tmp_path):
    path = tmp_path / "t.bson"
    path.write_bytes(b"\x05\x00")
    with pytest.raises(ValueError, match="t.bson"):
        list(read_bson_stream(str(path)))


# ── Compactação de vetores ─────────────────────────────────────────────────

def test_compact_doc_packs_vector_list_to_binary():
    doc = {"_id": "c1", "embeddings": [{"text": "t", "vector": V1536}]}
    out, skipped = compact_doc(doc)
    v = out["embeddings"][0]["vector"]
    assert isinstance(v, Binary)
    assert struct.unpack("<1536f", v)[:4] == tuple(struct.unpack("<f", struct.pack("<f", x))[0] for x in V1536[:4])
    assert skipped == 0


def test_compact_doc_keeps_text_only_entry_without_crashing():
    doc = {
        "_id": "c1",
        "embeddings": [{"text": "x", "category": "y"}, {"text": "z", "vector": None}],
    }
    out, skipped = compact_doc(doc)
    # drop parcial: a entrada sem 'vector' fica; a com vector None sai
    assert out["embeddings"] == [{"text": "x", "category": "y"}]
    assert skipped == 1


def test_compact_doc_packs_top_level_vector_legacy_embeddings():
    doc = {"_id": "e1", "entity_id": "x", "vector": V1536}
    out, skipped = compact_doc(doc)
    assert isinstance(out["vector"], Binary)
    assert struct.unpack("<1536f", out["vector"])[:4] == tuple(struct.unpack("<f", struct.pack("<f", x))[0] for x in V1536[:4])
    assert skipped == 0


def test_compact_doc_passes_through_existing_binary():
    packed = Binary(struct.pack("<2f", 1.0, 2.0))
    doc = {"_id": "c1", "embeddings": [{"vector": packed}]}
    out, skipped = compact_doc(doc)
    assert out["embeddings"][0]["vector"] is packed
    assert skipped == 0


def test_compact_doc_skips_out_of_range_vector():
    """Float >3.4e38 estoura float32 (OverflowError) — entrada REMOVIDA por
    inteiro (nunca re-entra no formato caro, e o backfill consegue re-selecionar
    a curadoria depois)."""
    doc = {"_id": "c1", "embeddings": [{"text": "t", "vector": [1e300]}]}
    out, skipped = compact_doc(doc)
    assert out["embeddings"] == []
    assert skipped == 1


# ── Export + manifest ──────────────────────────────────────────────────────

def test_export_writes_manifest_with_counts_and_bytes(tmp_path):
    db = FakeDB({"entities": FakeCollection([{"_id": 1}, {"_id": 2}])})
    manifest = export_dump(FakeClient(), db, str(tmp_path))
    assert manifest["collections"]["entities"]["count"] == 2
    assert manifest["collections"]["entities"]["bytes"] == (tmp_path / "entities.bson").stat().st_size
    assert "created_at" in manifest and "cluster" in manifest
    assert read_manifest(str(tmp_path)) == manifest


def test_export_finds_with_batch_size_1000(tmp_path):
    coll = FakeCollection([{"_id": i} for i in range(3)])
    export_dump(FakeClient(), FakeDB({"entities": coll}), str(tmp_path))
    assert coll.find_kwargs.get("batch_size") == 1000


def test_export_manifest_max_never_newer_than_streamed_content(tmp_path):
    """TOCTOU: se um PATCH acontece durante o export, o manifest NÃO pode
    gravar um max_updated_at mais novo que o conteúdo do dump (isso faria os
    gates de frescor aprovarem conteúdo obsoleto). O max é lido ANTES do
    stream — um PATCH concorrente deixa o manifest conservador (mais velho)."""
    t1 = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 8, 12, tzinfo=timezone.utc)
    coll = FakeCollection([{"_id": 1, "updatedAt": t1}])

    def write_during_export():
        # simula PATCH concorrente que chega DEPOIS do stream
        coll.docs.append({"_id": 2, "updatedAt": t2})

    coll.find_one_side_effect = write_during_export
    export_dump(FakeClient(), FakeDB({"entities": coll}), str(tmp_path))
    dumped = list(read_bson_stream(str(tmp_path / "entities.bson")))
    dumped_max = max(db_rebuild._epoch(d["updatedAt"]) for d in dumped)
    manifest_max = db_rebuild._epoch(
        read_manifest(str(tmp_path))["collections"]["entities"]["max_updated_at"]
    )
    assert manifest_max <= dumped_max


# ── Verify ─────────────────────────────────────────────────────────────────

def test_verify_ok_when_manifest_and_live_match(tmp_path):
    db = FakeDB({"entities": FakeCollection([{"_id": 1}, {"_id": 2}])})
    export_dump(FakeClient(), db, str(tmp_path))
    assert verify_dump(db, str(tmp_path))


def test_verify_diverges_when_live_has_more_docs_than_dump(tmp_path):
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    db["entities"].docs.append({"_id": 2})
    assert not verify_dump(db, str(tmp_path))


def test_verify_passes_when_dump_is_superset_of_live(tmp_path):
    """live < dump (TTL expirou docs, pós-wipe) = dump ainda é backup completo
    de live — seguro para wipe. O contrário (live > dump) é DIVERGE."""
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    db["entities"].docs.clear()
    assert verify_dump(db, str(tmp_path))


def test_verify_detects_truncated_dump_file(tmp_path):
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    path = tmp_path / "entities.bson"
    path.write_bytes(path.read_bytes()[:-2])
    assert not verify_dump(db, str(tmp_path))


def test_verify_detects_same_size_corruption(tmp_path):
    """Bit rot sem mudar o tamanho: só a decodificação completa detecta."""
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    path = tmp_path / "entities.bson"
    data = bytearray(path.read_bytes())
    mid = len(data) // 2
    data[mid] ^= 0xFF
    path.write_bytes(bytes(data))
    assert not verify_dump(db, str(tmp_path))


def test_verify_flags_live_collection_missing_from_dump(tmp_path):
    """Coleção criada após o export não pode passar batida pelo verify."""
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    db.colls["audit_log"] = FakeCollection([{"_id": 1}])
    assert not verify_dump(db, str(tmp_path))


def test_verify_fails_when_dump_has_no_manifest(tmp_path):
    _write_dump(tmp_path, "entities", [{"_id": 1}])
    assert not verify_dump(FakeDB({"entities": FakeCollection([{"_id": 1}])}), str(tmp_path))


def test_verify_fails_when_dump_file_missing(tmp_path):
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    os.remove(tmp_path / "entities.bson")
    assert not verify_dump(db, str(tmp_path))


def test_verify_tolerates_naive_manifest_created_at(tmp_path):
    """created_at sem tz (hand-editado/escritor antigo) não derruba o verify."""
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    manifest = read_manifest(str(tmp_path))
    manifest["created_at"] = "2026-08-12T21:00:00"  # naive
    db_rebuild.write_manifest(str(tmp_path), manifest)
    assert verify_dump(db, str(tmp_path))


# ── Restore ────────────────────────────────────────────────────────────────

def test_restore_refuses_without_confirmation(tmp_path):
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    with pytest.raises(ValueError, match="--yes"):
        restore_dump(FakeDB({}), str(tmp_path), confirmed=False)


def test_restore_fails_without_manifest(tmp_path):
    _write_dump(tmp_path, "entities", [{"_id": 1}])
    with pytest.raises(ValueError, match="manifest"):
        restore_dump(FakeDB({}), str(tmp_path), confirmed=True)


def test_restore_prevalidates_before_dropping(tmp_path):
    """Arquivo corrompido é detectado ANTES de qualquer drop no alvo."""
    src = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), src, str(tmp_path))
    path = tmp_path / "entities.bson"
    path.write_bytes(path.read_bytes()[:-2])  # trunca (mesmo tamanho? não, menor)
    target = FakeDB({"entities": FakeCollection([{"_id": "vivo"}])})
    with pytest.raises(ValueError):
        restore_dump(target, str(tmp_path), confirmed=True)
    assert not target["entities"].dropped
    assert [d["_id"] for d in target["entities"].docs] == ["vivo"]


def test_restore_drops_before_insert_and_is_rerunnable(tmp_path):
    src = FakeDB(_full_colls(curations=FakeCollection([{"_id": "novo", "embeddings": []}])))
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB(_full_colls(curations=FakeCollection([{"_id": "velho"}])))
    counts, falhas = restore_dump(target, str(tmp_path), confirmed=True)
    assert counts["curations"] == 1
    assert not falhas
    assert [d["_id"] for d in target["curations"].docs] == ["novo"]
    counts, falhas = restore_dump(target, str(tmp_path), confirmed=True)
    assert [d["_id"] for d in target["curations"].docs] == ["novo"]


def _full_colls(**overrides):
    """Conjunto completo de coleções (fonte e alvo) — o restore exige que toda
    coleção viva do alvo esteja no manifest."""
    colls = {"curations": FakeCollection(), "entities": FakeCollection(),
             "capture_sessions": FakeCollection()}
    colls.update(overrides)
    return colls


def test_restore_refuses_when_live_is_newer_than_dump(tmp_path):
    """Writes aconteceram desde o export: restore recusa em vez de destruí-los."""
    src = FakeDB(_full_colls(curations=FakeCollection([{"_id": 1}])))
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB(_full_colls(curations=FakeCollection([{"_id": 1}, {"_id": 2}])))
    with pytest.raises(ValueError, match="dados novos"):
        restore_dump(target, str(tmp_path), confirmed=True)
    assert not target["curations"].dropped


def test_restore_refuses_when_manifest_database_differs(tmp_path):
    src = FakeDB(_full_colls(curations=FakeCollection([{"_id": 1}])))
    export_dump(FakeClient(), src, str(tmp_path))
    manifest = read_manifest(str(tmp_path))
    manifest["database"] = "outro-banco"
    db_rebuild.write_manifest(str(tmp_path), manifest)
    with pytest.raises(ValueError, match="banco"):
        restore_dump(FakeDB(_full_colls()), str(tmp_path), confirmed=True)


def test_restore_reports_failed_indexes(tmp_path):
    """Dados restaurados mas índices falhando NÃO podem sair como RESTORE OK."""
    src = FakeDB(_full_colls(entities=FakeCollection([{"_id": 1}])))
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB(_full_colls())
    target["entities"].fail_index_keys.add(("externalId", True, True, None))
    counts, falhas = restore_dump(target, str(tmp_path), confirmed=True)
    assert counts["entities"] == 1
    assert any("externalId" in f[0] for f in falhas)


def test_restore_compacts_vectors_on_insert(tmp_path):
    src = FakeDB(_full_colls(curations=FakeCollection(
        [{"_id": "c1", "embeddings": [{"text": "t", "vector": V1536}]}])))
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB(_full_colls())
    restore_dump(target, str(tmp_path), confirmed=True)
    v = target["curations"].docs[0]["embeddings"][0]["vector"]
    # Binary subtype 0 volta do BSON como bytes puros (como no pymongo real)
    assert isinstance(v, bytes)
    assert struct.unpack("<1536f", v)[:4] == tuple(struct.unpack("<f", struct.pack("<f", x))[0] for x in V1536[:4])


def test_restore_ignores_bson_files_not_in_manifest(tmp_path):
    """Stale .bson de export antigo não é ressuscitado."""
    src = FakeDB(_full_colls(entities=FakeCollection([{"_id": 1}])))
    export_dump(FakeClient(), src, str(tmp_path))
    _write_dump(tmp_path, "colecao_antiga", [{"_id": "zumbi"}])
    target = FakeDB(_full_colls())
    restore_dump(target, str(tmp_path), confirmed=True)
    assert "colecao_antiga" not in target.colls


def test_restore_dedupes_entities_on_unique_keys(tmp_path):
    """Duplicatas do incidente são removidas — índices únicos voltam a existir."""
    t1 = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 8, 10, tzinfo=timezone.utc)
    src = FakeDB(_full_colls(entities=FakeCollection([
        {"_id": "e1", "externalId": "X", "updatedAt": t1},
        {"_id": "e2", "externalId": "X", "updatedAt": t2},  # duplicata
        {"_id": "e3", "externalId": "Y", "updatedAt": t1},
    ])))
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB(_full_colls())
    counts, _ = restore_dump(target, str(tmp_path), confirmed=True)
    ids = {d["_id"] for d in target["entities"].docs}
    assert ids == {"e2", "e3"}  # e1 removido (e2 mais recente)
    assert counts["entities"] == 2  # contagem INSERIDA (pós-dedupe), não a do dump


def test_restore_recreates_indexes_after_insert(tmp_path):
    src = FakeDB(_full_colls(entities=FakeCollection([{"_id": 1}])))
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB(_full_colls())
    restore_dump(target, str(tmp_path), confirmed=True)
    assert len(target["entities"].created_indexes) >= 9
    assert len(target["curations"].created_indexes) >= 8


def test_insert_in_byte_batches_respects_byte_limit():
    coll = FakeCollection()
    docs = [{"_id": i, "payload": "x" * 40} for i in range(5)]  # ~50B cada
    insert_in_byte_batches(coll, docs, max_bytes=100)
    assert all(size <= 100 for size in coll.insert_sizes)
    assert sum(coll.insert_sizes) == 5


def test_insert_in_byte_batches_single_oversized_doc_goes_alone():
    coll = FakeCollection()
    docs = [{"_id": 1, "payload": "x" * 300}, {"_id": 2}]
    insert_in_byte_batches(coll, docs, max_bytes=100)
    assert coll.insert_sizes == [1, 1]


def test_insert_in_byte_batches_inserts_raw_docs_without_reencode():
    """Cada doc é codificado UMA vez e enviado como RawBSONDocument."""
    from bson.raw_bson import RawBSONDocument

    coll = FakeCollection()
    insert_in_byte_batches(coll, [{"_id": 1, "payload": "x" * 40}], max_bytes=10_000_000)
    assert isinstance(coll.docs[0], RawBSONDocument)
    assert coll.docs[0]["_id"] == 1


# ── Índices ────────────────────────────────────────────────────────────────

def test_ensure_indexes_continues_after_unique_index_failure():
    ents = FakeCollection()
    ents.fail_index_keys.add(("externalId", True, True, None))
    db = FakeDB(
        {
            "entities": ents,
            "curations": FakeCollection(),
            "capture_sessions": FakeCollection(),
        }
    )
    results = ensure_indexes(db)
    failures = [r for r in results if not r[1]]
    assert failures and "externalId" in failures[0][0]
    assert len(ents.created_indexes) == 9
    assert len(db["curations"].created_indexes) == 10


def test_ensure_indexes_creates_capture_sessions_ttl():
    db = FakeDB(
        {
            "entities": FakeCollection(),
            "curations": FakeCollection(),
            "capture_sessions": FakeCollection(),
        }
    )
    results = ensure_indexes(db)
    ttl = [i for i in db["capture_sessions"].created_indexes if i[1].get("expireAfterSeconds") == 172800]
    assert ttl
    assert all(r[1] for r in results)


def test_dedupe_entities_keeps_newest_by_updated_at():
    t_old = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t_new = datetime(2026, 8, 10, tzinfo=timezone.utc)
    docs = [
        {"_id": "a", "externalId": "X", "updatedAt": t_old},
        {"_id": "b", "externalId": "X", "updatedAt": t_new},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert [d["_id"] for d in kept] == ["b"]
    assert [d["_id"] for d in removed] == ["a"]


def test_dedupe_entities_keeps_docs_without_unique_keys():
    docs = [{"_id": "a"}, {"_id": "b", "externalId": None}]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert len(kept) == 2 and not removed


def test_dedupe_entities_resolves_nested_data_place_id():
    """data.place_id vive DENTRO do dict 'data' — a chave pontuada no topo
    nunca resolve; o replay do dump real perdia o place_id de um doc removido."""
    t1 = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 8, 10, tzinfo=timezone.utc)
    docs = [
        {"_id": "a", "data": {"place_id": "P1"}, "updatedAt": t1},
        {"_id": "b", "data": {"place_id": "P1"}, "updatedAt": t2},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert [d["_id"] for d in kept] == ["b"]
    assert [d["_id"] for d in removed] == ["a"]


def test_dedupe_entities_orders_by_epoch_not_wall_clock_string():
    """'15:00+03:00' (12:00Z) é MAIS ANTIGO que '13:00Z' — ordenação lexicográfica
    de strings ISO manteria o doc errado."""
    stale = datetime(2026, 8, 12, 15, 0, tzinfo=timezone(timedelta(hours=3)))
    fresh = datetime(2026, 8, 12, 13, 0, tzinfo=timezone.utc)
    docs = [
        {"_id": "a", "externalId": "X", "updatedAt": stale},
        {"_id": "b", "externalId": "X", "updatedAt": fresh},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert [d["_id"] for d in kept] == ["b"]


# ── Gates fail-closed / identidade / frescor por updatedAt ─────────────────

def test_verify_fails_closed_on_connection_error(tmp_path):
    """Erro transitório de conexão NÃO pode virar 'live=0' e aprovar o wipe."""
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    db["entities"].count_error = PyMongoError("blip de rede (simulado)")
    assert not verify_dump(db, str(tmp_path))


def test_restore_fails_closed_on_connection_error(tmp_path):
    src = FakeDB(_full_colls(entities=FakeCollection([{"_id": 1}])))
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB(_full_colls())
    target["entities"].count_error = PyMongoError("blip de rede (simulado)")
    with pytest.raises(PyMongoError):
        restore_dump(target, str(tmp_path), confirmed=True)
    assert not target["entities"].dropped


def test_verify_refuses_wrong_database_identity(tmp_path):
    """wipe contra banco errado (MONGODB_URL do shell) não pode passar."""
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    manifest = read_manifest(str(tmp_path))
    manifest["database"] = "outro-banco"
    db_rebuild.write_manifest(str(tmp_path), manifest)
    assert not verify_dump(db, str(tmp_path))


def test_verify_detects_post_export_in_place_updates(tmp_path):
    """PATCH muda updatedAt sem mudar contagem — frescor por updatedAt pega."""
    t_export = datetime(2026, 8, 12, 10, 0, tzinfo=timezone.utc)
    db = FakeDB({"entities": FakeCollection([{"_id": 1, "updatedAt": t_export}])})
    export_dump(FakeClient(), db, str(tmp_path))
    db["entities"].docs[0]["updatedAt"] = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)
    assert not verify_dump(db, str(tmp_path))


def test_restore_refuses_post_export_in_place_updates(tmp_path):
    t_export = datetime(2026, 8, 12, 10, 0, tzinfo=timezone.utc)
    src = FakeDB(_full_colls(entities=FakeCollection([{"_id": 1, "updatedAt": t_export}])))
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB(_full_colls(entities=FakeCollection(
        [{"_id": 1, "updatedAt": datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)}])))
    with pytest.raises(ValueError, match="obsoleto"):
        restore_dump(target, str(tmp_path), confirmed=True)
    assert not target["entities"].dropped


def test_restore_refuses_live_collection_not_in_manifest(tmp_path):
    """Mesmo invariante SEM DUMP do wipe — restore não mistura estados."""
    src = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB({"entities": FakeCollection(), "curations": FakeCollection(),
                     "capture_sessions": FakeCollection(), "audit_log": FakeCollection([{"_id": 1}])})
    with pytest.raises(ValueError, match="SEM DUMP|manifest"):
        restore_dump(target, str(tmp_path), confirmed=True)
    assert not target["entities"].dropped


# ── Dedupe avançado ────────────────────────────────────────────────────────

def test_dedupe_entities_keeps_carrier_by_unsetting_conflicting_key():
    """B (novo, externalId X) e A (velho, X + place_id P1): A sobrevive como
    único portador de P1, mas PERDE o externalId conflitante (unset) — os dois
    docs ficam e nenhuma chave única tem duplicata (índices únicos criáveis,
    nada descartado)."""
    t_old = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t_new = datetime(2026, 8, 10, tzinfo=timezone.utc)
    docs = [
        {"_id": "a", "externalId": "X", "data": {"place_id": "P1"}, "updatedAt": t_old},
        {"_id": "b", "externalId": "X", "updatedAt": t_new},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert {d["_id"] for d in kept} == {"a", "b"}
    assert not removed
    a = next(d for d in kept if d["_id"] == "a")
    assert "externalId" not in a  # chave conflitante removida (sparse ignora)
    assert a["data"]["place_id"] == "P1"


def test_dedupe_entities_result_has_no_duplicate_unique_keys():
    """Caso do review: A{X,P1,velho} + B{X,P2,novo} — a união por chave mantinha
    os dois com X duplicado e o índice único falhava. Com unset, X fica só em B
    e as duas chaves únicas ficam sem duplicata."""
    t_old = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t_new = datetime(2026, 8, 10, tzinfo=timezone.utc)
    docs = [
        {"_id": "a", "externalId": "X", "data": {"place_id": "P1"}, "updatedAt": t_old},
        {"_id": "b", "externalId": "X", "data": {"place_id": "P2"}, "updatedAt": t_new},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    external_ids = [d.get("externalId") for d in kept if d.get("externalId") is not None]
    place_ids = [
        db_rebuild._nested_get(d, "data.place_id")
        for d in kept
        if db_rebuild._nested_get(d, "data.place_id") is not None
    ]
    assert len(external_ids) == len(set(external_ids))
    assert len(place_ids) == len(set(place_ids))
    assert not removed


def test_dedupe_entities_collapses_real_empty_string_duplicates():
    """externalId='' é valor real para o índice — duas ocorrências colidem."""
    t1 = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 8, 10, tzinfo=timezone.utc)
    docs = [
        {"_id": "a", "externalId": "", "updatedAt": t1},
        {"_id": "b", "externalId": "", "updatedAt": t2},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert [d["_id"] for d in kept] == ["b"]


def test_dedupe_entities_unsets_explicit_null_unique_keys():
    """O índice unique SPARSE do Mongo INDEXA null explícito (o log do
    incidente mostra 'dup key: { externalId: null }') — 21k entities têm
    externalId: null. O dedupe precisa UNSETAR esses nulls, senão a criação
    do índice falha de novo no restore."""
    t = datetime(2026, 8, 10, tzinfo=timezone.utc)
    docs = [
        {"_id": "a", "externalId": None, "data": {"place_id": None}, "updatedAt": t},
        {"_id": "b", "externalId": None, "updatedAt": t},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert len(kept) == 2  # docs mantidos...
    for d in kept:
        assert "externalId" not in d  # ...mas null explícito removido (sparse ignora ausente)
        assert "place_id" not in d.get("data", {})
    assert not removed


def test_dedupe_entities_numeric_types_collide_by_value():
    """Mongo compara números POR VALOR no índice único: 1 == 1.0 == True."""
    t1 = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 8, 10, tzinfo=timezone.utc)
    docs = [
        {"_id": "a", "externalId": 1, "updatedAt": t1},
        {"_id": "b", "externalId": 1.0, "updatedAt": t2},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert [d["_id"] for d in kept] == ["b"]
    assert [d["_id"] for d in removed] == ["a"]


def test_dedupe_entities_nan_collides_with_nan():
    """NaN == NaN é True para a unicidade do Mongo — o dedupe precisa tratar."""
    t1 = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 8, 10, tzinfo=timezone.utc)
    nan = float("nan")
    docs = [
        {"_id": "a", "externalId": nan, "updatedAt": t1},
        {"_id": "b", "externalId": nan, "updatedAt": t2},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert [d["_id"] for d in kept] == ["b"]


def test_epoch_accepts_numeric_timestamps():
    """updatedAt numérico (epoch) é comum em pipelines bulk — o gate de
    frescor não pode tratá-lo como 0.0 (fail-open)."""
    assert db_rebuild._epoch(1755123456.78) == 1755123456.78
    # epoch em milissegundos (1.7e12) é normalizado
    assert db_rebuild._epoch(1755123456789) == pytest.approx(1755123456.789)


def test_read_bson_stream_rejects_negative_header(tmp_path):
    """Header int32 negativo não pode mandar f.read() ler o arquivo inteiro."""
    path = tmp_path / "t.bson"
    path.write_bytes(struct.pack("<i", -2147483648) + b"resto")
    with pytest.raises(ValueError, match="header"):
        list(read_bson_stream(str(path)))


def test_compact_doc_drops_unpackable_entries_entirely():
    """Entrada com vetor malformado é REMOVIDA; vetores VÁLIDOS são
    preservados (o restore não destrói o que está bom — o backfill cobre os
    textos dropados via embeddings_metadata.backfill_needed)."""
    doc = {"_id": "c1", "embeddings": [
        {"text": "valida", "vector": V1536},
        {"text": "lixo", "vector": {"0": 0.31}},
    ]}
    out, skipped = compact_doc(doc)
    assert len(out["embeddings"]) == 1
    assert out["embeddings"][0]["text"] == "valida"
    assert skipped == 1


def test_dedupe_entities_tolerates_unhashable_key_values():
    """externalId/place_id dict/list (lixo de import) não pode crashar o set."""
    t = datetime(2026, 8, 10, tzinfo=timezone.utc)
    docs = [
        {"_id": "a", "externalId": {"x": 1}, "updatedAt": t},
        {"_id": "b", "externalId": {"x": 1}, "updatedAt": t},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert len(kept) == 1 and len(removed) == 1


def test_dedupe_entities_iso_string_dates_sort_by_epoch():
    """updatedAt como string ISO não pode ser rebaixado a 'mais antigo'."""
    docs = [
        {"_id": "a", "externalId": "X", "updatedAt": "2026-08-12T10:00:00+00:00"},
        {"_id": "b", "externalId": "X",
         "updatedAt": datetime(2026, 8, 1, tzinfo=timezone.utc)},
    ]
    kept, removed, _rewrite = dedupe_entities(docs)
    assert [d["_id"] for d in kept] == ["a"]


def test_restore_rewrites_curation_entity_ids_after_dedupe(tmp_path):
    """Curation apontando para a entity duplicada removida é reescrita para a
    mantida — sem referência órfã pós-restore."""
    t_old = datetime(2026, 8, 1, tzinfo=timezone.utc)
    t_new = datetime(2026, 8, 10, tzinfo=timezone.utc)
    # dup clássico do incidente: mesmas DUAS chaves únicas — a antiga perde
    # ambas e é REMOVIDA (com unset-dedupe, uma chave divergente faria a
    # antiga sobreviver e a rewrite não seria necessária)
    src = FakeDB(_full_colls(
        entities=FakeCollection([
            {"_id": "e-velha", "externalId": "X", "data": {"place_id": "P1"}, "updatedAt": t_old},
            {"_id": "e-nova", "externalId": "X", "data": {"place_id": "P1"}, "updatedAt": t_new},
        ]),
        curations=FakeCollection([{"_id": "c1", "entity_id": "e-velha", "categories": {}}]),
    ))
    export_dump(FakeClient(), src, str(tmp_path))
    target = FakeDB(_full_colls())
    restore_dump(target, str(tmp_path), confirmed=True)
    assert target["curations"].docs[0]["entity_id"] == "e-nova"


def test_index_specs_are_the_shared_source():
    """Fonte única de specs de índice (app/core/index_specs.py) — sem cópia
    manual que possa derivar entre as árvores."""
    from app.core.index_specs import INDEX_SPECS as SHARED

    assert db_rebuild.INDEX_SPECS is SHARED
    assert len(SHARED) == 21
    assert sum(1 for s in SHARED if s[0] == "capture_sessions") == 1


# ── Wipe ───────────────────────────────────────────────────────────────────

def test_wipe_db_refuses_without_confirmation(tmp_path):
    with pytest.raises(ValueError, match="--yes"):
        wipe_db(FakeClient(), FakeDB({"entities": FakeCollection([{"_id": 1}])}),
                str(tmp_path), confirmed=False)


def test_wipe_db_requires_verify_pass(tmp_path):
    """Sem manifest (dump sem export) o wipe recusa mesmo com --yes."""
    with pytest.raises(ValueError, match="VERIFY"):
        wipe_db(FakeClient(), FakeDB({"entities": FakeCollection([{"_id": 1}])}),
                str(tmp_path), confirmed=True)


def test_wipe_db_drops_all_collections_when_verified(tmp_path):
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    dropped = wipe_db(FakeClient(), db, str(tmp_path), confirmed=True)
    assert dropped == ["entities"]
    assert db["entities"].dropped


def test_wipe_db_refuses_when_collections_change_during_verify(tmp_path):
    """Snapshot pré-verify: coleção criada entre o verify e o drop aborta o
    wipe (nunca seria restaurada — não está no dump)."""
    db = FakeDB({"entities": FakeCollection([{"_id": 1}])})
    export_dump(FakeClient(), db, str(tmp_path))
    db.second_call_extra = "colecao-nova"
    # chamadas de list_collection_names: 1 export, 2 snapshot do wipe,
    # 3 SEM DUMP do verify, 4 re-check pós-verify — extra só na 4ª
    db.extra_on_call = 4
    with pytest.raises(ValueError, match="mudaram"):
        wipe_db(FakeClient(), db, str(tmp_path), confirmed=True)
    assert not db["entities"].dropped
