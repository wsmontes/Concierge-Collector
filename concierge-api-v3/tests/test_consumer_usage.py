"""Consumer usage aggregation: service contract, internal endpoint and the
proof that consumer usage never touches the CMS projection.

The plan-level test (``test_internal_usage_returns_operational_max_and_never_touches_cms``)
is opt-in real-Mongo (``operational_db``/``cms_writer`` follow the repo's
``--run-mongo`` + ``MONGODB_TEST_URL``/``CMS_MONGODB_TEST_URL`` convention and
skip in the default unit gate). The hermetic tests below exercise the same
service and endpoint against the in-memory database the ``client`` serves, so
the default gate verifies the implementation without any external dependency.
"""

from datetime import timedelta

from app.services.consumer_auth_service import ConsumerPrincipal
from app.services.consumer_usage_service import record_consumer_usage
from tests.fixtures.distribution import MINUTE


def test_internal_usage_returns_operational_max_and_never_touches_cms(
    client,
    operational_db,
    cms_writer,
    monkeypatch,
):
    from app.core.database import get_database

    # O client session-scoped serve o banco in-memory; sob --run-mongo o
    # endpoint precisa ler exatamente o operational_db que o teste escreve.
    monkeypatch.setitem(client.app.dependency_overrides, get_database, lambda: operational_db, raising=False)
    record_consumer_usage(operational_db, ConsumerPrincipal(credential_id="cred-1", application_id="app-1"), MINUTE)
    record_consumer_usage(
        operational_db, ConsumerPrincipal(credential_id="cred-1", application_id="app-1"), MINUTE + timedelta(seconds=5)
    )
    response = client.get("/api/v3/internal/consumer-usage", headers={"X-CMS-Service-Key": "test-cms-key"})
    assert response.status_code == 200
    assert response.json()["items"] == [{"credentialId": "cred-1", "lastUsedAt": "2026-08-18T12:00:05+00:00"}]
    assert cms_writer.consumer_credentials.count_documents({}) == 0


def test_record_consumer_usage_upserts_max_and_increments(in_memory_db):
    """Service contract (hermetic): $max lastUsedAt, $set updatedAt/applicationId,
    $inc requestCount, one document per credential, nothing else written."""
    usage = in_memory_db["consumer_credential_usage"]
    usage.delete_many({})
    try:
        record_consumer_usage(in_memory_db, ConsumerPrincipal(credential_id="cred-1", application_id="app-1"), MINUTE)
        record_consumer_usage(
            in_memory_db,
            ConsumerPrincipal(credential_id="cred-1", application_id="app-1"),
            MINUTE + timedelta(seconds=5),
        )
        record_consumer_usage(in_memory_db, ConsumerPrincipal(credential_id="cred-2", application_id="app-2"), MINUTE)
        documents = usage.documents
        cred1 = next(d for d in documents if d["credentialId"] == "cred-1")
        assert cred1["lastUsedAt"] == MINUTE + timedelta(seconds=5)  # $max kept the later timestamp
        assert cred1["updatedAt"] == MINUTE + timedelta(seconds=5)
        assert cred1["applicationId"] == "app-1"
        assert cred1["requestCount"] == 2
        assert usage.count_documents({}) == 2
    finally:
        usage.delete_many({})


def test_internal_usage_requires_service_key_and_never_accepts_consumer_key(in_memory_db, client):
    """The internal endpoint is service-key-only: a consumer Bearer or a
    missing X-CMS-Service-Key is rejected with 401, even when usage exists."""
    usage = in_memory_db["consumer_credential_usage"]
    usage.delete_many({})
    try:
        record_consumer_usage(in_memory_db, ConsumerPrincipal(credential_id="cred-1", application_id="app-1"), MINUTE)
        assert client.get("/api/v3/internal/consumer-usage").status_code == 401
        assert (
            client.get(
                "/api/v3/internal/consumer-usage",
                headers={"Authorization": "Bearer cck_aaaaaaaaaaaa_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"},
            ).status_code
            == 401
        )
    finally:
        usage.delete_many({})


def test_internal_usage_returns_operational_max_and_serializes_iso(in_memory_db, client):
    """Endpoint behavior in the default gate: the client serves the same
    in-memory database the service writes to, so the full request path runs."""
    usage = in_memory_db["consumer_credential_usage"]
    usage.delete_many({})
    try:
        record_consumer_usage(in_memory_db, ConsumerPrincipal(credential_id="cred-1", application_id="app-1"), MINUTE)
        record_consumer_usage(
            in_memory_db,
            ConsumerPrincipal(credential_id="cred-1", application_id="app-1"),
            MINUTE + timedelta(seconds=5),
        )
        response = client.get("/api/v3/internal/consumer-usage", headers={"X-CMS-Service-Key": "test-cms-key"})
        assert response.status_code == 200
        body = response.json()
        assert body["items"] == [{"credentialId": "cred-1", "lastUsedAt": "2026-08-18T12:00:05+00:00"}]
        assert body["next_cursor"] is None
    finally:
        usage.delete_many({})


def test_internal_usage_cursor_walks_updated_at_and_rejects_tampering(in_memory_db, client):
    """Pages are ordered by (updatedAt, _id); the opaque HMAC cursor advances
    strictly past the last record, and a tampered cursor is a 409."""
    usage = in_memory_db["consumer_credential_usage"]
    usage.delete_many({})
    headers = {"X-CMS-Service-Key": "test-cms-key"}
    try:
        for credential_id, offset in (("cred-a", 0), ("cred-b", 1), ("cred-c", 2)):
            record_consumer_usage(
                in_memory_db,
                ConsumerPrincipal(credential_id=credential_id, application_id="app-1"),
                MINUTE + timedelta(seconds=offset),
            )
        first = client.get("/api/v3/internal/consumer-usage?limit=2", headers=headers)
        assert first.status_code == 200
        first_body = first.json()
        assert [item["credentialId"] for item in first_body["items"]] == ["cred-a", "cred-b"]
        assert first_body["next_cursor"]

        second = client.get(
            f"/api/v3/internal/consumer-usage?limit=2&after={first_body['next_cursor']}", headers=headers
        )
        assert second.status_code == 200
        second_body = second.json()
        assert [item["credentialId"] for item in second_body["items"]] == ["cred-c"]
        assert second_body["next_cursor"] is None

        tampered = client.get(f"/api/v3/internal/consumer-usage?after={first_body['next_cursor']}x", headers=headers)
        assert tampered.status_code == 409
    finally:
        usage.delete_many({})
