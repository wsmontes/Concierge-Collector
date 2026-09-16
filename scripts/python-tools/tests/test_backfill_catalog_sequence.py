"""Testes do backfill de `catalog_sequence`.

Fake próprio, e não o `fakes.py` compartilhado: aquele modelo cobre leitura
pontual e `update_one` (o que os outros scripts usam). Este backfill precisa de
cursor com `sort`, `bulk_write` e do `find_one_and_update` do contador — estender
o harness compartilhado mudaria a superfície que as outras suítes exercitam.
"""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backfill_catalog_sequence import MISSING, apply_backfill, plan, verify  # noqa: E402


class Cursor(list):
    def sort(self, key_or_list, direction=None):
        if isinstance(key_or_list, list):
            key, dir_ = key_or_list[0]
        else:
            key, dir_ = key_or_list, (direction or 1)
        return Cursor(sorted(self, key=lambda d: (d.get(key) is None, str(d.get(key))), reverse=(dir_ == -1)))


class Collection:
    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]
        self.writes = []
        self.update_matched_override = None

    def _match(self, doc, query):
        # Todas as chaves do filtro precisam casar; `$or` é UMA delas (tratá-lo
        # como o filtro inteiro fazia o write casar documentos que o alvo exclui).
        for key, cond in query.items():
            if key == "$or":
                if not any(self._match(doc, sub) for sub in cond):
                    return False
                continue
            if isinstance(cond, dict):
                if "$exists" in cond and (key in doc) != bool(cond["$exists"]):
                    return False
                if "$type" in cond and not isinstance(doc.get(key), (int, float)):
                    return False
                continue
            if doc.get(key) != cond:
                return False
        return True

    def find(self, query, projection=None):
        rows = [d for d in self.docs if self._match(d, query)]
        if projection:
            rows = [{k: d.get(k) for k in projection if k in d} for d in rows]
        return Cursor(rows)

    def find_one(self, query=None, projection=None, sort=None):
        rows = [d for d in self.docs if self._match(d, query or {})]
        if sort:
            rows = Cursor(rows).sort(sort)
        return rows[0] if rows else None

    def count_documents(self, query):
        return sum(1 for d in self.docs if self._match(d, query))

    def distinct(self, key):
        return sorted({d.get(key) for d in self.docs if d.get(key) is not None})

    def bulk_write(self, operations, ordered=True):
        wrote = 0
        for operation in operations:
            self.writes.append(operation)
            for doc in self.docs:
                if self._match(doc, operation._filter):
                    doc.update(operation._doc.get("$set", {}))
                    wrote += 1
        matched = wrote if self.update_matched_override is None else self.update_matched_override
        return SimpleNamespace(matched_count=matched, modified_count=matched)

    def update_one(self, query, update, upsert=False):
        doc = self.find_one(query)
        if doc is None:
            if not upsert:
                return SimpleNamespace(matched_count=0, modified_count=0)
            doc = {"_id": query["_id"]}
            self.docs.append(doc)
        for key, value in update.get("$set", {}).items():
            doc[key] = value
        for key, value in update.get("$max", {}).items():
            doc[key] = max(doc.get(key, 0), value)
        for key, value in update.get("$inc", {}).items():
            doc[key] = doc.get(key, 0) + value
        return SimpleNamespace(matched_count=1, modified_count=1)

    def find_one_and_update(self, query, update, **kwargs):
        doc = self.find_one(query)
        for key, value in update.get("$inc", {}).items():
            doc[key] = doc.get(key, 0) + value
        return doc


class Db:
    def __init__(self, curations=(), counter=None):
        self.curations = Collection(curations)
        self.counters = Collection([counter] if counter else [])


def legacy(curation_id, created_at, sequence=None):
    doc = {"curation_id": curation_id, "createdAt": created_at}
    if sequence is not None:
        doc["catalog_sequence"] = sequence
    return doc


def test_importing_the_module_does_not_touch_the_environment():
    """O script blinda `MONGODB_URL` contra um shell obsoleto, mas só ao RODAR.

    No topo do módulo isso escrevia a connection string de produção do `.env`
    dentro do processo que apenas importa o arquivo — e os testes importam.
    """
    import importlib
    import os

    before = dict(os.environ)
    importlib.reload(importlib.import_module("backfill_catalog_sequence"))
    assert dict(os.environ) == before


def test_plan_orders_by_created_at_so_recency_stays_true():
    """A ordem é a parte irreversível: depois de escrita, o filtro exclui para sempre."""
    db = Db([
        legacy("meio", "2026-03-01T00:00:00"),
        legacy("nova", "2026-08-01T00:00:00"),
        legacy("velha", "2026-02-01T00:00:00"),
    ])

    plano = plan(db)

    assert [d["curation_id"] for d in plano["pendentes"]] == ["velha", "meio", "nova"]


def test_plan_and_write_agree_on_explicit_null():
    """`null` explícito é pendente no plano E casável na escrita (senão trava em loop)."""
    db = Db([legacy("nula", "2026-02-01T00:00:00", sequence=None)])
    db.curations.docs[0]["catalog_sequence"] = None
    assert db.curations.count_documents(MISSING) == 1

    plano = plan(db)
    assert apply_backfill(db, plano) == 0

    assert db.curations.docs[0]["catalog_sequence"] == 1
    assert verify(db) == 0


def test_apply_assigns_reserved_sequences_in_plan_order():
    db = Db([
        legacy("b", "2026-05-01T00:00:00"),
        legacy("a", "2026-01-01T00:00:00"),
    ])

    assert apply_backfill(db, plan(db)) == 0

    por_id = {d["curation_id"]: d["catalog_sequence"] for d in db.curations.docs}
    assert por_id == {"a": 1, "b": 2}


def test_apply_fails_loudly_when_a_write_does_not_match_the_plan():
    """Skip silencioso é o defeito que este script existe para consertar."""
    db = Db([legacy("a", "2026-01-01T00:00:00"), legacy("b", "2026-02-01T00:00:00")])
    db.curations.update_matched_override = 1  # simula uma escrita que não casou

    assert apply_backfill(db, plan(db)) == 1


def test_plan_is_a_noop_on_a_sequenced_collection():
    db = Db([legacy("a", "2026-01-01T00:00:00", sequence=7)])

    plano = plan(db)

    assert plano["pendentes"] == []
    assert plano["maior_sequencia"] == 7
