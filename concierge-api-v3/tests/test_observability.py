"""Observability must be useful without turning logs or metrics into a secret sink."""

import logging

from app.core.config import settings
from app.core.observability import (
    SecretRedactionFilter,
    configure_logging,
    install_log_redaction,
    redact_text,
)


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


def test_access_log_do_uvicorn_sobrevive_ao_filtro():
    """O filtro não pode destruir a FORMA que o AccessFormatter desempacota.

    Medido em produção e reproduzido com o uvicorn real: o filtro renderizava tudo
    dentro de `msg` e zerava `args`, e o `AccessFormatter` desempacota exatamente
    esses args (`client, método, path, http_version, status`). Resultado: um
    traceback de ~30 linhas no stderr a CADA requisição — e a linha de acesso, que
    é a primeira coisa que se lê num incidente, não existia.
    """
    import io

    from uvicorn.logging import AccessFormatter

    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4:0", "GET", "/api/v3/entities?key=super-secret-places-key", "1.1", 200),
        None,
    )
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(SecretRedactionFilter())
    handler.setFormatter(AccessFormatter())

    handler.handle(record)

    linha = stream.getvalue()
    assert linha, "o handler caiu no handleError e não emitiu nada"
    assert "super-secret-places-key" not in linha
    assert "[REDACTED]" in linha
    # Os campos que o formatter monta a partir dos args continuam lá.
    assert "GET" in linha and "/api/v3/entities" in linha and "200" in linha


def test_excecao_com_chave_no_texto_e_redigida():
    """Argumento não-string não é desculpa para vazar: a URL vive no texto da exceção.

    O caso real está em `auth.py`/`og_image_service.py`, que logam `"%s", exc`: a
    chave do Places viaja dentro da mensagem da exceção, e um filtro que só redige
    `str` deixa passar justamente o argumento mais propenso a carregar segredo.
    """
    import io

    class _FalhaDeProvedor(Exception):
        pass

    record = logging.LogRecord(
        "app.services.og_image_service",
        logging.ERROR,
        __file__,
        0,
        "falha ao baixar: %s",
        (_FalhaDeProvedor("GET https://places.googleapis.com/v1/places/P1?key=super-secret-places-key"),),
        None,
    )
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.addFilter(SecretRedactionFilter())
    handler.setFormatter(logging.Formatter("%(message)s"))

    handler.handle(record)

    saida = stream.getvalue()
    assert saida, "o handler não emitiu nada"
    assert "super-secret-places-key" not in saida
    assert "[REDACTED]" in saida
    # A parte útil da mensagem continua legível para quem lê o log.
    assert "places.googleapis.com" in saida


def test_configure_logging_cria_handler_e_honra_o_nivel(monkeypatch):
    """`LOG_LEVEL` era uma env var que ninguém lia — e o log do app não existia.

    Medido em produção (2026-09-17): `capture_sessions TTL index ensured` (INFO do
    lifespan) nunca apareceu no log do Render, e as linhas `display media:` — escritas
    para diagnosticar o pipeline de imagem — também não. Sem handler no root, o
    `logging.lastResort` só imprime WARNING para cima.
    """
    import logging as _logging

    root = _logging.getLogger()
    anteriores = list(root.handlers)
    nivel_anterior = root.level
    root.handlers = []
    monkeypatch.setattr(settings, "log_level", "WARNING")
    marcas = {nome: _logging.getLogger(nome).propagate for nome in ("uvicorn", "uvicorn.error", "uvicorn.access")}
    try:
        configure_logging()
        meus = [h for h in root.handlers if getattr(h, "_concierge_root", False)]
        assert len(meus) == 1, "um handler do app, não dois"
        assert root.level == _logging.WARNING
        # Idempotente: chamar de novo (reload/dupla importação) não empilha handler.
        configure_logging()
        assert len([h for h in root.handlers if getattr(h, "_concierge_root", False)]) == 1
        # uvicorn não duplica: ele tem handler próprio.
        assert all(_logging.getLogger(nome).propagate is False for nome in marcas)
    finally:
        root.handlers = anteriores
        root.setLevel(nivel_anterior)
        for nome, valor in marcas.items():
            _logging.getLogger(nome).propagate = valor


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
