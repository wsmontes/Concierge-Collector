"""
File: test_menu_service.py
Purpose: refreshing an entity's menu end to end — site, every menu document, extraction, derived numbers,
    what is kept between refreshes, review — with the network, the model and Google faked.
Dependencies: app.services.menu_service, tests.conftest.InMemoryDatabase.

The full menu lives in `entity_menus`; the entity only gets a compact `menu_summary` through a field
$set (its `version` never moves, so the offline Collector sees no conflict). A document whose text did
not change is not read again by the model. A curator's review is never overwritten: a real change marks
it for review again.
"""

import datetime as dt

import pytest

from app.services import menu_service as service
from app.services.menu_extraction import ExtractionResult
from tests.conftest import InMemoryDatabase

SITE = "https://picchi.example/"
HOME = (
    b'<a href="/cardapio.pdf">Card\xc3\xa1pio</a> <a href="/vinhos">Carta de vinhos</a>'
    b' <a href="/reservas">Reservas</a>'
)
FOOD_TEXT = "Fettuccine 260,00\nPolvo 220,00\nTiramisu 58,00\nBurrata 110,00"
WINE_TEXT = "<p>Barolo taça 89,00 garrafa 690,00</p><p>Chianti 420,00</p><p>Prosecco 70,00</p>"


def dish(name, price, section="main", **extra):
    return {
        "section": section,
        "subsection": None,
        "name": name,
        "description": None,
        "price_brl": price,
        "prices": [],
        "tags": [],
        "meal": "all",
        "wine": None,
        **extra,
    }


FOOD_ITEMS = [
    dish("Burrata", 110, "starter"),
    dish("Fettuccine", 260),
    dish("Polvo", 220),
    dish("Tiramisu", 58, "dessert"),
]
WINE_ITEMS = [dish("Chianti", 420, "drink", wine={"producer": None, "vintage": None, "region": None, "grapes": []})]


class Web:
    def __init__(self):
        self.pages = {
            SITE: ("text/html", HOME),
            SITE + "cardapio.pdf": ("application/pdf", b"%PDF-food"),
            SITE + "vinhos": ("text/html", WINE_TEXT.encode()),
        }
        self.fetched = []

    async def __call__(self, url):
        self.fetched.append(url)
        if url not in self.pages:
            return None
        ctype, body = self.pages[url]
        return service.Fetched(url=url, content_type=ctype, body=body)


class Extractor:
    def __init__(self):
        self.calls = []
        self.answers = {
            "food": ExtractionResult(True, FOOD_ITEMS, menu_date="2026-09", model="m"),
            "wine": ExtractionResult(True, WINE_ITEMS, model="m"),
        }

    async def extract(self, restaurant, address, texts):
        text = "\n".join(texts)
        self.calls.append(text)
        return self.answers["wine" if "Barolo" in text else "food"]


@pytest.fixture
def world(monkeypatch):
    db = InMemoryDatabase()
    db.entities.insert_one(
        {
            "_id": "entity_ChIJpicchi",
            "entity_id": "entity_ChIJpicchi",
            "name": "Picchi",
            "version": 7,
            "data": {"website": SITE, "place_id": "ChIJpicchi", "address": "R. Oscar Freire, 533"},
        }
    )
    monkeypatch.setattr(service, "pdf_to_pages", lambda raw: [FOOD_TEXT] if raw == b"%PDF-food" else [])
    web, extractor = Web(), Extractor()
    deps = service.MenuDeps(fetch=web, extractor=extractor, website_for=_no_lookup)
    return db, web, extractor, deps


async def _no_lookup(place_id):
    raise AssertionError("the entity has its own website")


def entity(db):
    return db.entities.find_one({"_id": "entity_ChIJpicchi"})


async def test_every_menu_document_is_read_and_the_numbers_derived(world):
    db, web, extractor, deps = world

    menu = await service.refresh_menu(db, entity(db), deps)

    assert [s["covers"] for s in menu["sources"]] == ["full", "wine"]
    assert {s["kind"] for s in menu["sources"]} == {"pdf", "html"}
    assert [i["name"] for i in menu["items"]] == ["Burrata", "Fettuccine", "Polvo", "Tiramisu", "Chianti"]
    assert [i["source"] for i in menu["items"]] == [0, 0, 0, 0, 1]
    assert menu["derived"]["per_person_brl"]["dinner"] == 110 + 240 + 58
    assert menu["status"] == "auto" and menu["sources"][0]["menu_date"] == "2026-09"
    assert SITE + "reservas" not in web.fetched


async def test_the_entity_gets_a_summary_without_moving_its_version(world):
    db, _, _, deps = world

    await service.refresh_menu(db, entity(db), deps)

    stored = entity(db)
    assert stored["version"] == 7
    assert stored["menu_summary"]["per_person_brl"] == {"lunch": 408, "dinner": 408, "partial": False}
    assert stored["menu_summary"]["status"] == "auto" and stored["menu_summary"]["wine_labels"] == 1


async def test_a_document_whose_text_did_not_change_is_not_read_again(world):
    db, _, extractor, deps = world
    await service.refresh_menu(db, entity(db), deps)

    menu = await service.refresh_menu(db, entity(db), deps, force=True)

    assert len(extractor.calls) == 2  # both documents once, none again
    assert len(menu["items"]) == 5


async def test_without_force_a_recent_refresh_is_not_repeated(world):
    db, web, _, deps = world
    await service.refresh_menu(db, entity(db), deps)
    web.fetched.clear()

    await service.refresh_menu(db, entity(db), deps)

    assert web.fetched == []


async def test_a_page_that_is_not_this_restaurants_menu_is_left_out(world):
    db, _, extractor, deps = world
    extractor.answers["wine"] = ExtractionResult(False, [], reason="blog post", model="m")

    menu = await service.refresh_menu(db, entity(db), deps)

    assert [s["covers"] for s in menu["sources"]] == ["full"]
    assert menu["rejected"] == [{"url": SITE + "vinhos", "reason": "blog post"}]


async def test_nothing_found_says_why_and_keeps_what_was_there(world):
    db, web, _, deps = world
    await service.refresh_menu(db, entity(db), deps)
    web.pages.pop(SITE)

    menu = await service.refresh_menu(db, entity(db), deps, force=True)

    assert menu["last_error"] == "site_unreachable" and len(menu["items"]) == 5


async def test_without_a_website_google_is_asked_and_without_either_it_is_not_found(world):
    db, _, _, deps = world
    db.entities.update_one({"_id": "entity_ChIJpicchi"}, {"$set": {"data": {"place_id": "ChIJpicchi"}}})
    asked = []

    async def lookup(place_id):
        asked.append(place_id)
        return SITE

    menu = await service.refresh_menu(db, entity(db), service.MenuDeps(deps.fetch, deps.extractor, lookup))
    assert asked == ["ChIJpicchi"] and menu["website"] == SITE

    db.entities.insert_one({"_id": "entity_osm_1", "name": "Sem site", "data": {}})
    bare = await service.refresh_menu(db, db.entities.find_one({"_id": "entity_osm_1"}), deps)
    assert bare["status"] == "not_found" and bare["last_error"] == "no_website"


async def test_a_review_is_kept_and_a_real_change_asks_for_it_again(world, monkeypatch):
    db, _, extractor, deps = world
    await service.refresh_menu(db, entity(db), deps)
    service.review_menu(
        db, "entity_ChIJpicchi", {"status": "reviewed", "overrides": {"per_person_brl.dinner": 450}}, "anwar@lotier.com"
    )

    view = service.public_view(db.entity_menus.find_one({"_id": "entity_ChIJpicchi"}))
    assert view["status"] == "reviewed" and view["derived"]["per_person_brl"]["dinner"] == 450
    assert entity(db)["menu_summary"]["per_person_brl"]["dinner"] == 450

    # Same text again: the review stands.
    menu = await service.refresh_menu(db, entity(db), deps, force=True)
    assert menu["status"] == "reviewed"

    # The menu changed and got 50% pricier: ask for the review again, keeping who reviewed.
    monkeypatch.setattr(service, "pdf_to_pages", lambda raw: [FOOD_TEXT + "\nNovo prato 99,00"])
    extractor.answers["food"] = ExtractionResult(True, [dict(i, price_brl=i["price_brl"] * 1.5) for i in FOOD_ITEMS])
    menu = await service.refresh_menu(db, entity(db), deps, force=True)
    assert menu["status"] == "needs_review" and menu["review"]["by"] == "anwar@lotier.com"


async def test_read_serves_what_is_stored_and_asks_for_a_refresh_when_stale(world, monkeypatch):
    db, _, _, deps = world
    scheduled = []
    monkeypatch.setattr(service, "schedule_refresh", lambda db_, entity_: scheduled.append(entity_["_id"]) or True)

    missing = service.read_menu(db, entity(db), max_age_days=30)
    assert missing == {"entity_id": "entity_ChIJpicchi", "status": "missing", "fresh": False, "refreshing": True}

    await service.refresh_menu(db, entity(db), deps)
    fresh = service.read_menu(db, entity(db), max_age_days=30)
    assert fresh["fresh"] is True and fresh["refreshing"] is False and "refresh" not in fresh

    forty_days_ago = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=40)
    db.entity_menus.update_one({"_id": "entity_ChIJpicchi"}, {"$set": {"refreshed_at": forty_days_ago}})
    stale = service.read_menu(db, entity(db), max_age_days=30)
    assert stale["fresh"] is False and stale["refreshing"] is True and len(scheduled) == 2


async def test_items_can_be_left_out_of_a_read(world):
    db, _, _, deps = world
    await service.refresh_menu(db, entity(db), deps)

    assert service.read_menu(db, entity(db), items=0)["items"] == []
    assert len(service.read_menu(db, entity(db), items=2)["items"]) == 2


async def test_a_source_added_by_a_curator_is_read_in_the_next_refresh(world):
    db, web, extractor, deps = world
    await service.refresh_menu(db, entity(db), deps)
    web.pages[SITE + "drinks-secretos"] = ("text/html", b"<p>Negroni 58,00</p><p>Spritz 52,00</p><p>Gin 60,00</p>")
    extractor.answers["drinks"] = ExtractionResult(True, [dish("Negroni", 58, "drink", tags=["cocktail"])])
    original = extractor.extract

    async def extract(restaurant, address, texts):
        if "Negroni" in "\n".join(texts):
            extractor.calls.append("drinks")
            return extractor.answers["drinks"]
        return await original(restaurant, address, texts)

    extractor.extract = extract
    service.review_menu(db, "entity_ChIJpicchi", {"add_sources": [SITE + "drinks-secretos"]}, "anwar@lotier.com")

    menu = await service.refresh_menu(db, entity(db), deps)

    manual = next(s for s in menu["sources"] if s["found_via"] == "manual")
    assert manual["url"] == SITE + "drinks-secretos"
    assert [i["name"] for i in menu["items"] if i["source"] == manual["index"]] == ["Negroni"]


async def test_a_menu_page_without_prices_is_followed_one_level_deeper(world):
    db, web, extractor, deps = world
    web.pages[SITE] = ("text/html", b'<a href="/cardapio">Card\xc3\xa1pio</a>')
    web.pages[SITE + "cardapio"] = (
        "text/html",
        b'<p>Clique aqui para ver o card\xc3\xa1pio</p><a href="https://menu.example/casa/menu.pdf">Menu</a>'
        b'<a href="https://mhttps://menu.example/broken">Menu</a>',
    )
    web.pages["https://menu.example/casa/menu.pdf"] = ("application/pdf", b"%PDF-food")

    menu = await service.refresh_menu(db, entity(db), deps)

    assert [s["url"] for s in menu["sources"]] == ["https://menu.example/casa/menu.pdf"]
    assert "https://mhttps://menu.example/broken" not in web.fetched


async def test_a_group_site_leads_to_the_page_of_this_unit_and_its_menu(world):
    db, web, _, deps = world
    db.entities.update_one(
        {"_id": "entity_ChIJpicchi"},
        {"$set": {"name": "Gero", "data": {"website": SITE, "address": "R. Haddock Lobo, 1629 - Jardins"}}},
    )
    web.pages[SITE] = (
        "text/html",
        b'<a href="/rest/gero-rio/">Gero Rio</a><a href="/rest/gero-jardins/">Gero Jardins</a>',
    )
    web.pages[SITE + "rest/gero-jardins/"] = ("text/html", b'<a href="/menu-gero-jardins.pdf">Card\xc3\xa1pio</a>')
    web.pages[SITE + "menu-gero-jardins.pdf"] = ("application/pdf", b"%PDF-food")

    menu = await service.refresh_menu(db, entity(db), deps)

    assert [s["url"] for s in menu["sources"]] == [SITE + "menu-gero-jardins.pdf"]
    assert SITE + "rest/gero-rio/" not in web.fetched


async def test_why_a_site_could_not_be_read_is_said_precisely(world):
    db, web, _, deps = world

    async def refused(url):
        raise service.FetchFailed("site_refused")

    menu = await service.refresh_menu(db, entity(db), service.MenuDeps(refused, deps.extractor, deps.website_for))

    assert menu["last_error"] == "site_refused" and menu["status"] == "not_found"


async def test_a_delivery_menu_is_kept_but_does_not_set_the_price_per_person(world):
    db, web, extractor, deps = world
    web.pages[SITE] = (
        "text/html",
        b'<a href="/cardapio.pdf">Card\xc3\xa1pio</a><a href="/delivery">Card\xc3\xa1pio delivery</a>',
    )
    web.pages[SITE + "delivery"] = ("text/html", b"<p>Fettuccine 199,00</p><p>Polvo 180,00</p><p>Tiramisu 40,00</p>")
    original = extractor.extract

    async def extract(restaurant, address, texts):
        if "199,00" in "\n".join(texts):
            return ExtractionResult(
                True, [dish("Fettuccine", 199), dish("Polvo", 180), dish("Tiramisu", 40, "dessert")]
            )
        return await original(restaurant, address, texts)

    extractor.extract = extract
    menu = await service.refresh_menu(db, entity(db), deps)

    assert {s["covers"] for s in menu["sources"]} == {"full", "delivery"}
    assert menu["derived"]["per_person_brl"]["dinner"] == 110 + 240 + 58  # the dining-room menu only
