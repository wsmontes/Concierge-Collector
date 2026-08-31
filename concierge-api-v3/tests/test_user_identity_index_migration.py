"""Unique user identity indexes must never be installed over ambiguous data."""

from types import SimpleNamespace

import pytest

from scripts import ensure_user_identity_indexes as migration


class _UsersCollection:
    def __init__(self, index_info=None):
        self.created = []
        self._index_info = index_info or {"_id_": {"key": [("_id", 1)], "unique": True}}

    def index_information(self):
        return self._index_info

    def create_index(self, keys, **kwargs):
        self.created.append((list(keys), dict(kwargs)))
        return kwargs.get("name", "created")


class _Database:
    def __init__(self, users=None):
        self.users = users or _UsersCollection()


def test_install_refuses_any_duplicate_identity(monkeypatch):
    db = _Database()
    monkeypatch.setattr(
        migration,
        "audit",
        lambda _db: ([{"_id": "google-duplicate", "count": 2}], []),
    )

    with pytest.raises(RuntimeError, match="duplicate user identities"):
        migration.ensure_user_identity_indexes(db)

    assert db.users.created == []


def test_install_creates_google_and_case_insensitive_email_unique_indexes(monkeypatch):
    db = _Database()
    monkeypatch.setattr(migration, "audit", lambda _db: ([], []))

    created = migration.ensure_user_identity_indexes(db)

    assert created == ["users_google_id_unique", "users_email_unique_ci"]
    google_keys, google_options = db.users.created[0]
    assert google_keys == [("google_id", 1)]
    assert google_options["unique"] is True
    assert google_options["partialFilterExpression"] == {"google_id": {"$type": "string"}}

    email_keys, email_options = db.users.created[1]
    assert email_keys == [("email", 1)]
    assert email_options["unique"] is True
    assert email_options["collation"] == {"locale": "en", "strength": 2}
    assert email_options["partialFilterExpression"] == {"email": {"$type": "string"}}


def test_install_is_idempotent_when_named_indexes_already_exist(monkeypatch):
    info = {
        "_id_": {"key": [("_id", 1)], "unique": True},
        "users_google_id_unique": {"key": [("google_id", 1)], "unique": True},
        "users_email_unique_ci": {"key": [("email", 1)], "unique": True},
    }
    users = _UsersCollection(index_info=info)
    db = _Database(users)
    monkeypatch.setattr(migration, "audit", lambda _db: ([], []))

    created = migration.ensure_user_identity_indexes(db)

    assert created == []
    assert users.created == []


def test_install_refuses_unnamed_conflicting_same_key_index(monkeypatch):
    info = {
        "_id_": {"key": [("_id", 1)], "unique": True},
        "google_id_1": {"key": [("google_id", 1)]},
    }
    users = _UsersCollection(index_info=info)
    db = _Database(users)
    monkeypatch.setattr(migration, "audit", lambda _db: ([], []))

    with pytest.raises(RuntimeError, match="conflicting existing index"):
        migration.ensure_user_identity_indexes(db)

    assert users.created == []
