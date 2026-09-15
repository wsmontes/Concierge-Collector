"""Entity image media on the CMS boundary, for the Admin Media & sources view.

The Admin renders the Entity thumbnail with the CMS service credential, so the
bytes must be reachable through ``/catalog/*`` and must come from the SAME
hardened pipeline the curator-facing route already uses. These tests pin the
four guarantees the UI and the boundary depend on:

1. the gallery lists boundary paths only — an origin URL or the provider key
   never reaches the payload;
2. the bytes carry the reencoded JPEG type and a cache policy safe for a
   credential-gated response;
3. rank is validated at the edge and a missing image is an honest 404 (or an
   empty gallery), not a broken ``<img>``;
4. the SSRF guard of the shared downloader still runs FIRST — a stored source
   that resolves to an internal address is refused without any network I/O.
"""

import httpx
import pytest

from app.core.config import settings
from app.models.catalog_media import (
    ENTITY_IMAGE_CACHE_TTL_SECONDS,
    ENTITY_IMAGES_MAX_ITEMS,
)
from app.services.restaurant_image_collector import CollectedImage

PATH = "/api/v3/catalog/entities"
ACTOR_ID = "cms-admin-test"


def _headers(actor: str | None = ACTOR_ID) -> dict[str, str]:
    headers = {"X-CMS-Service-Key": settings.cms_service_key_value}
    if actor is not None:
        headers["X-CMS-Actor-Id"] = actor
    return headers


def _seed_cms_admin(db) -> None:
    db.users.insert_one({"_id": ACTOR_ID, "email": f"{ACTOR_ID}@example.com", "authorized": True, "role": "admin"})


def _seed_entity(db, data: dict, entity_id: str = "e1") -> None:
    db.entities.insert_one({"_id": entity_id, "name": "Café Teste", "data": data})


def _image(source: str, marker: bytes, score: float = 70.0) -> CollectedImage:
    return CollectedImage(
        jpeg_bytes=marker,
        source=source,
        width=1600,
        height=1000,
        byte_size=len(marker),
        score=score,
        score_components={"source": score},
    )


def _patch_images(monkeypatch, images: list[CollectedImage], calls: dict | None = None):
    async def fake_images(page_url=None, place_id=None, *, limit=None):
        if calls is not None:
            calls.update(page_url=page_url, place_id=place_id, limit=limit)
        return images

    monkeypatch.setattr("app.api.catalog_media.get_restaurant_images", fake_images)


@pytest.mark.asyncio
async def test_gallery_lists_boundary_paths_in_rank_order(async_client, in_memory_db, monkeypatch):
    """Each item is a path on THIS boundary, ascending by rank, and the route
    asks the collector for no more than the ceiling it publishes."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_entity(in_memory_db, {"contact": {"website": "https://restaurante.example"}, "place_id": "ChIJ123"})
    calls: dict = {}
    _patch_images(
        monkeypatch,
        [_image("website_og", b"one", 72.5), _image("google_places", b"two", 68.0)],
        calls,
    )

    response = await async_client.get(f"{PATH}/e1/images", headers=_headers())

    assert response.status_code == 200, response.text
    assert response.json() == {
        "items": [
            {"rank": 0, "source": "website_og", "url": "/api/v3/catalog/entities/e1/image?rank=0"},
            {"rank": 1, "source": "google_places", "url": "/api/v3/catalog/entities/e1/image?rank=1"},
        ]
    }
    assert calls == {"page_url": "https://restaurante.example", "place_id": "ChIJ123", "limit": ENTITY_IMAGES_MAX_ITEMS}
    # The provider key and the origin URLs the collector used stay inside the API.
    assert "places.googleapis.com" not in response.text
    assert "key=" not in response.text


@pytest.mark.asyncio
async def test_gallery_never_grows_past_the_published_ceiling(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_entity(in_memory_db, {"place_id": "ChIJ123"})
    _patch_images(monkeypatch, [_image("website_og", b"x", 70.0) for _ in range(ENTITY_IMAGES_MAX_ITEMS + 4)])

    response = await async_client.get(f"{PATH}/e1/images", headers=_headers())

    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == ENTITY_IMAGES_MAX_ITEMS
    assert [item["rank"] for item in items] == list(range(ENTITY_IMAGES_MAX_ITEMS))


@pytest.mark.asyncio
async def test_gallery_is_empty_when_the_sources_have_no_usable_image(async_client, in_memory_db, monkeypatch):
    """A source that yields nothing is an empty gallery: the Admin renders its
    own honest "no image" state instead of failing the whole record view."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_entity(in_memory_db, {"place_id": "ChIJ123"})
    _patch_images(monkeypatch, [])

    response = await async_client.get(f"{PATH}/e1/images", headers=_headers())

    assert response.status_code == 200, response.text
    assert response.json() == {"items": []}


@pytest.mark.asyncio
async def test_entity_without_sources_and_unknown_entity_are_404(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_entity(in_memory_db, {"name": "sem contato"})

    async def never_called(**_kwargs):  # pragma: no cover - a missing source must not reach the collector
        raise AssertionError("coletor não deve ser chamado sem fonte de imagem")

    monkeypatch.setattr("app.api.catalog_media.get_restaurant_images", never_called)
    monkeypatch.setattr("app.api.catalog_media.get_og_image_bytes", never_called)

    no_source = await async_client.get(f"{PATH}/e1/images", headers=_headers())
    assert no_source.status_code == 404
    assert no_source.json()["detail"] == "entity sem website nem place_id (sem fonte de imagem)"

    unknown = await async_client.get(f"{PATH}/ghost/images", headers=_headers())
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "Entity ghost not found"

    unknown_bytes = await async_client.get(f"{PATH}/ghost/image", headers=_headers())
    assert unknown_bytes.status_code == 404


@pytest.mark.asyncio
async def test_image_bytes_are_the_reencoded_jpeg_with_a_private_short_ttl(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_entity(in_memory_db, {"contact": {"website": "https://restaurante.example"}, "place_id": "ChIJ123"})
    calls: dict = {}

    async def fake_hero(page_url=None, place_id=None):
        calls.update(page_url=page_url, place_id=place_id)
        return (b"\xff\xd8\xff\xe0 jpeg", "image/jpeg")

    async def ranked_never_called(**_kwargs):  # pragma: no cover - rank 0 keeps the hero path
        raise AssertionError("rank 0 deve usar o caminho hero")

    monkeypatch.setattr("app.api.catalog_media.get_og_image_bytes", fake_hero)
    monkeypatch.setattr("app.api.catalog_media.get_restaurant_image_bytes", ranked_never_called)

    response = await async_client.get(f"{PATH}/e1/image", headers=_headers())

    assert response.status_code == 200, response.text
    assert response.content == b"\xff\xd8\xff\xe0 jpeg"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == f"private, max-age={ENTITY_IMAGE_CACHE_TTL_SECONDS}"
    assert calls == {"page_url": "https://restaurante.example", "place_id": "ChIJ123"}


@pytest.mark.asyncio
async def test_ranked_bytes_use_the_ranked_collector_and_missing_rank_is_404(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_entity(in_memory_db, {"place_id": "ChIJ123"})
    calls: dict = {}

    async def fake_ranked(page_url=None, place_id=None, *, rank=None):
        calls.update(page_url=page_url, place_id=place_id, rank=rank)
        return (b"\xff\xd8\xff ranked", "image/jpeg") if rank == 3 else None

    async def hero_never_called(**_kwargs):  # pragma: no cover - ranks > 0 must not take the hero path
        raise AssertionError("apenas rank 0 usa o caminho hero")

    monkeypatch.setattr("app.api.catalog_media.get_og_image_bytes", hero_never_called)
    monkeypatch.setattr("app.api.catalog_media.get_restaurant_image_bytes", fake_ranked)

    served = await async_client.get(f"{PATH}/e1/image", params={"rank": 3}, headers=_headers())
    assert served.status_code == 200, served.text
    assert served.content == b"\xff\xd8\xff ranked"
    assert served.headers["content-type"] == "image/jpeg"
    assert calls == {"page_url": None, "place_id": "ChIJ123", "rank": 3}

    missing = await async_client.get(f"{PATH}/e1/image", params={"rank": 5}, headers=_headers())
    assert missing.status_code == 404
    assert missing.json()["detail"] == "imagem não encontrada (og:image e Places sem resultado)"


@pytest.mark.asyncio
async def test_rank_outside_the_published_range_is_rejected(async_client, in_memory_db):
    """Rank is validated at the edge: the collector is never asked for a rank it
    cannot produce, and the caller learns the bound from a 422."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_entity(in_memory_db, {"place_id": "ChIJ123"})

    too_high = await async_client.get(f"{PATH}/e1/image", params={"rank": ENTITY_IMAGES_MAX_ITEMS}, headers=_headers())
    assert too_high.status_code == 422

    negative = await async_client.get(f"{PATH}/e1/image", params={"rank": -1}, headers=_headers())
    assert negative.status_code == 422


@pytest.mark.asyncio
async def test_requires_the_service_credential_and_a_live_admin_actor(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_entity(in_memory_db, {"place_id": "ChIJ123"})
    in_memory_db.users.insert_one(
        {"_id": "curator-1", "email": "curator-1@example.com", "authorized": True, "role": "curator"}
    )

    for path in (f"{PATH}/e1/images", f"{PATH}/e1/image"):
        no_actor = await async_client.get(path, headers=_headers(actor=None))
        assert no_actor.status_code == 401
        assert no_actor.json()["detail"] == "CMS actor is required"

        bad_key = await async_client.get(
            path, headers={"X-CMS-Service-Key": "not-the-cms-key", "X-CMS-Actor-Id": ACTOR_ID}
        )
        assert bad_key.status_code == 401
        assert bad_key.json()["detail"] == "Invalid CMS service credential"

        unknown_actor = await async_client.get(path, headers=_headers(actor="ghost"))
        assert unknown_actor.status_code == 401
        assert unknown_actor.json()["detail"] == "CMS actor was not found"

        unprivileged = await async_client.get(path, headers=_headers(actor="curator-1"))
        assert unprivileged.status_code == 403
        assert unprivileged.json()["detail"] == "CMS admin access is required"


@pytest.mark.asyncio
async def test_internal_source_is_refused_without_any_network_call(async_client, in_memory_db, monkeypatch):
    """The stored source resolves to loopback, so the SHARED SSRF guard must
    refuse it before httpx reaches its transport. Patching the transport to
    explode proves no byte was ever requested."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_entity(in_memory_db, {"contact": {"website": "http://127.0.0.1:8080/private"}})

    async def forbidden_transport(self, request):  # pragma: no cover - the guard must win the race
        raise AssertionError(f"requisição saiu para {request.url}")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", forbidden_transport)

    for path in (f"{PATH}/e1/image", f"{PATH}/e1/images"):
        response = await async_client.get(path, headers=_headers())
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "destino de imagem não permitido (rede interna)"
