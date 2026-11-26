"""
File: test_menu_derive.py
Purpose: the numbers a menu yields — price per person, ranges, tasting menus, couvert, corkage, drinks.
Dependencies: app.services.menu_derive (pure; no model, no network).

"Por pessoa" = starter + main + dessert medians, without drinks or the 13% service (decided 2026-11-26).
Tasting and executive menus are reported apart and never enter the average. A dish for two counts half.
"""

from app.services.menu_derive import derive


def item(section, price=None, name="x", **extra):
    return {"section": section, "name": name, "price_brl": price, **extra}


PICCHI_LIKE = [
    item("starter", 105),
    item("starter", 135),
    item("starter", 110),
    item("main", 189),
    item("main", 247),
    item("main", 260),
    item("main", 295),
    item("dessert", 58),
    item("dessert", 64),
    item("tasting", 699, name="Tradizione"),
    item("tasting", 1249, name="Picchi"),
    item("couvert", 45, meal="lunch"),
    item("couvert", 59, meal="dinner"),
    item("corkage", 230),
    item(
        "drink",
        None,
        name="Barolo",
        wine={"producer": "x"},
        prices=[{"label": "taça", "brl": 89}, {"label": "garrafa", "brl": 690}],
    ),
    item("drink", 420, name="Chianti", wine={"producer": "y"}),
    item("drink", 58, name="Negroni", tags=["cocktail"]),
]


def test_per_person_is_the_sum_of_the_starter_main_and_dessert_medians():
    derived = derive(PICCHI_LIKE)

    # medians 110 + 253.5 + 61 = 424.5, rounded half up
    assert derived["per_person_brl"] == {"lunch": 425, "dinner": 425, "basis": "starter+main+dessert", "partial": False}


def test_ranges_tasting_couvert_and_corkage():
    derived = derive(PICCHI_LIKE)

    assert derived["main_brl"] == {"min": 189, "p25": 233, "median": 254, "p75": 269, "max": 295, "count": 4}
    assert derived["tasting_menus"] == [{"name": "Tradizione", "price_brl": 699}, {"name": "Picchi", "price_brl": 1249}]
    assert derived["couvert_brl"] == 52 and derived["corkage_brl"] == 230


def test_tasting_and_drinks_never_enter_the_per_person():
    without = derive([i for i in PICCHI_LIKE if i["section"] not in ("tasting", "drink")])

    assert without["per_person_brl"] == derive(PICCHI_LIKE)["per_person_brl"]


def test_drinks_glass_bottle_cocktails_and_labels():
    drinks = derive(PICCHI_LIKE)["drinks"]

    assert drinks["wine_by_glass_brl"]["median"] == 89
    assert drinks["wine_bottle_brl"] == {"min": 420, "median": 555, "count": 2}
    assert drinks["cocktail_brl"]["median"] == 58
    assert drinks["wine_labels"] == 2


def test_a_dish_for_two_counts_half():
    derived = derive([item("main", None, prices=[{"label": "para dois", "brl": 300}]), item("main", 100)])

    assert derived["main_brl"]["median"] == 125


def test_lunch_has_its_own_price_when_the_menu_says_so():
    derived = derive(
        [
            item("starter", 50, meal="lunch"),
            item("main", 80, meal="lunch"),
            item("dessert", 30, meal="lunch"),
            item("starter", 90, meal="dinner"),
            item("main", 200, meal="dinner"),
            item("dessert", 60, meal="dinner"),
        ]
    )

    assert derived["per_person_brl"]["lunch"] == 160 and derived["per_person_brl"]["dinner"] == 350


def test_a_missing_course_is_partial_and_no_main_is_no_price():
    assert derive([item("main", 100), item("dessert", 40)])["per_person_brl"] == {
        "lunch": 140,
        "dinner": 140,
        "basis": "starter+main+dessert",
        "partial": True,
    }
    assert derive([item("starter", 50), item("dessert", 40)])["per_person_brl"] is None


def test_executive_lunch_and_dietary_tags():
    derived = derive(
        [
            item("executive", 89),
            item("executive", 99),
            item("main", 120, tags=["vegetarian"]),
            item("main", 130, tags=["vegetarian", "light"]),
            item("main", 140, tags=["seafood"]),
        ]
    )

    assert derived["executive_lunch_brl"] == 94
    assert derived["tags"] == ["light_options", "seafood", "vegetarian_options"]


def test_nothing_priced_derives_nothing():
    derived = derive([item("main", None), item("other", None)])

    assert derived["per_person_brl"] is None and derived["main_brl"] is None and derived["tasting_menus"] == []


def test_couvert_is_its_typical_charge_not_the_cheapest_line():
    derived = derive(
        [
            item("couvert", 45, meal="lunch"),
            item("couvert", 59, meal="dinner"),
            item("couvert", 59),
            item("couvert", 36, name="Pães"),
        ]
    )

    assert derived["couvert_brl"] == 52  # median: a stray bread line does not set it


def test_wines_listed_under_a_by_the_glass_heading_are_glass_prices():
    derived = derive(
        [
            item("drink", 62, name="Pinot Grigio", subsection="Vinhos em taça", wine={"producer": "a"}),
            item("drink", 78, name="Chianti", subsection="Por taça", wine={"producer": "b"}),
            item("drink", 420, name="Barolo", subsection="Tintos — Itália", wine={"producer": "c"}),
        ]
    )["drinks"]

    assert drinks_ok(derived)


def drinks_ok(drinks):
    return drinks["wine_by_glass_brl"] == {"median": 70, "count": 2} and drinks["wine_bottle_brl"]["count"] == 1


def test_glass_words_count_only_as_whole_words():
    drinks = derive(
        [
            item("drink", 1190, name="Tara Chardonnay", subsection="Chile — Atacama", wine={"producer": "a"}),
            item("drink", 455, name="Braccale 2024 Jacopo Biondi Santi", subsection="Italia", wine={"producer": "b"}),
            item(
                "drink", 95, name="Braccale 2023 | 150ml", subsection="Vini rossi al bicchiere", wine={"producer": "c"}
            ),
        ]
    )["drinks"]

    assert drinks["wine_by_glass_brl"] == {"median": 95, "count": 1} and drinks["wine_bottle_brl"]["count"] == 2
