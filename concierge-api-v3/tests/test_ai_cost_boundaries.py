"""Paid AI endpoints must bound both request size and call frequency."""

import inspect

import pytest
from pydantic import ValidationError


def test_restaurant_name_extraction_text_is_bounded():
    from app.api.ai import RestaurantNameExtractionRequest

    RestaurantNameExtractionRequest(text="x" * 20_000)
    with pytest.raises(ValidationError):
        RestaurantNameExtractionRequest(text="x" * 20_001)


def test_restaurant_name_extraction_has_credential_scoped_rate_limit():
    import app.api.ai as ai_module

    source = inspect.getsource(ai_module)
    marker = '@limiter.limit("20/minute", key_func=auth_header_key)'
    route = source.index('@router.post("/extract-restaurant-name"')
    handler = source.index("async def extract_restaurant_name", route)
    assert marker in source[route:handler]
