"""
Test Google Places API endpoints
"""

import pytest


@pytest.mark.external_api
class TestPlacesEndpoints:
    """Test Google Places integration"""

    def test_places_health_check(self, client):
        """Test Places API health endpoint"""
        response = client.get("/api/v3/places/health")

        assert response.status_code == 200
        data = response.json()
        assert "status" in data

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


class TestPhotoProxy:
    """Proxy de fotos /places/photo — sem autenticação DE PROPÓSITO (a tag
    <img> não carrega headers), protegido por validação do reference e rate
    limit. A chave da API Google é anexada server-side no 302 — nunca aparece
    nas URLs armazenadas nem nos payloads das respostas."""

    def test_photo_proxy_rejects_invalid_reference(self, client):
        """Reference fora do formato places/<id>/photos/<id> é rejeitado —
        sem isso seria open-redirect com a chave anexada."""
        response = client.get(
            "/api/v3/places/photo",
            params={"reference": "https://evil.example.com/steal"},
        )
        assert response.status_code == 400

    def test_photo_proxy_requires_reference(self, client):
        response = client.get("/api/v3/places/photo")
        assert response.status_code == 422

    def test_photo_proxy_redirects_with_key_server_side(self, client):
        """302 para o Google com a chave no query — NÃO seguimos o redirect
        (follow_redirects=False): o teste não pode chamar a API paga."""
        response = client.get(
            "/api/v3/places/photo",
            params={
                "reference": "places/ChIJ-test/photos/AU-c0ffe",
                "max_width": 800,
            },
            follow_redirects=False,
        )
        assert response.status_code == 302
        location = response.headers["location"]
        assert location.startswith("https://places.googleapis.com/v1/places/ChIJ-test/photos/AU-c0ffe/media?")
        assert "key=" in location
        assert "maxWidthPx=800" in location

    def test_photo_proxy_adds_default_max_width(self, client):
        """Regressão: a API moderna do Google REJEITA a URL de foto sem
        maxWidthPx/maxHeightPx ('At least one of max_height_px or max_width_px
        must be specified') — sem o default, o alvo do 302 sempre dava 400,
        quebrando <img> no browser E o download server-side do analyze_image."""
        response = client.get(
            "/api/v3/places/photo",
            params={"reference": "places/ChIJ-test/photos/AU-c0ffe"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        location = response.headers["location"]
        assert "maxWidthPx=1200" in location
