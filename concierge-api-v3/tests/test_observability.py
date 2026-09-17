"""Observability must be useful without turning logs or metrics into a secret sink."""

import logging

from app.core.config import settings
from app.core.observability import SecretRedactionFilter, install_log_redaction, redact_text


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


def test_chave_em_query_e_redigida_mesmo_vindo_de_logger_filho():
    """A chave do Places viaja como `?key=...` na URL; o log não pode carregá-la.

    O caso é do httpx (logger FILHO), que é o que a produção tem: o filtro no
    logger raiz não pega registro propagado — `Logger.filter()` só é consultado
    para o que é emitido diretamente naquele logger. Por isso o filtro vive no
    handler, e este teste exercita exatamente esse caminho.
    """
    registros: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            registros.append(record.getMessage())

    handler = _Capture()
    handler.addFilter(SecretRedactionFilter())
    child = logging.getLogger("httpx")
    previous_handlers = child.handlers
    previous_level = child.level
    child.handlers = [handler]
    child.propagate = False
    # O nível importa: outro teste desta suíte silencia o httpx em WARNING (é o
    # comportamento que production tem), e um `info` seria descartado antes de
    # chegar ao handler — o teste mediria o nível, não a redação.
    child.setLevel(logging.INFO)
    try:
        child.info(
            "HTTP Request: GET https://places.googleapis.com/v1/places/P1/photos/PH1/media"
            '?key=super-secret-places-key&maxWidthPx=768 "HTTP/1.1 200 OK"'
        )
    finally:
        child.handlers = previous_handlers
        child.propagate = True
        child.setLevel(previous_level)

    assert registros, "o handler de captura não recebeu o registro"
    assert "super-secret-places-key" not in registros[0]
    assert "[REDACTED]" in registros[0]


def test_install_log_redaction_coloca_o_filtro_nos_handlers():
    root = logging.getLogger()
    previous = list(root.handlers)
    handler = logging.StreamHandler()
    root.handlers = [handler]
    try:
        install_log_redaction()
        assert any(isinstance(item, SecretRedactionFilter) for item in handler.filters)
    finally:
        root.handlers = previous


def test_httpx_fica_silencioso_em_info():
    """A request line do httpx é URL completa: em INFO, loga query e tudo."""
    install_log_redaction()

    assert logging.getLogger("httpx").level >= logging.WARNING
    assert logging.getLogger("httpcore").level >= logging.WARNING
