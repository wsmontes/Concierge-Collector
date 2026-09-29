"""Provider-backed routes must charge quota to stable authenticated identity.

The unauthenticated Places photo proxy is the intentional exception: <img> tags
cannot send the app's auth header, so that public byte proxy remains IP-keyed.
"""

import inspect

import app.api.llm_gateway as llm_gateway
import app.api.places as places


def _decorator_window(module, route_marker: str, handler_marker: str) -> str:
    source = inspect.getsource(module)
    route = source.index(route_marker)
    handler = source.index(handler_marker, route)
    return source[route:handler]


def test_authenticated_places_routes_use_stable_auth_bucket():
    cases = [
        ('@router.get("/nearby"', "async def search_nearby"),
        ('@router.get("/details/{place_id}"', "async def get_place_details"),
        ('@router.get("/{place_id}/photos"', "async def get_place_photos"),
        ('@router.post("/orchestrate"', "async def orchestrate_places_request"),
    ]
    for route, handler in cases:
        block = _decorator_window(places, route, handler)
        assert 'key_func=auth_header_key' in block, route


def test_public_places_photo_proxy_stays_ip_keyed():
    block = _decorator_window(places, '@router.get("/photo"', "async def proxy_place_photo")
    assert '@limiter.limit("60/minute")' in block
    assert "key_func=auth_header_key" not in block


def test_authenticated_llm_gateway_routes_use_stable_auth_bucket():
    cases = [
        ('@router.post("/search-restaurants"', "def search_restaurants"),
        ('@router.post("/get-restaurant-snapshot"', "def get_restaurant_snapshot"),
        ('@router.post("/get-restaurant-availability"', "def get_restaurant_availability"),
    ]
    for route, handler in cases:
        block = _decorator_window(llm_gateway, route, handler)
        assert 'key_func=auth_header_key' in block, route
