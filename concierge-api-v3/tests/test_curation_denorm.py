from app.services.curation_denorm import (
    city_from_address_string,
    denormalize_curation_location,
)


def test_denorm_extracts_city_and_type():
    entity = {"type": "bar", "data": {"location": {"city": "São Paulo"}}}
    assert denormalize_curation_location(entity) == {"city": "São Paulo", "type": "bar"}


def test_denorm_omits_missing():
    # type present, city missing → city=None
    assert denormalize_curation_location({"type": "restaurant", "data": {}}) == {
        "city": None,
        "type": "restaurant",
    }
    # both missing
    assert denormalize_curation_location({"data": {"location": {"city": ""}}}) == {
        "city": None,
        "type": None,
    }
    # None input
    assert denormalize_curation_location(None) == {"city": None, "type": None}


def test_denorm_city_falls_back_to_address_city():
    # shape v3 (Google Places): location sem city, address.city preenchido
    entity = {"type": "restaurant", "data": {"location": {"coordinates": [1, 2]}, "address": {"city": "Victoria"}}}
    assert denormalize_curation_location(entity) == {"city": "Victoria", "type": "restaurant"}


def test_denorm_city_parses_address_street():
    # shape v3 com address.city vazio: cidade dentro da string do street
    entity = {
        "type": "restaurant",
        "data": {
            "location": {"coordinates": [1, 2]},
            "address": {"city": "", "street": "R. Oscar Freire, 533 - Jardins, São Paulo - SP, 01426-001, Brazil"},
        },
    }
    assert denormalize_curation_location(entity) == {"city": "São Paulo", "type": "restaurant"}


def test_denorm_city_parses_formatted_address():
    # fallback final: só formatted_address disponível
    entity = {
        "data": {"formatted_address": "Av. Atlântica, 1020 - Copacabana, Rio de Janeiro - RJ, 22010-000, Brazil"},
    }
    assert denormalize_curation_location(entity) == {"city": "Rio de Janeiro", "type": None}


def test_denorm_location_city_has_priority_over_address():
    # se location.city existe, ele vence mesmo com address presente
    entity = {"data": {"location": {"city": "São Paulo"}, "address": {"city": "Victoria"}}}
    assert denormalize_curation_location(entity) == {"city": "São Paulo", "type": None}


def test_city_from_address_string_br_pattern():
    assert city_from_address_string("Rua X, 10 - Pinheiros, São Paulo - SP, Brazil") == "São Paulo"
    assert city_from_address_string("Rua Y, 3 - Centro, Niterói - RJ") == "Niterói"
    assert city_from_address_string("Rua Z, 1 - Bairro, Belo Horizonte - MG, 30110-001, Brazil") == "Belo Horizonte"


def test_city_from_address_string_rejects_non_br_and_garbage():
    # formato não brasileiro: sem risco de cidade errada → None
    assert city_from_address_string("944 Fort St, Victoria, BC V8V 1X1, Canada") is None
    assert city_from_address_string("") is None
    assert city_from_address_string(None) is None
    assert city_from_address_string(123) is None
