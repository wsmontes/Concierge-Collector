"""
Testes de controle de acesso nas leituras de curations (login-gate).

Decisão 2026-08-15 (code review externo, achado #4): curadorias são IP
interna — todas as rotas de leitura exigem autenticação (verify_auth), mas
SEM redação por dono: usuário logado vê o documento completo (zero mudança
de payload, zero impacto no sync offline-first).

Permaneceram públicas apenas as rotas sem PII: /entities, /places/photo
(proxy <img>), /health e /info.
"""


def test_search_curations_requires_auth(client):
    """GET /curations/search sem credencial → 401 (antes era pública)."""
    response = client.get("/api/v3/curations/search")
    assert response.status_code == 401


def test_list_cities_requires_auth(client):
    """GET /curations/cities sem credencial → 401."""
    response = client.get("/api/v3/curations/cities")
    assert response.status_code == 401


def test_get_entity_curations_requires_auth(client):
    """GET /curations/entities/{id}/curations sem credencial → 401 (antes do 404)."""
    response = client.get("/api/v3/curations/entities/some_entity/curations")
    assert response.status_code == 401


def test_get_curation_requires_auth(client):
    """GET /curations/{id} sem credencial → 401 (antes do 404)."""
    response = client.get("/api/v3/curations/some_id")
    assert response.status_code == 401


def test_semantic_search_requires_auth(client):
    """POST /curations/semantic-search sem credencial → 401 (não gera embedding pago)."""
    response = client.post("/api/v3/curations/semantic-search", json={"query": "japonesa"})
    assert response.status_code == 401


def test_hybrid_search_requires_auth(client):
    """POST /curations/hybrid-search sem credencial → 401."""
    response = client.post("/api/v3/curations/hybrid-search", json={"query": "japonesa"})
    assert response.status_code == 401


def test_search_curations_with_auth_ok(client, auth_headers):
    """Com credencial, a leitura continua funcionando (login-gate sem redação)."""
    response = client.get("/api/v3/curations/search", headers=auth_headers)
    assert response.status_code == 200
