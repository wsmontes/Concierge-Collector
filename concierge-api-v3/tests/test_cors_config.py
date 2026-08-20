"""
Testes da validação de CORS (achado #3 da auditoria 2026-08-18).

allow_credentials=True combinado com '*' na allowlist é session riding
clássico: o Starlette reflete QUALQUER origin com credenciais, e um site
malicioso usa os cookies HttpOnly da vítima contra a API. A validação é
fail-fast no startup — config errada derruba o boot em vez de abrir a porta.
"""

import pytest


def test_cors_wildcard_rejeitado():
    """'*' na lista → RuntimeError no startup (fail-closed)."""
    from main import _cors_origins_safe

    with pytest.raises(RuntimeError, match="allow_credentials"):
        _cors_origins_safe(["*"])


def test_cors_wildcard_entre_outras_origins_tambem_rejeitado():
    """'*, https://x.com' também é inseguro — qualquer '*' na lista derruba."""
    from main import _cors_origins_safe

    with pytest.raises(RuntimeError, match="allow_credentials"):
        _cors_origins_safe(["https://concierge-collector-web.onrender.com", "*"])


def test_cors_lista_explicita_aceita():
    """Lista explícita de origins passa (config atual do projeto)."""
    from main import _cors_origins_safe

    result = _cors_origins_safe(["https://concierge-collector-web.onrender.com", "http://localhost:5500"])
    assert result == ["https://concierge-collector-web.onrender.com", "http://localhost:5500"]


def test_cors_lista_vazia_aceita():
    """Lista vazia = sem browser origins (API só) — válido."""
    from main import _cors_origins_safe

    assert _cors_origins_safe([]) == []


def test_cors_includes_the_fixed_admin_origin_when_loading_runtime_config(monkeypatch):
    """O origin do Admin entra explicitamente; não há reflection/wildcard."""
    from main import _cors_origins_safe

    monkeypatch.setattr("main.settings.cors_origins", '["https://collector.example"]')
    monkeypatch.setattr("main.settings.cms_admin_origin", "https://admin.concierge-collector.com")

    assert _cors_origins_safe() == [
        "https://collector.example",
        "https://admin.concierge-collector.com",
    ]
