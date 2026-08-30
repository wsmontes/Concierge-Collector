"""Testes puros do LLMPlaceService — field mask e extração de cidade.

Sem MongoDB: cobre apenas as partes determinísticas do módulo
(constante do field mask e _extract_city_from_google_data), que é onde
mora a lógica de cidade estruturada para entities criadas via Google Places.
"""

from app.services.llm_place_service import (
    PLACES_DETAILS_FIELD_MASK,
    _extract_city_from_google_data,
)


def test_field_mask_includes_address_components():
    # addressComponents alimenta a extração de cidade estruturada
    assert "addressComponents" in PLACES_DETAILS_FIELD_MASK
    for essential in ("id", "displayName", "formattedAddress", "location", "rating"):
        assert essential in PLACES_DETAILS_FIELD_MASK


def test_extract_city_from_address_components_locality():
    data = {
        "addressComponents": [
            {"types": ["country"], "longText": "Brazil", "shortText": "BR"},
            {"types": ["locality"], "longText": "São Paulo", "shortText": "São Paulo"},
        ],
    }
    assert _extract_city_from_google_data(data) == "São Paulo"


def test_extract_city_falls_back_to_admin_area_level_2():
    # sem locality, administrative_area_level_2 resolve (cidades sem município)
    data = {
        "addressComponents": [
            {"types": ["administrative_area_level_2"], "longText": "Victoria", "shortText": "Victoria"},
        ],
    }
    assert _extract_city_from_google_data(data) == "Victoria"


def test_extract_city_prefers_long_text_over_short():
    data = {
        "addressComponents": [
            {"types": ["locality"], "longText": "", "shortText": "Niterói"},
        ],
    }
    assert _extract_city_from_google_data(data) == "Niterói"


def test_extract_city_parses_formatted_address_fallback():
    data = {"formattedAddress": "Rua Haddock Lobo, 354 - Cerqueira César, São Paulo - SP, 01414-000, Brazil"}
    assert _extract_city_from_google_data(data) == "São Paulo"


def test_extract_city_returns_none_without_signals():
    assert _extract_city_from_google_data({}) is None
    assert _extract_city_from_google_data({"addressComponents": [{"types": ["country"], "longText": "Brazil"}]}) is None
    assert _extract_city_from_google_data({"formattedAddress": "944 Fort St, Victoria, BC V8V 1X1, Canada"}) is None
