"""
Testes do endpoint de curadores.

Decisão 2026-08-15: GET /curators era público e vazava email de todos os
curadores — passa a exigir autenticação (login-gate, sem redação).
"""


def test_list_curators_requires_auth(client):
    """GET /curators sem credencial → 401 (antes vazava email publicamente)."""
    response = client.get("/api/v3/curators")
    assert response.status_code == 401


def test_list_curators_with_auth(client, auth_headers):
    """Com credencial, lista os perfis normalmente."""
    response = client.get("/api/v3/curators", headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)
