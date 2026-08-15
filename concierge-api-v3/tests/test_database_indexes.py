"""
Testes do _ensure_indexes (app/core/database.py) — criação tolerante a falha
individual. Incidente 2026-08-12: o primeiro índice único que falhava
(duplicatas de externalId) abortava TODA a criação sob um try/except único —
em produção entities ficou com 4 de 10 índices e curations só com _id_.
Sem MongoDB — get_database() é monkeypatched.
"""

from app.core import database as dbmod


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
            # nenhuma spec é mais unique (dados reais têm duplicatas), mas a
            # garantia de isolamento por índice continua obrigatória
            raise Exception("E11000 duplicate key error collection (simulado)")
        self.created.append((keys, kwargs))
        return "ok"

    def index_information(self):
        return {}

    def drop_index(self, name):
        return None


class FakeDb:
    def __init__(self):
        self.entities = FakeCol("entities", fail_keys={"externalId"})
        self.curations = FakeCol("curations")
        self.capture_sessions = FakeCol("capture_sessions")
        self.auth_sessions = FakeCol("auth_sessions")


def test_ensure_indexes_continues_after_index_failure(monkeypatch, caplog):
    fake = FakeDb()
    monkeypatch.setattr(dbmod, "get_database", lambda: fake)

    dbmod._ensure_indexes()  # não pode levantar

    # o índice que falhou NÃO foi criado...
    assert "externalId" not in [k for k, _ in fake.entities.created]
    # ...mas todos os demais de entities, todos os de curations e o TTL
    # de auth_sessions foram
    assert len(fake.entities.created) == 9
    assert len(fake.curations.created) == 10
    assert len(fake.auth_sessions.created) == 1
    # e a falha foi registrada explicitamente no log
    assert any("externalId" in r.getMessage() for r in caplog.records)


def test_ensure_indexes_all_success_when_no_duplicates(monkeypatch):
    fake = FakeDb()
    fake.entities.fail_keys = set()
    monkeypatch.setattr(dbmod, "get_database", lambda: fake)

    dbmod._ensure_indexes()

    assert len(fake.entities.created) == 10
    assert len(fake.curations.created) == 10
    assert len(fake.auth_sessions.created) == 1


def test_index_specs_come_from_the_shared_module():
    """database.py usa a MESMA lista de specs que db_rebuild (app/core/
    index_specs.py) — uma mudança de índice não pode derivar entre árvores."""
    from app.core.index_specs import INDEX_SPECS

    assert dbmod.INDEX_SPECS is INDEX_SPECS
    assert len(INDEX_SPECS) == 22
    assert sum(1 for s in INDEX_SPECS if s[0] == "capture_sessions") == 1


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
    assert state["created"] == 20  # 9 entities + 10 curations + 1 auth_sessions (21 specs - capture_sessions)
    assert any("externalId" in str(d["keys"]) for d in state["failed_details"])
    assert any("externalId" in r.getMessage() for r in caplog.records)
