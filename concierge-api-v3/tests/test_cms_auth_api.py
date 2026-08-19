"""HTTP contract tests for the FastAPI-to-Payload CMS handoff."""

from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlsplit
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_database
from app.core.security import create_access_token
from app.models.cms_auth import CmsAuthorization
from main import app


class _Users:
    def __init__(self):
        self.documents: dict[str, dict] = {}

    def find_one(self, query):
        if "email" in query:
            return self.documents.get(query["email"])
        return next((document for document in self.documents.values() if document["_id"] == query["_id"]), None)


class _CmsAuthTestDatabase:
    """Mínimo em memória para contratos HTTP sem Atlas ou credenciais reais."""

    def __init__(self):
        self.users = _Users()
        self.cms_auth_codes = MagicMock()


@pytest.fixture
def cms_db():
    return _CmsAuthTestDatabase()


@pytest.fixture
def cms_client(monkeypatch, cms_db):
    @asynccontextmanager
    async def no_lifespan(_app):
        yield

    monkeypatch.setattr(app.router, "lifespan_context", no_lifespan)
    sentinel = object()
    previous_override = app.dependency_overrides.get(get_database, sentinel)
    app.dependency_overrides[get_database] = lambda: cms_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        if previous_override is sentinel:
            app.dependency_overrides.pop(get_database, None)
        else:
            app.dependency_overrides[get_database] = previous_override


@pytest.fixture
def admin_auth_headers(cms_db):
    email = "cms-admin-test@example.com"
    cms_db.users.documents[email] = {
        "_id": "cms-admin-test",
        "google_id": "cms-admin-test",
        "email": email,
        "name": "CMS Admin",
        "authorized": True,
        "role": "admin",
    }
    return {"Authorization": f"Bearer {create_access_token({'sub': email, 'role': 'admin'})}"}


@pytest.fixture
def curator_auth_headers(cms_db):
    email = "cms-curator-test@example.com"
    cms_db.users.documents[email] = {
        "_id": "cms-curator-test",
        "google_id": "cms-curator-test",
        "email": email,
        "name": "CMS Curator",
        "authorized": True,
        "role": "curator",
    }
    return {"Authorization": f"Bearer {create_access_token({'sub': email, 'role': 'curator'})}"}


def test_cms_authorize_redirects_only_to_fixed_callback(cms_client, admin_auth_headers, monkeypatch):
    monkeypatch.setattr("app.api.cms_auth.issue_handoff_code", lambda _db, **_: "one-shot")

    response = cms_client.get(
        "/api/v3/auth/cms/authorize?state=opaque-state",
        headers=admin_auth_headers,
        follow_redirects=False,
    )

    assert response.status_code == 307
    location = response.headers["location"]
    parsed = urlsplit(location)
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == "https://admin.concierge-collector.com/auth/callback"
    assert parse_qs(parsed.query) == {"code": ["one-shot"], "state": ["opaque-state"]}


def test_cms_authorize_does_not_accept_api_key_as_human_login(cms_client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.admin_api_keys", "test-admin-api-key")

    response = cms_client.get(
        "/api/v3/auth/cms/authorize?state=opaque-state",
        headers={"X-API-Key": "test-admin-api-key"},
        follow_redirects=False,
    )

    assert response.status_code == 401


def test_cms_exchange_requires_distinct_service_key(cms_client):
    response = cms_client.post(
        "/api/v3/auth/cms/exchange",
        json={
            "code": "x",
            "state": "s",
            "target_origin": "https://admin.concierge-collector.com",
        },
    )

    assert response.status_code == 401


def test_cms_exchange_does_not_accept_an_admin_api_key_as_service_key(cms_client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.admin_api_keys", "test-admin-api-key")

    response = cms_client.post(
        "/api/v3/auth/cms/exchange",
        json={
            "code": "x",
            "state": "s",
            "target_origin": "https://admin.concierge-collector.com",
        },
        headers={"X-API-Key": "test-admin-api-key"},
    )

    assert response.status_code == 401


def test_cms_exchange_rejects_an_unexpected_target_before_consuming_code(cms_client, monkeypatch):
    consume = MagicMock()
    monkeypatch.setattr("app.api.cms_auth.consume_handoff_code", consume)

    response = cms_client.post(
        "/api/v3/auth/cms/exchange",
        json={
            "code": "x",
            "state": "s",
            "target_origin": "https://attacker.example",
        },
        headers={"X-CMS-Service-Key": "test-cms-key"},
    )

    assert response.status_code == 400
    consume.assert_not_called()


def test_cms_exchange_with_service_key_uses_only_the_fixed_admin_origin(cms_client, cms_db, monkeypatch):
    authorization = CmsAuthorization(
        user_id="cms-admin-test",
        email="cms-admin-test@example.com",
        name="CMS Admin",
        role="admin",
        authorized=True,
        authz_revision="a" * 64,
    )
    consume = MagicMock(return_value=authorization)
    monkeypatch.setattr("app.api.cms_auth.consume_handoff_code", consume)

    response = cms_client.post(
        "/api/v3/auth/cms/exchange",
        json={
            "code": "one-shot",
            "state": "opaque-state",
            "target_origin": "https://admin.concierge-collector.com",
        },
        headers={"X-CMS-Service-Key": "test-cms-key"},
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == "cms-admin-test"
    consume.assert_called_once_with(
        cms_db,
        code="one-shot",
        state="opaque-state",
        target_origin="https://admin.concierge-collector.com",
    )


def test_cms_authorize_rejects_curator(cms_client, curator_auth_headers):
    response = cms_client.get(
        "/api/v3/auth/cms/authorize?state=s",
        headers=curator_auth_headers,
        follow_redirects=False,
    )

    assert response.status_code == 403


def test_cms_introspection_loads_current_authorization(cms_client, admin_auth_headers):
    response = cms_client.post(
        "/api/v3/auth/cms/introspect",
        json={"subject": "cms-admin-test@example.com"},
        headers={"X-CMS-Service-Key": "test-cms-key"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    assert response.json()["email"] == "cms-admin-test@example.com"


def test_cms_introspection_accepts_the_stable_user_id_for_worker_revalidation(cms_client, admin_auth_headers):
    response = cms_client.post(
        "/api/v3/auth/cms/introspect",
        json={"subject": "cms-admin-test"},
        headers={"X-CMS-Service-Key": "test-cms-key"},
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == "cms-admin-test"
