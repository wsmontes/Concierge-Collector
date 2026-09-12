"""Bulk upsert de entities: falha de escrita vira ERRO, nunca contagem de sucesso.

Regressão (auditoria 2026-09-12): no handler de DuplicateKeyError a escrita de
recuperação era envolvida em `except Exception: pass` e `updated` incrementava
incondicionalmente. O import (scripts/python-tools/import_entities.py) lê
exatamente esses contadores — um item que NÃO foi gravado aparecia como
"updated" e em nenhum erro, ou seja, perda de dados silenciosa com recibo de
sucesso.

Os testes chamam a função de rota direto (sem TestClient) para não depender de
Mongo: o que está sob teste é a contabilidade da resposta.
"""

from pymongo.errors import DuplicateKeyError

from app.api.entities import bulk_upsert_entities
from app.models.schemas import BulkEntityCreate, EntityCreate

ENTITY_ID = "ent_bulk_contract"


def _payload():
    return BulkEntityCreate(entities=[EntityCreate(entity_id=ENTITY_ID, name="Padaria", type="restaurant")])


class _Collection:
    """Coleção falsa: o insert colide no índice único e a recuperação falha."""

    def __init__(self, recovery_error=None, matched_count=1):
        self.recovery_error = recovery_error
        self.matched_count = matched_count

    def find_one(self, *args, **kwargs):
        return None

    def insert_one(self, *args, **kwargs):
        raise DuplicateKeyError("E11000 duplicate key error")

    def update_one(self, *args, **kwargs):
        if self.recovery_error:
            raise self.recovery_error
        return type("Result", (), {"matched_count": self.matched_count})()


class _Curations:
    """Stub para a projeção de curadorias vinculadas (caminho de sucesso)."""

    def update_many(self, *args, **kwargs):
        return type("Result", (), {"matched_count": 0, "modified_count": 0})()

    def find(self, *args, **kwargs):
        return iter([])


class _DB:
    def __init__(self, collection):
        self.entities = collection
        self.curations = _Curations()


def _call(collection):
    return bulk_upsert_entities(
        request=None,
        payload=_payload(),
        db=_DB(collection),
        auth={"method": "api_key"},
    )


def test_recovery_write_failure_is_reported_not_counted_as_updated():
    response = _call(_Collection(recovery_error=RuntimeError("write concern failed")))

    assert response.created == 0
    assert response.updated == 0
    assert len(response.errors) == 1
    assert response.errors[0].id == ENTITY_ID
    assert "recovery failed" in response.errors[0].error


def test_recovery_with_no_matched_document_is_reported():
    """O upsert que não encontra o alvo não gravou nada — não é sucesso."""
    response = _call(_Collection(matched_count=0))

    assert response.updated == 0
    assert len(response.errors) == 1
    assert "no document matched" in response.errors[0].error


def test_successful_recovery_still_counts_one_update():
    response = _call(_Collection(matched_count=1))

    assert response.created == 0
    assert response.updated == 1
    assert response.errors == []
