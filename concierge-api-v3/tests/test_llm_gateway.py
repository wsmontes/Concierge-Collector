"""Tests para o RBAC do LLM Gateway.

Achado #2 da auditoria de segurança 2026-08-18: /llm/search-restaurants e
/llm/get-restaurant-snapshot aceitavam QUALQUER papel (verify_auth) e
disparavam insert/update em `entities` (llm_place_service auto-cria/atualiza
entities a partir do Google). A regra da casa é: escrita em entities exige
no mínimo curator (POST /entities usa require_role("curator")).

O serviço é mockado NA CLASSE (patch.object em LLMPlaceService) — o
Depends(get_llm_service) bindeia a função no decorador e patch no módulo não
pega; sem mock, o teste dispara chamadas reais ao Google Places.
"""

from unittest.mock import patch

from app.core.security import create_access_token
from app.services.llm_place_service import LLMPlaceService


def _bearer(role: str) -> dict:
    token = create_access_token(data={"sub": f"{role}@example.com", "role": role})
    return {"Authorization": f"Bearer {token}"}


SNAPSHOT_OK = (
    {
        "place_id": "p1",
        "entity_id": None,
        "name": "Test",
        "canonical_address": "Rua X",
        "geo": None,
        "is_open_now": None,
        "open_on_weekend": None,
        "opening_hours": None,
        "status_block": None,
        "google_rating": None,
        "google_price_level": None,
        "google_types": [],
        "website": None,
        "phone": None,
        "michelin": None,
        "curations": [],
        "entity": None,
        "raw_sources": None,
    },
    ["google_places"],
)


class TestLlmToolsRequireAuth:
    """GET /llm/tools e /llm/tools-manifest não são mais públicos —
    expunham o schema interno das ferramentas do gateway (achado #9)."""

    def test_tools_sem_auth_401(self, client):
        resp = client.get("/api/v3/llm/tools")
        assert resp.status_code == 401

    def test_tools_manifest_sem_auth_401(self, client):
        resp = client.get("/api/v3/llm/tools-manifest")
        assert resp.status_code == 401

    def test_tools_com_api_key_ok(self, client, auth_headers):
        resp = client.get("/api/v3/llm/tools", headers=auth_headers)
        assert resp.status_code == 200
        assert "tools" in resp.json()

    def test_tools_manifest_com_api_key_ok(self, client, auth_headers):
        resp = client.get("/api/v3/llm/tools-manifest", headers=auth_headers)
        assert resp.status_code == 200

    def test_tools_com_jwt_viewer_ok(self, client):
        # leitura pura (sem escrita no Mongo) — verify_auth basta
        resp = client.get("/api/v3/llm/tools", headers=_bearer("viewer"))
        assert resp.status_code == 200


class TestLlmGatewayRoleGate:
    """POST /llm/search-restaurants e /llm/get-restaurant-snapshot exigem
    role >= curator (viewer não escreve em entities)."""

    def test_search_restaurants_viewer_rejected(self, client):
        with patch.object(LLMPlaceService, "search_restaurants", return_value=[]) as svc:
            resp = client.post(
                "/api/v3/llm/search-restaurants",
                json={"query": "Dom Manolo"},
                headers=_bearer("viewer"),
            )
        assert resp.status_code == 403
        # fronteira: serviço (que gravaria no Mongo) nunca é executado
        svc.assert_not_called()

    def test_search_restaurants_curator_allowed(self, client):
        with patch.object(LLMPlaceService, "search_restaurants", return_value=[]) as svc:
            resp = client.post(
                "/api/v3/llm/search-restaurants",
                json={"query": "Dom Manolo"},
                headers=_bearer("curator"),
            )
        assert resp.status_code == 200
        svc.assert_called_once()

    def test_search_restaurants_api_key_allowed(self, client, auth_headers):
        with patch.object(LLMPlaceService, "search_restaurants", return_value=[]) as svc:
            resp = client.post(
                "/api/v3/llm/search-restaurants",
                json={"query": "Dom Manolo"},
                headers=auth_headers,
            )
        assert resp.status_code == 200
        svc.assert_called_once()

    def test_snapshot_viewer_rejected(self, client):
        with patch.object(LLMPlaceService, "get_restaurant_snapshot", return_value=SNAPSHOT_OK) as svc:
            resp = client.post(
                "/api/v3/llm/get-restaurant-snapshot",
                json={"place_id": "places/x/photos/y"},
                headers=_bearer("viewer"),
            )
        assert resp.status_code == 403
        svc.assert_not_called()

    def test_snapshot_curator_allowed(self, client):
        with patch.object(LLMPlaceService, "get_restaurant_snapshot", return_value=SNAPSHOT_OK) as svc:
            resp = client.post(
                "/api/v3/llm/get-restaurant-snapshot",
                json={"place_id": "places/x/photos/y"},
                headers=_bearer("curator"),
            )
        assert resp.status_code == 200
        svc.assert_called_once()
