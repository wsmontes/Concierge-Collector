"""
File: test_menus_api.py
Purpose: the menu routes — GET (immediate, asks for a background refresh when missing/stale), POST refresh
    (synchronous, curator), PATCH review (curator) — and the summary on the entity read.
Dependencies: app.api.menus over the in-memory database; the refresh deps are faked (no network, no model).
"""

import pytest

import app.api.menus as menus_api
from app.core.config import settings
from app.services import menu_service as service
from app.services.menu_extraction import ExtractionResult

API_KEY = "test-menus-key"
SITE = "https://casa.example/"
ENTITY_ID = "entity_ChIJmenusapi"


class _Deps:
    def __init__(self):
        self.fetched = []

        async def fetch(url):
            self.fetched.append(url)
            pages = {
                SITE: ("text/html", b'<a href="/cardapio">Card\xc3\xa1pio</a>'),
                SITE + "cardapio": ("text/html", b"<p>Burrata 110,00</p><p>Fettuccine 260,00</p><p>Tiramisu 58,00</p>"),
            }
            if url not in pages:
                return None
            return service.Fetched(url, *pages[url])

        class Extractor:
            async def extract(self, restaurant, address, texts):
                return ExtractionResult(
                    True,
                    [
                        {"section": "starter", "name": "Burrata", "price_brl": 110.0, "prices": [], "tags": []},
                        {"section": "main", "name": "Fettuccine", "price_brl": 260.0, "prices": [], "tags": []},
                        {"section": "dessert", "name": "Tiramisu", "price_brl": 58.0, "prices": [], "tags": []},
                    ],
                    model="m",
                )

        async def website_for(place_id):
            return None

        self.deps = service.MenuDeps(fetch, Extractor(), website_for)


@pytest.fixture
def api(client, in_memory_db, monkeypatch):
    monkeypatch.setattr(settings, "admin_api_keys", API_KEY)
    in_memory_db.entities.delete_many({"_id": ENTITY_ID})
    in_memory_db.entity_menus.delete_many({"_id": ENTITY_ID})
    in_memory_db.entities.insert_one(
        {
            "_id": ENTITY_ID,
            "entity_id": ENTITY_ID,
            "type": "restaurant",
            "name": "Casa",
            "status": "active",
            "version": 3,
            "data": {"website": SITE},
        }
    )
    fake = _Deps()
    client.app.dependency_overrides[menus_api.get_menu_deps] = lambda: fake.deps
    service._running.clear()
    yield client, in_memory_db, fake
    client.app.dependency_overrides.pop(menus_api.get_menu_deps, None)


H = {"X-API-Key": API_KEY}


def test_refresh_reads_the_menu_and_the_entity_shows_its_summary(api):
    client, db, _ = api

    response = client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh", headers=H)

    assert response.status_code == 200
    body = response.json()
    assert body["derived"]["per_person_brl"]["dinner"] == 428 and body["status"] == "auto"
    assert "lease_until" not in body and "next_allowed_at" not in body
    entity = client.get(f"/api/v3/entities/{ENTITY_ID}", headers=H).json()
    assert entity["menu_summary"]["per_person_brl"]["dinner"] == 428 and entity["version"] == 3


def test_get_answers_at_once_and_says_when_it_is_missing(api, monkeypatch):
    client, _, fake = api
    asked = []
    monkeypatch.setattr(service, "schedule_refresh", lambda db, entity: asked.append(entity["_id"]) or True)

    missing = client.get(f"/api/v3/entities/{ENTITY_ID}/menu", headers=H).json()
    assert missing["status"] == "missing" and missing["refreshing"] is True and asked == [ENTITY_ID]
    assert fake.fetched == []  # the GET never scrapes itself

    client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh", headers=H)
    stored = client.get(f"/api/v3/entities/{ENTITY_ID}/menu?items=1", headers=H).json()
    assert stored["fresh"] is True and len(stored["items"]) == 1


def test_review_confirms_and_corrects_the_numbers(api):
    client, _, _ = api
    client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh", headers=H)

    response = client.patch(
        f"/api/v3/entities/{ENTITY_ID}/menu",
        headers=H,
        json={"status": "reviewed", "overrides": {"per_person_brl.dinner": 450}, "note": "conferido no local"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "reviewed" and body["derived"]["per_person_brl"]["dinner"] == 450
    assert body["review"]["note"] == "conferido no local"


@pytest.mark.parametrize(
    "payload",
    [{"status": "auto"}, {"overrides": {"per_person_brl.dinner": "caro"}}, {"add_sources": ["ftp://x"]}],
    ids=["status-not-a-review", "override-not-a-number", "source-not-http"],
)
def test_invalid_reviews_are_refused(api, payload):
    client, _, _ = api
    client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh", headers=H)

    assert client.patch(f"/api/v3/entities/{ENTITY_ID}/menu", headers=H, json=payload).status_code == 422


def test_unknown_entity_and_missing_auth(api):
    client, _, _ = api

    assert client.get("/api/v3/entities/entity_nope/menu", headers=H).status_code == 404
    assert client.post("/api/v3/entities/entity_nope/menu/refresh", headers=H).status_code == 404
    assert client.get(f"/api/v3/entities/{ENTITY_ID}/menu").status_code == 401
    assert client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh").status_code == 401


def test_a_missing_menu_is_really_refreshed_in_the_background(api, monkeypatch):
    client, db, fake = api
    monkeypatch.setattr(settings, "menu_enrich_enabled", True)
    monkeypatch.setattr(service, "_dispatched", {})
    service.set_background_deps(fake.deps)

    first = client.get(f"/api/v3/entities/{ENTITY_ID}/menu", headers=H).json()
    assert first["refreshing"] is True

    for _ in range(50):  # the background task runs on the app's loop
        stored = client.get(f"/api/v3/entities/{ENTITY_ID}/menu?items=0", headers=H).json()
        if stored["status"] != "missing":
            break
    assert stored["status"] == "auto" and stored["derived"]["per_person_brl"]["dinner"] == 428
