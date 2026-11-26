"""
File: test_menu_service.py
Purpose: an entity's menu end to end — the raw layer (every menu document found on the site, as text)
    and the brief (one model call over all of it, verified) — what is kept between refreshes, the review,
    the read for cards and the raw excerpts for the chat; network, model and Google faked.
Dependencies: app.services.menu_service, tests.conftest.InMemoryDatabase.

The model decides (which document is the dining-room menu, which dishes make a meal); the code sums and
checks. The model runs only when the documents changed. A curator's review is never overwritten.
"""

import datetime as dt

import pytest

from app.services import menu_service as service
from tests.conftest import InMemoryDatabase

SITE = "https://picchi.example/"
HOME = (
    b'<a href="/cardapio.pdf">Card\xc3\xa1pio</a> <a href="/vinhos">Carta de vinhos</a>'
    b' <a href="/reservas">Reservas</a>'
)
FOOD_TEXT = "Burrata 110,00\nFettuccine 260,00\nPolvo 220,00\nOstras gratinadas 98,00\nTiramisu 58,00"
WINE_TEXT = "<p>Barolo taça 89,00 garrafa 690,00</p><p>Chianti 420,00</p><p>Prosecco 70,00</p>"


RESERVAS = "<p>Reservas pelo telefone 3065-5560, com at\u00e9 sete dias de anteced\u00eancia.</p>"


class Web:
    def __init__(self):
        self.pages = {
            SITE: ("text/html", HOME),
            SITE + "cardapio.pdf": ("application/pdf", b"%PDF-food"),
            SITE + "vinhos": ("text/html", WINE_TEXT.encode()),
            SITE + "reservas": ("text/html", RESERVAS.encode()),
        }
        self.fetched = []

    async def __call__(self, url):
        self.fetched.append(url)
        if url not in self.pages:
            return None
        ctype, body = self.pages[url]
        return service.Fetched(url=url, content_type=ctype, body=body)


def brief_for(
    documents,
    dinner=(("Burrata", 110), ("Fettuccine", 260), ("Tiramisu", 58)),
    confidence="high",
):
    """What a model would answer: the PDF is the dining room, the wine page drinks, a /natal page a shop;
    from the booking page one fact with its real excerpt and one it made up."""
    roles = []
    for d in documents:
        role = (
            "orders_or_shop" if "natal" in d["url"] else "drinks" if "vinhos" in d["url"]
            else "not_a_menu" if "reservas" in d["url"] else "dining_room"
        )  # fmt: skip
        roles.append({"index": d["index"], "role": role, "note": None})
    dining = next(
        (d["index"] for d in documents if not any(w in d["url"] for w in ("natal", "vinhos", "reservas"))),
        None,
    )
    per_person = {"lunch": None, "dinner": None}
    if dining is not None and dinner:
        basis = [{"item": n, "price_brl": p, "document": dining} for n, p in dinner]
        per_person["dinner"] = {"basis": basis, "fixed_price": False, "note": None}
    booking = next((d["index"] for d in documents if "reservas" in d["url"]), None)
    facts = []
    if booking is not None:
        facts = [
            {
                "topic": "reservations",
                "fact": "Reserva por telefone, até 7 dias antes.",
                "evidence": "Reservas pelo telefone 3065-5560, com até sete dias",
                "page": booking,
            },
            {"topic": "pets", "fact": "Aceita cachorros.", "evidence": "cachorros são bem-vindos", "page": booking},
        ]
    return {
        "facts": facts, "house_summary": "Casa italiana de bairro." if booking is not None else "",
        "documents": roles, "formats": ["a_la_carte"] if dining is not None else [], "per_person": per_person,
        "executive_lunch_brl": None, "tasting_menus": [], "couvert_brl": None, "corkage_brl": None,
        "wine": {"by_the_glass": True, "bottle_min_brl": 420, "bottle_max_brl": 690, "note": None},
        "dietary": ["seafood"], "highlights": ["ostras gratinadas"], "caveats": [],
        "summary": "Italiano nos Jardins.", "menu_date": "2026-09", "confidence": confidence,
    }  # fmt: skip


class Synthesizer:
    def __init__(self):
        self.calls = []
        self.answer = brief_for
        self.fail = False

    async def synthesize(self, restaurant, address, context, documents):
        self.calls.append([d["url"] for d in documents])
        if self.fail:
            raise RuntimeError("provider said something long and private")
        return self.answer(documents), "m-1"


class Triager:
    """What a light model would answer: a privacy page and another unit are not useful; topics by url."""

    def __init__(self):
        self.calls = []

    async def triage(self, restaurant, address, pages):
        self.calls.append([p["url"] for p in pages])
        verdicts = {}
        for p in pages:
            url = p["url"]
            useless = "privacidade" in url or "outra-unidade" in url
            topic = ("reservations" if "reservas" in url else "drinks_wine" if "vinhos" in url
                     else "delivery_shop" if "natal" in url else "menu")  # fmt: skip
            verdicts[p["index"]] = {"useful": not useless, "topics": [] if useless else [topic], "reason": "r"}
        return verdicts


@pytest.fixture
def world(monkeypatch):
    db = InMemoryDatabase()
    db.entities.insert_one(
        {
            "_id": "entity_ChIJpicchi",
            "entity_id": "entity_ChIJpicchi",
            "name": "Picchi",
            "version": 7,
            "data": {
                "website": SITE,
                "place_id": "ChIJpicchi",
                "address": "R. Oscar Freire, 533",
            },
        }
    )
    monkeypatch.setattr(service, "pdf_to_pages", lambda raw: [FOOD_TEXT] if raw == b"%PDF-food" else [])
    monkeypatch.setattr(service, "_budget", {"day": None, "used": 0})
    web, synthesizer = Web(), Synthesizer()
    deps = service.MenuDeps(fetch=web, synthesizer=synthesizer, website_for=_no_lookup, triager=Triager())
    return db, web, synthesizer, deps


async def _no_lookup(place_id):
    raise AssertionError("the entity has its own website")


def entity(db):
    return db.entities.find_one({"_id": "entity_ChIJpicchi"})


async def test_every_menu_document_is_kept_as_text_and_one_model_call_writes_the_brief(
    world,
):
    db, web, synthesizer, deps = world

    menu = await service.refresh_menu(db, entity(db), deps)

    assert [(d["kind"], d["topics"]) for d in menu["documents"]] == [
        ("pdf", ["menu"]),
        ("html", ["drinks_wine"]),
        ("html", ["reservations"]),
    ]
    assert "Ostras gratinadas 98,00" in menu["documents"][0]["text"]
    assert len(synthesizer.calls) == 1 and len(deps.triager.calls) == 1
    assert menu["brief"]["per_person_brl"] == {"lunch": None, "dinner": 428.0}
    # The booking fact with its real excerpt stays; the made-up one is left out and does not block.
    assert [f["topic"] for f in menu["brief"]["facts"]] == ["reservations"]
    assert [i["problem"] for i in menu["synthesis"]["issues"]] == ["fact_without_evidence"]
    assert menu["status"] == "auto"
    assert web.fetched.index(SITE + "cardapio.pdf") < web.fetched.index(SITE + "reservas")  # the menu PDF first


async def test_a_v1_menu_loses_its_items_and_heuristic_numbers_on_the_next_save(world):
    db, _, _, deps = world
    db.entity_menus.insert_one(
        {"_id": "entity_ChIJpicchi", "items": [{"name": "x"}], "derived": {"per_person_brl": {"dinner": 3562}}}
    )

    await service.refresh_menu(db, entity(db), deps)

    stored = db.entity_menus.find_one({"_id": "entity_ChIJpicchi"})
    assert "items" not in stored and "derived" not in stored and "sources" not in stored
    assert stored["brief"]["per_person_brl"]["dinner"] == 428.0


async def test_the_entity_gets_a_summary_without_moving_its_version(world):
    db, _, _, deps = world

    await service.refresh_menu(db, entity(db), deps)

    stored = entity(db)
    summary = stored["menu_summary"]
    assert stored["version"] == 7
    assert summary["per_person_brl"]["dinner"] == 428.0 and summary["status"] == "auto"
    assert summary["summary"] == "Italiano nos Jardins." and summary["formats"] == ["a_la_carte"]


async def test_the_model_runs_again_only_when_the_documents_change_or_when_asked(world, monkeypatch):
    db, web, synthesizer, deps = world
    await service.refresh_menu(db, entity(db), deps)

    await service.refresh_menu(db, entity(db), deps, force=True)  # same text: no new call
    assert len(synthesizer.calls) == 1

    monkeypatch.setattr(service, "pdf_to_pages", lambda raw: [FOOD_TEXT + "\nNovo prato 99,00"])
    await service.refresh_menu(db, entity(db), deps, force=True)
    assert len(synthesizer.calls) == 2

    web.fetched.clear()
    await service.refresh_menu(db, entity(db), deps, resynthesize=True)  # from what is stored, no network
    assert len(synthesizer.calls) == 3 and web.fetched == []


async def test_without_force_a_recent_refresh_is_not_repeated(world):
    db, web, _, deps = world
    await service.refresh_menu(db, entity(db), deps)
    web.fetched.clear()

    await service.refresh_menu(db, entity(db), deps)

    assert web.fetched == []


async def test_a_shop_page_is_kept_raw_but_never_prices_the_meal(world):
    """The Charlô case: a Christmas shop was read as the menu (R$ 3.562 per person)."""
    db, web, synthesizer, deps = world
    web.pages[SITE] = ("text/html", b'<a href="/natal">Card\xc3\xa1pio de Natal</a>')
    web.pages[SITE + "natal"] = (
        "text/html",
        b"<p>Panetone 320,00</p><p>Torta para 10 890,00</p><p>Peru 1.450,00</p>",
    )

    menu = await service.refresh_menu(db, entity(db), deps)

    assert menu["documents"][0]["url"] == SITE + "natal"
    assert menu["brief"]["documents"][0]["role"] == "orders_or_shop"
    assert menu["status"] == "not_found" and menu["last_error"] == "nothing_useful"
    assert entity(db)["menu_summary"].get("per_person_brl") is None


async def test_a_price_the_model_made_up_sends_the_brief_to_review(world):
    db, _, synthesizer, deps = world
    synthesizer.answer = lambda docs: brief_for(docs, dinner=(("Burrata", 110), ("Fettuccine", 240), ("Tiramisu", 58)))

    menu = await service.refresh_menu(db, entity(db), deps)

    assert menu["status"] == "needs_review"
    blocking = [i["problem"] for i in menu["synthesis"]["issues"] if i["problem"] != "fact_without_evidence"]
    assert blocking == ["price_not_in_document"]


async def test_a_failed_synthesis_keeps_the_previous_brief_and_says_why(world, monkeypatch):
    db, _, synthesizer, deps = world
    await service.refresh_menu(db, entity(db), deps)
    synthesizer.fail = True

    menu = await service.refresh_menu(db, entity(db), deps, resynthesize=True)

    assert menu["last_error"] == "synthesis_failed" and menu["brief"]["per_person_brl"]["dinner"] == 428.0
    assert menu["status"] == "auto"


async def test_nothing_found_says_why_and_keeps_what_was_there(world):
    db, web, _, deps = world
    await service.refresh_menu(db, entity(db), deps)
    web.pages.pop(SITE)

    menu = await service.refresh_menu(db, entity(db), deps, force=True)

    assert menu["last_error"] == "site_unreachable" and len(menu["documents"]) == 3 and menu["status"] == "auto"


async def test_without_a_website_google_is_asked_and_without_either_it_is_not_found(
    world,
):
    db, _, _, deps = world
    db.entities.update_one({"_id": "entity_ChIJpicchi"}, {"$set": {"data": {"place_id": "ChIJpicchi"}}})
    asked = []

    async def lookup(place_id):
        asked.append(place_id)
        return SITE

    menu = await service.refresh_menu(db, entity(db), service.MenuDeps(deps.fetch, deps.synthesizer, lookup))
    assert asked == ["ChIJpicchi"] and menu["website"] == SITE

    db.entities.insert_one({"_id": "entity_osm_1", "name": "Sem site", "data": {}})
    bare = await service.refresh_menu(db, db.entities.find_one({"_id": "entity_osm_1"}), deps)
    assert bare["status"] == "not_found" and bare["last_error"] == "no_website"


async def test_a_review_is_kept_and_a_real_change_asks_for_it_again(world, monkeypatch):
    db, _, synthesizer, deps = world
    await service.refresh_menu(db, entity(db), deps)
    service.review_menu(
        db,
        "entity_ChIJpicchi",
        {"status": "reviewed", "overrides": {"per_person_brl.dinner": 450}},
        "anwar@lotier.com",
    )

    view = service.public_view(db.entity_menus.find_one({"_id": "entity_ChIJpicchi"}))
    assert view["status"] == "reviewed" and view["brief"]["per_person_brl"]["dinner"] == 450
    assert entity(db)["menu_summary"]["per_person_brl"]["dinner"] == 450

    menu = await service.refresh_menu(db, entity(db), deps, resynthesize=True)  # same answer: stands
    assert menu["status"] == "reviewed"

    monkeypatch.setattr(service, "pdf_to_pages", lambda raw: [FOOD_TEXT + "\nLagosta 390,00"])
    synthesizer.answer = lambda docs: brief_for(docs, dinner=(("Burrata", 110), ("Lagosta", 390), ("Tiramisu", 58)))
    menu = await service.refresh_menu(db, entity(db), deps, force=True)  # 428 -> 558: +30%
    assert menu["status"] == "needs_review" and menu["review"]["by"] == "anwar@lotier.com"


async def test_read_serves_the_brief_without_raw_text_and_asks_for_a_refresh_when_stale(world, monkeypatch):
    db, _, _, deps = world
    scheduled = []
    monkeypatch.setattr(
        service,
        "schedule_refresh",
        lambda db_, entity_: scheduled.append(entity_["_id"]) or True,
    )

    missing = service.read_menu(db, entity(db), max_age_days=30)
    assert missing == {
        "entity_id": "entity_ChIJpicchi",
        "status": "missing",
        "fresh": False,
        "refreshing": True,
    }

    await service.refresh_menu(db, entity(db), deps)
    fresh = service.read_menu(db, entity(db), max_age_days=30)
    assert fresh["fresh"] is True and fresh["refreshing"] is False and "lease_until" not in fresh
    assert all("text" not in d for d in fresh["documents"]) and fresh["brief"]["summary"]

    forty_days_ago = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=40)
    db.entity_menus.update_one({"_id": "entity_ChIJpicchi"}, {"$set": {"refreshed_at": forty_days_ago}})
    stale = service.read_menu(db, entity(db), max_age_days=30)
    assert stale["fresh"] is False and stale["refreshing"] is True and len(scheduled) == 2


async def test_the_chat_gets_raw_excerpts_for_a_detail(world, monkeypatch):
    db, _, _, deps = world
    await service.refresh_menu(db, entity(db), deps)

    oysters = service.menu_text(db, entity(db), q="Tem OSTRA?")
    assert oysters["matched"] is True and "Ostras gratinadas 98,00" in oysters["excerpts"][0]["text"]
    assert oysters["documents"][0]["role"] == "dining_room"

    wine = service.menu_text(db, entity(db), q="quanto custa a taça de barolo")
    assert [e["document"] for e in wine["excerpts"]] == [1] and "89,00" in wine["excerpts"][0]["text"]

    nothing = service.menu_text(db, entity(db), q="caviar")
    assert nothing["matched"] is False and nothing["excerpts"] == []

    start = service.menu_text(db, entity(db))
    assert start["matched"] is None and start["excerpts"][0]["document"] == 0


async def test_raw_excerpts_leave_out_what_is_not_this_menu_and_ask_for_it_when_missing(world, monkeypatch):
    db, web, _, deps = world
    asked = []
    monkeypatch.setattr(service, "schedule_refresh", lambda db_, entity_: asked.append(1) or True)
    assert service.menu_text(db, entity(db), q="ostra")["refreshing"] is True and asked == [1]

    web.pages[SITE] = (
        "text/html",
        b'<a href="/cardapio.pdf">Card\xc3\xa1pio</a><a href="/natal">Card\xc3\xa1pio de Natal</a>',
    )
    web.pages[SITE + "natal"] = (
        "text/html",
        b"<p>Panetone 320,00</p><p>Ostra de Natal 90,00</p><p>Peru 450,00</p>",
    )
    await service.refresh_menu(db, entity(db), deps)

    excerpts = service.menu_text(db, entity(db), q="ostra")["excerpts"]
    assert [e["document"] for e in excerpts] == [
        0,
        1,
    ]  # the dining room first, the shop after
    assert "Ostras gratinadas" in excerpts[0]["text"]


async def test_a_source_added_by_a_curator_is_collected_in_the_next_refresh(world):
    db, web, _, deps = world
    await service.refresh_menu(db, entity(db), deps)
    web.pages[SITE + "drinks-secretos"] = (
        "text/html",
        b"<p>Negroni da casa 58,00</p><p>Spritz de laranja 52,00</p><p>Gin t\xc3\xb4nica 60,00</p>",
    )
    service.review_menu(
        db,
        "entity_ChIJpicchi",
        {"add_sources": [SITE + "drinks-secretos"]},
        "anwar@lotier.com",
    )

    menu = await service.refresh_menu(db, entity(db), deps)

    manual = next(d for d in menu["documents"] if d["found_via"] == "manual")
    assert manual["url"] == SITE + "drinks-secretos" and "Negroni da casa 58,00" in manual["text"]


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

    assert "https://menu.example/casa/menu.pdf" in [d["url"] for d in menu["documents"]]
    assert "https://mhttps://menu.example/broken" not in web.fetched


async def test_a_group_site_leads_to_the_page_of_this_unit_and_its_menu(world):
    db, web, _, deps = world
    db.entities.update_one(
        {"_id": "entity_ChIJpicchi"},
        {
            "$set": {
                "name": "Gero",
                "data": {"website": SITE, "address": "R. Haddock Lobo, 1629 - Jardins"},
            }
        },
    )
    web.pages[SITE] = (
        "text/html",
        b'<a href="/rest/gero-rio/">Gero Rio</a><a href="/rest/gero-jardins/">Gero Jardins</a>',
    )
    web.pages[SITE + "rest/gero-jardins/"] = (
        "text/html",
        b'<a href="/menu-gero-jardins.pdf">Card\xc3\xa1pio</a>',
    )
    web.pages[SITE + "menu-gero-jardins.pdf"] = ("application/pdf", b"%PDF-food")

    menu = await service.refresh_menu(db, entity(db), deps)

    assert [d["url"] for d in menu["documents"]] == [SITE + "menu-gero-jardins.pdf"]
    assert web.fetched.index(SITE + "rest/gero-jardins/") < web.fetched.index(SITE + "rest/gero-rio/")


async def test_why_a_site_could_not_be_read_is_said_precisely(world):
    db, web, _, deps = world

    async def refused(url):
        raise service.FetchFailed("site_refused")

    menu = await service.refresh_menu(db, entity(db), service.MenuDeps(refused, deps.synthesizer, deps.website_for))

    assert menu["last_error"] == "site_refused" and menu["status"] == "not_found"


async def test_triage_keeps_only_useful_pages_and_remembers_what_it_left_out(world):
    db, web, _, deps = world
    web.pages[SITE] = ("text/html", HOME + b'<a href="/privacidade">Pol\xc3\xadtica de privacidade</a>')
    web.pages[SITE + "privacidade"] = (
        "text/html",
        ("<p>" + "Tratamos seus dados pessoais com cuidado. " * 3 + "</p>").encode(),
    )

    menu = await service.refresh_menu(db, entity(db), deps)

    assert SITE + "privacidade" not in [d["url"] for d in menu["documents"]]
    left_out = next(p for p in menu["pages"] if p["url"] == SITE + "privacidade")
    assert left_out["useful"] is False and "text" not in left_out


async def test_a_page_whose_text_did_not_change_is_not_triaged_again(world):
    db, web, _, deps = world
    await service.refresh_menu(db, entity(db), deps)

    await service.refresh_menu(db, entity(db), deps, force=True)
    assert len(deps.triager.calls) == 1

    web.pages[SITE + "reservas"] = ("text/html", RESERVAS.replace("sete", "dez").encode())
    await service.refresh_menu(db, entity(db), deps, force=True)
    assert deps.triager.calls[-1] == [SITE + "reservas"]


async def test_the_sitemap_brings_pages_the_navigation_hides(world):
    db, web, _, deps = world
    web.pages[SITE + "sitemap.xml"] = (
        "application/xml",
        f"<urlset><url><loc>{SITE}eventos</loc></url></urlset>".encode(),
    )
    web.pages[SITE + "eventos"] = (
        "text/html",
        "<p>Salão privativo para até 30 pessoas, com menu fechado.</p>".encode(),
    )

    menu = await service.refresh_menu(db, entity(db), deps)

    page = next(p for p in menu["pages"] if p["url"] == SITE + "eventos")
    assert page["found_via"] == "sitemap" and page["useful"] is True


async def test_the_crawl_stops_at_its_page_limit(world, monkeypatch):
    db, web, _, deps = world
    monkeypatch.setattr(service, "MAX_PAGES", 2)

    menu = await service.refresh_menu(db, entity(db), deps)

    assert len(menu["pages"]) == 2


async def test_a_site_with_house_facts_but_no_prices_has_a_brief(world):
    db, web, synthesizer, deps = world
    web.pages[SITE] = ("text/html", b'<a href="/reservas">Reservas</a>')
    no_menu = {"confidence": "low", "wine": None, "per_person": {"lunch": None, "dinner": None}}
    synthesizer.answer = lambda docs: {
        **brief_for(docs),
        **no_menu,
        "documents": [{"index": d["index"], "role": "other", "note": None} for d in docs],
    }

    menu = await service.refresh_menu(db, entity(db), deps)

    assert menu["status"] == "auto" and menu["brief"]["per_person_brl"] is None
    assert [f["topic"] for f in menu["brief"]["facts"]] == ["reservations"]
    assert [f["topic"] for f in entity(db)["menu_summary"]["facts"]] == ["reservations"]


async def test_raw_excerpts_can_be_narrowed_to_a_topic(world):
    db, _, _, deps = world
    await service.refresh_menu(db, entity(db), deps)

    booking = service.menu_text(db, entity(db), topic="reservations")

    assert [d["url"] for d in booking["documents"]] == [SITE + "reservas"]
    assert "3065-5560" in booking["excerpts"][0]["text"]


# ----------------------------------------------------------- what may be said ----
def _stored(status, issues=(), **brief):
    base = {
        "per_person_brl": {"lunch": 105.0, "dinner": 210.0},
        "per_person_fixed": {"lunch": False, "dinner": False},
        "per_person_notes": {"dinner": "Entrada e principal."},
        "per_person_basis": {"dinner": [{"item": "x", "price_brl": 210.0, "document": 0}]},
        "executive_lunch_brl": 93.0,
        "tasting_menus": [{"name": "Degustação", "price_brl": 390.0, "courses": 7}],
        "couvert_brl": 30.0,
        "corkage_brl": 80.0,
        "wine": {"by_the_glass": True, "bottle_min_brl": 150.0, "bottle_max_brl": 4200.0, "note": None},
        "formats": ["a_la_carte", "executive"],
        "dietary": ["vegetarian"],
        "highlights": ["Risoni de polvo"],
        "caveats": [],
        "summary": "Jantar em torno de R$ 210 por pessoa.",
        "menu_date": "2026-03",
        "confidence": "high",
        "house_summary": "Casa centenária em Perdizes.",
        "facts": [{"topic": "pets", "fact": "Não aceita cães.", "evidence": "não aceitamos cães", "page": 1}],
        "concepts": [{"category": "menu", "value": "executive menu", "evidence": "menu executivo", "page": 0}],
        "documents": [{"index": 0, "role": "dining_room", "note": None}],
    }
    base.update(brief)
    return {
        "_id": "e1",
        "status": status,
        "refreshed_at": "2026-11-26T10:00:00Z",
        "website": "https://casa.example",
        "brief": base,
        "synthesis": {"issues": list(issues)},
    }


def test_the_summary_is_what_may_be_said_without_how_it_was_checked():
    summary = service._summary(_stored("auto"))

    assert summary["per_person_brl"] == {"lunch": 105.0, "dinner": 210.0}
    assert summary["tasting_menus"] == [{"name": "Degustação", "price_brl": 390.0, "courses": 7}]
    assert summary["facts"] == [{"topic": "pets", "fact": "Não aceita cães."}]
    assert summary["concepts"] == [{"category": "menu", "value": "executive menu"}]
    assert summary["house_summary"] and summary["website"] == "https://casa.example"
    text = str(summary)
    for internal in ("evidence", "per_person_basis", "documents", "confidence"):
        assert internal not in text


def test_a_brief_waiting_for_review_withholds_only_what_failed_and_the_text_that_states_prices():
    issues = [
        {"field": "wine.bottle_max_brl", "price_brl": 4200.0, "problem": "price_not_in_documents"},
        {"field": "facts", "problem": "fact_without_evidence"},
    ]
    summary = service._summary(_stored("needs_review", issues))

    assert summary["wine"] == {"by_the_glass": True, "bottle_min_brl": 150.0}
    assert summary["per_person_brl"]["dinner"] == 210.0 and summary["corkage_brl"] == 80.0
    assert "summary" not in summary and summary["withheld"] == ["wine.bottle_max_brl"]


def test_a_price_per_person_that_failed_goes_with_its_notes():
    issues = [{"field": "per_person.dinner", "price_brl": 210.0, "problem": "not_dining_room"}]
    summary = service._summary(_stored("needs_review", issues))

    assert summary["per_person_brl"] == {"lunch": 105.0}
    assert "dinner" not in summary.get("per_person_notes", {})


def test_low_confidence_withholds_every_price_per_person():
    summary = service._summary(_stored("needs_review", [{"field": "confidence", "problem": "low_confidence"}]))

    assert "per_person_brl" not in summary and summary["facts"]


def test_a_brief_a_person_confirmed_withholds_nothing():
    issues = [{"field": "wine.bottle_max_brl", "price_brl": 4200.0, "problem": "price_not_in_documents"}]
    summary = service._summary(_stored("reviewed", issues))

    assert summary["wine"]["bottle_max_brl"] == 4200.0 and summary["summary"]


def test_a_site_that_was_not_read_says_only_that():
    assert service._summary({"status": "not_found", "refreshed_at": "2026-11-26T10:00:00Z", "brief": None}) == {
        "status": "not_found",
        "as_of": "2026-11-26T10:00:00Z",
    }
