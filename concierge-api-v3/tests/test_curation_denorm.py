"""Denorm de city/type deve ser tolerante aos shapes de entity (incl. strings legadas)."""

from app.services.curation_denorm import denormalize_curation_location


def test_structured_location_shape_wins():
    entity = {"type": "restaurant", "data": {"location": {"city": "São Paulo"}}}
    assert denormalize_curation_location(entity) == {"city": "São Paulo", "type": "restaurant"}


def test_dict_address_city_fallback():
    entity = {"type": "bar", "data": {"address": {"city": "Curitiba"}}}
    assert denormalize_curation_location(entity) == {"city": "Curitiba", "type": "bar"}


def test_string_address_does_not_crash_and_parses_br_pattern():
    # Shape legado: address completo em string única. Nunca pode quebrar o
    # PATCH da entity; quando o padrão "Cidade - UF" existe, extrai a cidade.
    entity = {
        "type": "restaurant",
        "data": {"address": "R. Oscar Freire, 533 - Jardins, São Paulo - SP, 01426-001"},
    }
    assert denormalize_curation_location(entity) == {"city": "São Paulo", "type": "restaurant"}


def test_string_address_without_city_pattern_returns_none():
    entity = {"type": "restaurant", "data": {"address": "123 Test Street"}}
    assert denormalize_curation_location(entity) == {"city": None, "type": "restaurant"}


def test_string_location_does_not_crash():
    entity = {"type": "restaurant", "data": {"location": "Somewhere"}}
    assert denormalize_curation_location(entity) == {"city": None, "type": "restaurant"}


def test_formatted_address_string_fallback():
    entity = {"type": "cafe", "data": {"formatted_address": "Av. Paulista, 100 - Bela Vista, São Paulo - SP"}}
    assert denormalize_curation_location(entity) == {"city": "São Paulo", "type": "cafe"}


def test_non_dict_entity_returns_none_projection():
    assert denormalize_curation_location(None) == {"city": None, "type": None}
