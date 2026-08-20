"""Google Places provider failures must use the public safe error contract."""

from unittest.mock import AsyncMock, patch


_SENTINEL = "provider-secret-body api-key=super-secret internal-host=10.0.0.5"


class _ProviderFailureResponse:
    status_code = 403
    text = _SENTINEL

    def json(self):
        return {"error": _SENTINEL}


class _FailingPlacesClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, *args, **kwargs):
        return _ProviderFailureResponse()

    async def post(self, *args, **kwargs):
        return _ProviderFailureResponse()


def test_single_orchestration_maps_provider_4xx_to_safe_502(client, auth_headers):
    with patch("app.api.places.httpx.AsyncClient", return_value=_FailingPlacesClient()):
        response = client.post(
            "/api/v3/places/orchestrate",
            json={"place_id": "ChIJ-secret"},
            headers=auth_headers,
        )

    assert response.status_code == 502
    assert _SENTINEL not in response.text


def test_bulk_details_200_partial_never_contains_provider_body(client, auth_headers):
    with patch("app.api.places.httpx.AsyncClient", return_value=_FailingPlacesClient()):
        response = client.post(
            "/api/v3/places/orchestrate",
            json={"place_ids": ["place-a", "place-b"]},
            headers=auth_headers,
        )

    assert response.status_code == 200
    assert _SENTINEL not in response.text
    errors = response.json()["errors"]
    assert len(errors) == 2
    assert all(error["code"] == "provider_error" for error in errors)
    assert all(error["status_code"] == 403 for error in errors)
    assert all(error["message"] == "Google Places request failed" for error in errors)


def test_bulk_multi_200_partial_never_contains_internal_exception(client, auth_headers):
    with patch("app.api.places.call_place_details", new=AsyncMock(side_effect=RuntimeError(_SENTINEL))):
        response = client.post(
            "/api/v3/places/orchestrate",
            json={"operations": [{"operation": "details", "place_id": "place-a"}]},
            headers=auth_headers,
        )

    assert response.status_code == 200
    assert _SENTINEL not in response.text
    error = response.json()["errors"][0]
    assert error["operation"] == "details"
    assert error["code"] == "dependency_error"
    assert error["message"] == "Places operation failed"
