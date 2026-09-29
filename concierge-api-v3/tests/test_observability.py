"""Observability must be useful without turning logs or metrics into a secret sink."""

from app.core.config import settings
from app.core.observability import redact_text


def test_request_id_is_propagated_and_secret_is_redacted(client):
    response = client.get(
        "/api/v3/health",
        headers={"X-Request-Id": "req-123", "Authorization": "Bearer SENTINEL_SECRET"},
    )

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "req-123"
    assert "SENTINEL_SECRET" not in redact_text("Authorization: Bearer SENTINEL_SECRET")


def test_invalid_request_id_is_replaced(client):
    response = client.get("/api/v3/health", headers={"X-Request-Id": "<script>"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] != "<script>"


def test_metrics_require_a_distinct_key(client, monkeypatch):
    monkeypatch.setattr(settings, "metrics_key", "metrics-only-secret")

    assert client.get("/api/v3/metrics", headers={"X-Metrics-Key": settings.api_secret_key}).status_code == 401
    response = client.get("/api/v3/metrics", headers={"X-Metrics-Key": "metrics-only-secret"})
    assert response.status_code == 200
    assert "concierge_api_http_requests_total" in response.text
