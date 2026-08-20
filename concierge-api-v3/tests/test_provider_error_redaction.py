"""Unexpected provider/internal errors must never be reflected to API clients."""

from unittest.mock import patch


_SENTINEL = "mongodb://internal-user:super-secret@private-host/concierge"


class _ExplodingEmbeddings:
    def create(self, *args, **kwargs):
        raise RuntimeError(_SENTINEL)


class _ExplodingOpenAI:
    def __init__(self, *args, **kwargs):
        self.embeddings = _ExplodingEmbeddings()


def test_semantic_search_does_not_reflect_openai_exception(client, auth_headers):
    with patch("app.api.curations.OpenAI", _ExplodingOpenAI):
        response = client.post(
            "/api/v3/curations/semantic-search",
            json={"query": "romantic dinner", "limit": 5},
            headers=auth_headers,
        )

    assert response.status_code == 500
    assert _SENTINEL not in response.text


def test_hybrid_search_does_not_reflect_openai_exception(client, auth_headers):
    with patch("app.api.curations.OpenAI", _ExplodingOpenAI):
        response = client.post(
            "/api/v3/curations/hybrid-search",
            json={"query": "romantic dinner", "limit": 5},
            headers=auth_headers,
        )

    assert response.status_code == 500
    assert _SENTINEL not in response.text


def test_place_photos_does_not_reflect_internal_exception(client, auth_headers):
    from app.services.llm_place_service import LLMPlaceService

    with patch.object(LLMPlaceService, "get_restaurant_photos", side_effect=RuntimeError(_SENTINEL)):
        response = client.get(
            "/api/v3/places/ChIJ-test/photos",
            headers=auth_headers,
        )

    assert response.status_code == 500
    assert _SENTINEL not in response.text


def test_places_orchestrate_does_not_reflect_unexpected_exception(client, auth_headers):
    with patch("app.api.places.determine_operation", side_effect=RuntimeError(_SENTINEL)):
        response = client.post(
            "/api/v3/places/orchestrate",
            json={"query": "pizza"},
            headers=auth_headers,
        )

    assert response.status_code == 500
    assert _SENTINEL not in response.text
