"""
Testes do _ensure_indexes (app/core/database.py) — criação tolerante a falha
individual. Incidente 2026-08-12: o primeiro índice único que falhava
(duplicatas de externalId) abortava TODA a criação sob um try/except único —
em produção entities ficou com 4 de 10 índices e curations só com _id_.
Sem MongoDB — get_database() é monkeypatched.

Contagens são DERIVADAS de INDEX_SPECS (fonte única): números mágicos
hardcoded já envelheceram várias vezes. FakeDb cobre TODAS as collections
referenciadas.
"""

from collections import Counter

from app.core import database as dbmod
from app.core.index_specs import INDEX_SPECS

# Specs que o _ensure_indexes realmente processa (o TTL de capture_sessions
# fica no lifespan.py) e quanto se espera por coleção.
_SPEC_COUNTS = Counter(s[0] for s in INDEX_SPECS if s[0] != "capture_sessions")


class FakeCol:
    """Fake mínimo de pymongo.collection.Collection para _ensure_indexes."""

    def __init__(self, name, fail_keys=None):
        self.name = name
        self.created = []
        self.fail_keys = fail_keys or set()

    def create_index(self, keys, **kwargs):
        hashable = tuple(keys) if isinstance(keys, list) else keys
        if hashable in self.fail_keys:
            # qualquer falha conta (unique/duplicata, cota, rede...) —
            # garantia de isolamento por índice continua obrigatória
            raise Exception("E11000 duplicate key error collection (simulado)")
        self.created.append((keys, kwargs))
        return "ok"

    def index_information(self):
        return {}

    def drop_index(self, name):
        return None


class FakeDb:
    """Fake mínimo de pymongo.database para _ensure_indexes — coleções
    derivadas dinamicamente de INDEX_SPECS (nunca divergir da fonte)."""

    def __init__(self):
        for coll_name in {s[0] for s in INDEX_SPECS}:
            setattr(self, coll_name, FakeCol(coll_name))
        self.entities.fail_keys = {"externalId"}


def test_ensure_indexes_continues_after_index_failure(monkeypatch, caplog):
    fake = FakeDb()
    monkeypatch.setattr(dbmod, "get_database", lambda: fake)

    dbmod._ensure_indexes()  # não pode levantar

    # o índice que falhou NÃO foi criado...
    assert "externalId" not in [k for k, _ in fake.entities.created]
    # ...mas todos os demais, em TODAS as coleções da spec, foram
    assert len(fake.entities.created) == _SPEC_COUNTS["entities"] - 1
    for coll in (
        "curations",
        "auth_sessions",
        "oauth_login_states",
        "cms_auth_codes",
        "consumer_rate_limit_windows",
    ):
        assert len(getattr(fake, coll).created) == _SPEC_COUNTS[coll]
    # e a falha foi registrada explicitamente no log
    assert any("externalId" in r.getMessage() for r in caplog.records)


def test_ensure_indexes_all_success_when_no_duplicates(monkeypatch):
    fake = FakeDb()
    fake.entities.fail_keys = set()
    monkeypatch.setattr(dbmod, "get_database", lambda: fake)

    dbmod._ensure_indexes()

    for coll, expected in _SPEC_COUNTS.items():
        assert len(getattr(fake, coll).created) == expected


def test_index_specs_come_from_the_shared_module():
    """database.py usa a MESMA lista de specs que db_rebuild (app/core/
    index_specs.py) — uma mudança de índice não pode derivar entre árvores.
    Asserção estrutural (coleções/índices esperados presentes), não número
    mágico de contagem."""
    from app.core.index_specs import INDEX_SPECS

    assert dbmod.INDEX_SPECS is INDEX_SPECS
    assert {s[0] for s in INDEX_SPECS} == {
        "entities",
        "curations",
        "capture_sessions",
        "auth_sessions",
        "oauth_login_states",
        "cms_auth_codes",
        "consumer_rate_limit_windows",
        "consumer_credential_usage",
    }
    assert sum(1 for s in INDEX_SPECS if s[0] == "capture_sessions") == 1
    assert ("auth_sessions", "jti", {"unique": True}) in INDEX_SPECS
    assert (
        "oauth_login_states",
        [("state_hash", 1)],
        {"unique": True, "name": "oauth_state_hash_unique"},
    ) in INDEX_SPECS
    assert (
        "oauth_login_states",
        [("expires_at", 1)],
        {"expireAfterSeconds": 0, "name": "oauth_state_expiry_ttl"},
    ) in INDEX_SPECS
    assert ("cms_auth_codes", [("code_hash", 1)], {"unique": True, "name": "cms_code_hash_unique"}) in INDEX_SPECS
    assert (
        "cms_auth_codes",
        [("expires_at", 1)],
        {"expireAfterSeconds": 0, "name": "cms_code_expiry_ttl"},
    ) in INDEX_SPECS
    # índices novos do roadmap Collections/Payload (catalog_sequence ×2)
    assert (
        "curations",
        [("catalog_sequence", 1)],
        {
            "unique": True,
            "partialFilterExpression": {"catalog_sequence": {"$exists": True}},
            "name": "catalog_sequence_unique",
        },
    ) in INDEX_SPECS
    assert (
        "curations",
        [("catalog_sequence", 1), ("curation_id", 1)],
        {"name": "catalog_sequence_curation_scan"},
    ) in INDEX_SPECS
    # quota de consumo (fase 05): chave atômica + TTL
    assert (
        "consumer_rate_limit_windows",
        [("credentialId", 1), ("minuteWindow", 1)],
        {"unique": True, "name": "consumer_rate_limit_window_unique"},
    ) in INDEX_SPECS
    assert (
        "consumer_rate_limit_windows",
        "expiresAt",
        {"expireAfterSeconds": 0, "name": "consumer_rate_limit_expiry_ttl"},
    ) in INDEX_SPECS
    # sync de last use (fase 05): page key (updatedAt,_id), SEM TTL — é a
    # fonte do job Payload, não uma janela transitória
    assert ("consumer_credential_usage", [("updatedAt", 1), ("_id", 1)], {}) in INDEX_SPECS


def test_ensure_indexes_records_state_and_logs_error(monkeypatch, caplog):
    """Falha de índice agora é visível: estado module-level (consumido por
    /ready) + log nível ERROR (antes era warning — deploy seguia 'verde'
    com índice estrutural ausente; incidente 2026-08-12)."""
    import logging

    fake = FakeDb()
    monkeypatch.setattr(dbmod, "get_database", lambda: fake)
    caplog.set_level(logging.ERROR)

    dbmod._ensure_indexes()

    state = dbmod.get_index_state()
    assert state["failed"] == 1
    # todas as specs processadas (capture_sessions fica fora) menos a que falhou
    assert state["created"] == sum(_SPEC_COUNTS.values()) - 1
    assert any("externalId" in str(d["keys"]) for d in state["failed_details"])
    assert any("externalId" in r.getMessage() for r in caplog.records)
