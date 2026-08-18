"""
Testes de controle de acesso nas leituras de entities (login-gate).

Decisão 2026-08-18 (auditoria de segurança, achado #5): o catálogo de
entidades (~21,6k docs) era a maior superfície de leitura do Mongo sem
auth. GET /entities e GET /entities/{id} agora exigem autenticação
(verify_auth), na mesma linha do login-gate de curations (2026-08-15).
Sem redação por dono: usuário logado vê o documento completo.

Permaneceram públicas apenas: /health, /ready, /info, /concepts e
/places/photo (proxy <img> — chave nunca sai do servidor desde 2026-08-18).
"""


def test_list_entities_requires_auth(client):
    """GET /entities sem credencial → 401 (antes era pública)."""
    response = client.get("/api/v3/entities")
    assert response.status_code == 401


def test_get_entity_requires_auth(client):
    """GET /entities/{id} sem credencial → 401 (antes do 404/200)."""
    response = client.get("/api/v3/entities/some_id")
    assert response.status_code == 401


def test_list_entities_with_auth_ok(client, auth_headers):
    """Com credencial, a leitura continua funcionando (sem redação)."""
    response = client.get("/api/v3/entities", headers=auth_headers)
    assert response.status_code == 200


def test_get_entity_with_auth_ok(client, auth_headers):
    """Com credencial, GET /entities/{id} segue o fluxo normal (200/404)."""
    response = client.get("/api/v3/entities/nonexistent_id", headers=auth_headers)
    assert response.status_code == 404


def test_entity_image_routes_continuam_curator(client):
    """Rotas de imagem não mudam: continuam exigindo curator (não regredir)."""
    response = client.get("/api/v3/entities/nonexistent_id/image")
    assert response.status_code == 401
