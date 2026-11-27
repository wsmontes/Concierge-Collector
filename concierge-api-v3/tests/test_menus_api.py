"""
File: test_menus_api.py
Purpose: the menu routes — GET brief (immediate, asks for a background refresh when missing/stale), GET
    raw excerpts for the chat, POST refresh (synchronous, curator), PATCH review (curator) — and the
    summary on the entity read.
Dependencies: app.api.menus over the in-memory database; the refresh deps are faked (no network, no model).
"""

import pytest

import app.api.menus as menus_api
from app.core.config import settings
from app.services import menu_service as service

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
                SITE
                + "cardapio": (
                    "text/html",
                    b"<p>Burrata 110,00</p><p>Fettuccine 260,00</p><p>Tiramisu 58,00</p>",
                ),
            }
            if url not in pages:
                return None
            return service.Fetched(url, *pages[url])

        class Synthesizer:
            async def synthesize(self, restaurant, address, context, documents):
                basis = [
                    {"item": "Burrata", "price_brl": 110, "document": 0},
                    {"item": "Fettuccine", "price_brl": 260, "document": 0},
                    {"item": "Tiramisu", "price_brl": 58, "document": 0},
                ]
                return {
                    "documents": [{"index": 0, "role": "dining_room", "note": None}],
                    "formats": ["a_la_carte"],
                    "per_person": {"lunch": None, "dinner": {"basis": basis, "fixed_price": False, "note": None}},
                    "executive_lunch_brl": None, "tasting_menus": [], "couvert_brl": None, "corkage_brl": None,
                    "wine": None, "dietary": [], "highlights": [], "caveats": [], "summary": "Casa italiana.",
                    "menu_date": None, "confidence": "high",
                }, "m"  # fmt: skip

        async def website_for(place_id):
            return None

        self.deps = service.MenuDeps(fetch, Synthesizer(), website_for)


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
    monkeypatch.setattr(service, "_budget", {"day": None, "used": 0})
    yield client, in_memory_db, fake
    client.app.dependency_overrides.pop(menus_api.get_menu_deps, None)


H = {"X-API-Key": API_KEY}


def test_refresh_reads_the_menu_and_the_entity_shows_its_summary(api):
    client, db, _ = api

    response = client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh", headers=H)

    assert response.status_code == 200
    body = response.json()
    assert body["brief"]["per_person_brl"]["dinner"] == 428 and body["status"] == "auto"
    assert "lease_until" not in body and "next_allowed_at" not in body
    assert body["documents"] and all("text" not in d for d in body["documents"])
    entity = client.get(f"/api/v3/entities/{ENTITY_ID}", headers=H).json()
    assert entity["menu_summary"]["per_person_brl"]["dinner"] == 428 and entity["version"] == 3


def test_get_answers_at_once_and_says_when_it_is_missing(api, monkeypatch):
    client, _, fake = api
    asked = []
    monkeypatch.setattr(
        service,
        "schedule_refresh",
        lambda db, entity: asked.append(entity["_id"]) or True,
    )

    missing = client.get(f"/api/v3/entities/{ENTITY_ID}/menu", headers=H).json()
    assert missing["status"] == "missing" and missing["refreshing"] is True and asked == [ENTITY_ID]
    assert fake.fetched == []  # the GET never scrapes itself

    client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh", headers=H)
    stored = client.get(f"/api/v3/entities/{ENTITY_ID}/menu", headers=H).json()
    assert stored["fresh"] is True and stored["brief"]["summary"] == "Casa italiana."


def test_text_returns_raw_excerpts_for_a_question(api):
    client, _, _ = api
    client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh", headers=H)

    body = client.get(f"/api/v3/entities/{ENTITY_ID}/menu/text", params={"q": "tiramisù"}, headers=H).json()

    assert body["matched"] is True and "Tiramisu 58,00" in body["excerpts"][0]["text"]
    assert client.get(f"/api/v3/entities/{ENTITY_ID}/menu/text").status_code == 401
    assert client.get(f"/api/v3/entities/{ENTITY_ID}/menu/text?max_chars=10", headers=H).status_code == 422


def test_resynthesize_rewrites_the_brief_without_the_network(api):
    client, _, fake = api
    client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh", headers=H)
    fake.fetched.clear()

    response = client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh?resynthesize=true", headers=H)

    assert response.status_code == 200 and fake.fetched == []


def test_review_confirms_and_corrects_the_numbers(api):
    client, _, _ = api
    client.post(f"/api/v3/entities/{ENTITY_ID}/menu/refresh", headers=H)

    response = client.patch(
        f"/api/v3/entities/{ENTITY_ID}/menu",
        headers=H,
        json={
            "status": "reviewed",
            "overrides": {"per_person_brl.dinner": 450},
            "note": "conferido no local",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "reviewed" and body["brief"]["per_person_brl"]["dinner"] == 450
    assert body["review"]["note"] == "conferido no local"


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "auto"},
        {"overrides": {"per_person_brl.dinner": "caro"}},
        {"add_sources": ["ftp://x"]},
    ],
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
        stored = client.get(f"/api/v3/entities/{ENTITY_ID}/menu", headers=H).json()
        if stored["status"] != "missing":
            break
    assert stored["status"] == "auto" and stored["brief"]["per_person_brl"]["dinner"] == 428


def test_text_refuses_an_unknown_topic(api):
    client, _, _ = api

    response = client.get(f"/api/v3/entities/{ENTITY_ID}/menu/text?topic=gossip", headers=H)

    assert response.status_code == 422


def _where_it_ran(seen):
    import asyncio

    try:
        asyncio.get_running_loop()
        seen.append("event_loop")
    except RuntimeError:
        seen.append("thread")


def test_menu_reads_run_off_the_event_loop(api, monkeypatch):
    """A synchronous Mongo read inside an async route stops the whole single-process server: every
    other request (the bot's /places/details) waits behind it. The reads go to the threadpool."""
    client, _, _ = api
    seen = []
    real_find = menus_api.find_entity
    monkeypatch.setattr(menus_api, "find_entity", lambda db, eid: _where_it_ran(seen) or real_find(db, eid))
    monkeypatch.setattr(service, "read_menu", lambda db, entity, **kw: _where_it_ran(seen) or {"status": "missing"})
    monkeypatch.setattr(service, "menu_text", lambda db, entity, **kw: _where_it_ran(seen) or {"status": "missing"})

    assert client.get(f"/api/v3/entities/{ENTITY_ID}/menu", headers=H).status_code == 200
    assert client.get(f"/api/v3/entities/{ENTITY_ID}/menu/text?q=ostra", headers=H).status_code == 200

    assert seen == ["thread"] * 4
