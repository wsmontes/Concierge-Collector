"""
Test Google Places API endpoints
"""

import pytest


@pytest.mark.external_api
class TestPlacesEndpoints:
    """Test Google Places integration"""

    def test_nearby_search_missing_params(self, client, auth_headers):
        """Test nearby search without required params"""
        response = client.get("/api/v3/places/nearby", headers=auth_headers)

        assert response.status_code == 422  # Missing required params

    def test_nearby_search_with_location(self, client, auth_headers):
        """Test nearby search with location"""
        response = client.get(
            "/api/v3/places/nearby?latitude=-23.5505&longitude=-46.6333&radius=1000",
            headers=auth_headers,
        )

        # May succeed when API key/provider are configured; otherwise returns integration errors
        assert response.status_code in [200, 500, 502]

    def test_get_place_details_missing_id(self, client):
        """Test getting place details without place_id"""
        response = client.get("/api/v3/places/details/")

        assert response.status_code == 404

    def test_get_place_details_invalid_id(self, client, auth_headers):
        """Test getting place details with invalid ID"""
        response = client.get("/api/v3/places/details/invalid_id", headers=auth_headers)

        # Expect 502 (Places API invalid field error)
        assert response.status_code == 502

    def test_nearby_search_requires_auth(self, client):
        """Nearby busca em API paga do Google — sem auth, 401 (não 422)."""
        response = client.get("/api/v3/places/nearby?latitude=-23.5505&longitude=-46.6333&radius=1000")
        assert response.status_code == 401


@pytest.mark.external_api
class TestPlacesValidation:
    """Test Places API input validation"""

    def test_nearby_search_invalid_radius(self, client, auth_headers):
        """Test nearby search with invalid radius"""
        response = client.get(
            "/api/v3/places/nearby?latitude=-23.5505&longitude=-46.6333&radius=-1",
            headers=auth_headers,
        )

        assert response.status_code in [400, 422]

    def test_nearby_search_invalid_coordinates(self, client, auth_headers):
        """Test nearby search with invalid coordinates"""
        response = client.get(
            "/api/v3/places/nearby?latitude=invalid&longitude=invalid&radius=1000",
            headers=auth_headers,
        )

        assert response.status_code in [400, 422]


class _FakeUpstream:
    """Fake da resposta do Google para os testes do proxy stream."""

    def __init__(self, status_code=200, content=b"\xff\xd8\xffFAKEJPEG", content_type="image/jpeg"):
        self.status_code = status_code
        self._content = content
        self.headers = {"content-type": content_type}
        self.closed = False

    async def aiter_bytes(self, chunk_size=65536):
        yield self._content

    async def aclose(self):
        self.closed = True


class _FakePhotoClient:
    """Fake do httpx.AsyncClient usado pelo proxy — captura a requisição
    upstream para assertar que a chave fica SERVER-SIDE."""

    def __init__(self, *a, **k):
        self.upstream = _FakeUpstream()
        self.error = None
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        pass

    async def get(self, url, params=None):
        if self.error:
            raise self.error
        self.url = url
        self.params = dict(params or [])
        return self.upstream

    async def aclose(self):
        self.closed = True


class TestPhotoProxy:
    """Proxy de fotos /places/photo — sem autenticação DE PROPÓSITO (a tag
    <img> não carrega headers), protegido por validação do reference e rate
    limit.

    Desde 2026-08-18 (achado #1 da auditoria): a foto é baixada SERVER-SIDE
    e devolvida em streaming — a chave do Google NUNCA sai do servidor.
    Antes, o 302 carregava `key=` no Location, legível por qualquer um com
    curl."""

    def test_photo_proxy_rejects_invalid_reference(self, client):
        """Reference fora do formato places/<id>/photos/<id> é rejeitado —
        sem isso seria SSRF/open-redirect com a chave anexada."""
        response = client.get(
            "/api/v3/places/photo",
            params={"reference": "https://evil.example.com/steal"},
        )
        assert response.status_code == 400

    def test_photo_proxy_requires_reference(self, client):
        response = client.get("/api/v3/places/photo")
        assert response.status_code == 422

    def test_photo_proxy_streams_bytes_e_nunca_expõe_a_chave(self, client):
        """200 com os bytes da foto; a chave só existe na requisição
        server-side para o Google — não há 302/Location, e o body não
        contém a chave."""
        from unittest.mock import patch
        from app.core.config import settings

        fake_client = _FakePhotoClient()
        with patch("app.api.places.httpx.AsyncClient", return_value=fake_client):
            response = client.get(
                "/api/v3/places/photo",
                params={
                    "reference": "places/ChIJ-test/photos/AU-c0ffe",
                    "max_width": 800,
                },
            )

        assert response.status_code == 200
        assert response.content == b"\xff\xd8\xffFAKEJPEG"
        assert response.headers["content-type"] == "image/jpeg"
        # a chave não aparece em NENHUM lugar da resposta (nada de Location)
        assert "location" not in response.headers
        assert settings.google_places_api_key.encode() not in response.content
        # ...mas segue indo na requisição upstream, montada aqui no servidor
        assert fake_client.url.startswith("https://places.googleapis.com/v1/places/ChIJ-test/photos/AU-c0ffe/media")
        assert fake_client.params["key"] == settings.google_places_api_key
        assert fake_client.params["maxWidthPx"] == 800

    def test_photo_proxy_adds_default_max_width_upstream(self, client):
        """Regressão: a API moderna do Google REJEITA a URL de foto sem
        maxWidthPx/maxHeightPx — o default agora é aplicado na requisição
        server-side (antes era no alvo do 302)."""
        from unittest.mock import patch

        fake_client = _FakePhotoClient()
        with patch("app.api.places.httpx.AsyncClient", return_value=fake_client):
            response = client.get(
                "/api/v3/places/photo",
                params={"reference": "places/ChIJ-test/photos/AU-c0ffe"},
            )

        assert response.status_code == 200
        assert fake_client.params["maxWidthPx"] == 1200

    def test_photo_proxy_upstream_404_vira_404(self, client):
        from unittest.mock import patch

        fake_client = _FakePhotoClient()
        fake_client.upstream = _FakeUpstream(status_code=404)
        with patch("app.api.places.httpx.AsyncClient", return_value=fake_client):
            response = client.get(
                "/api/v3/places/photo",
                params={"reference": "places/ChIJ-test/photos/AU-c0ffe"},
            )
        assert response.status_code == 404

    def test_photo_proxy_upstream_erro_vira_502(self, client):
        from unittest.mock import patch

        import httpx as _httpx

        fake_client = _FakePhotoClient()
        fake_client.error = _httpx.ConnectError("boom")
        with patch("app.api.places.httpx.AsyncClient", return_value=fake_client):
            response = client.get(
                "/api/v3/places/photo",
                params={"reference": "places/ChIJ-test/photos/AU-c0ffe"},
            )
        assert response.status_code == 502


def test_orchestrate_place_ids_max_20(client, in_memory_db):
    """Fan-out de custo: 1 request do concierge não pode gerar 500 chamadas
    Google — place_ids limita a 20 (auditoria ago/2026)."""
    from app.core.security import create_access_token

    # require_role("viewer") revalida o usuário vivo no Mongo — sem o seed,
    # o JWT válido recebe 401 'User not found' antes da validação do schema.
    in_memory_db.users.delete_many({"email": "t@x.com"})
    in_memory_db.users.insert_one({"_id": "user-t", "email": "t@x.com", "authorized": True, "role": "curator"})
    token = create_access_token(data={"sub": "t@x.com", "role": "curator"})
    r = client.post(
        "/api/v3/places/orchestrate",
        json={"place_ids": [f"pid_{i}" for i in range(21)]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


def test_orchestrate_operations_max_10(client, in_memory_db):
    """operations limita a 10 itens no schema."""
    from app.core.security import create_access_token

    in_memory_db.users.delete_many({"email": "t@x.com"})
    in_memory_db.users.insert_one({"_id": "user-t", "email": "t@x.com", "authorized": True, "role": "curator"})
    token = create_access_token(data={"sub": "t@x.com", "role": "curator"})
    r = client.post(
        "/api/v3/places/orchestrate",
        json={"operations": [{"action": "details", "place_id": f"p{i}"} for i in range(11)]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422
