from app.services.curation_denorm import denormalize_curation_location


def test_denorm_extracts_city_and_type():
    entity = {"type": "bar", "data": {"location": {"city": "São Paulo"}}}
    assert denormalize_curation_location(entity) == {"city": "São Paulo", "type": "bar"}


def test_denorm_omits_missing():
    # type present, city missing → city=None
    assert denormalize_curation_location({"type": "restaurant", "data": {}}) == {"city": None, "type": "restaurant"}
    # both missing
    assert denormalize_curation_location({"data": {"location": {"city": ""}}}) == {"city": None, "type": None}
    # None input
    assert denormalize_curation_location(None) == {"city": None, "type": None}
