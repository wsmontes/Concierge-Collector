"""
File: test_menu_synthesis.py
Purpose: the menu brief — what the model decides is kept, what the code can check is checked: the price
    per person is the sum of the dishes the model cites (or one fixed price), every price must be in the
    text it came from, a low confidence or a non-dining-room citation is flagged.
Dependencies: app.services.menu_synthesis (pure functions + MenuSynthesizer with a fake client).
"""

import json
from types import SimpleNamespace

import pytest

from app.services import menu_synthesis as synthesis

DOCS = [
    {"index": 0, "url": "https://casa.example/cardapio.pdf", "kind": "pdf", "covers": "full",
     "text": "ENTRADAS\nBurrata 110,00\nPRINCIPAIS\nFettuccine ao ragu 260,00\nPolvo 1.249,00\nDOCES\nTiramisu R$ 58"},
    {"index": 1, "url": "https://casa.example/natal", "kind": "html", "covers": "full",
     "text": "Panetone inteiro 3.200,00\nTorta para 10 pessoas 890,00"},
]  # fmt: skip


def answer(**overrides):
    base = {
        "documents": [
            {"index": 0, "role": "dining_room", "note": None},
            {"index": 1, "role": "orders_or_shop", "note": "encomendas de Natal"},
        ],
        "formats": ["a_la_carte"],
        "per_person": {
            "lunch": None,
            "dinner": {
                "basis": [
                    {"item": "Burrata", "price_brl": 110, "document": 0},
                    {"item": "Fettuccine", "price_brl": 260, "document": 0},
                    {"item": "Tiramisu", "price_brl": 58, "document": 0},
                ],
                "fixed_price": False,
                "note": None,
            },
        },
        "executive_lunch_brl": None,
        "tasting_menus": [],
        "couvert_brl": None,
        "corkage_brl": None,
        "wine": None,
        "dietary": ["vegetarian"],
        "highlights": ["fettuccine ao ragu"],
        "caveats": [],
        "summary": "Italiano clássico.",
        "menu_date": None,
        "confidence": "high",
        "facts": [],
        "house_summary": "",
        "concepts": [],
    }
    base.update(overrides)
    return base


def test_the_price_per_person_is_the_sum_of_the_cited_dishes():
    raw = answer()
    raw["per_person"]["dinner"]["basis"][1]["item"] = "Fettuccine"

    brief, issues = synthesis.verify(raw, DOCS)

    assert brief["per_person_brl"] == {"lunch": None, "dinner": 428.0}
    assert brief["per_person_fixed"] == {"dinner": False}
    assert [b["item"] for b in brief["per_person_basis"]["dinner"]] == [
        "Burrata",
        "Fettuccine",
        "Tiramisu",
    ]
    assert issues == []
    assert brief["documents"][1]["role"] == "orders_or_shop"


def test_a_price_that_is_not_in_the_cited_document_is_flagged():
    raw = answer()
    raw["per_person"]["dinner"]["basis"][1]["price_brl"] = 240  # the model made it up

    _, issues = synthesis.verify(raw, DOCS)

    assert issues == [
        {"field": "per_person.dinner", "item": "Fettuccine", "price_brl": 240.0, "document": 0,
         "problem": "price_not_in_document"}
    ]  # fmt: skip


def test_citing_a_shop_or_delivery_document_is_flagged():
    raw = answer()
    raw["per_person"]["dinner"]["basis"] = [{"item": "Torta", "price_brl": 890, "document": 1}]

    _, issues = synthesis.verify(raw, DOCS)

    assert [i["problem"] for i in issues] == ["not_dining_room"]


def test_a_rodizio_uses_its_one_fixed_price():
    docs = [
        {
            "index": 0,
            "url": "u",
            "text": "Rodízio completo por pessoa R$ 239,90\nCrianças 6-12 anos 119,95",
        }
    ]
    raw = answer(
        documents=[{"index": 0, "role": "dining_room", "note": None}],
        formats=["rodizio"],
        per_person={
            "lunch": {
                "basis": [{"item": "Rodízio", "price_brl": 239.9, "document": 0}],
                "fixed_price": True,
                "note": None,
            },
            "dinner": {
                "basis": [{"item": "Rodízio", "price_brl": 239.9, "document": 0}],
                "fixed_price": True,
                "note": None,
            },
        },
    )

    brief, issues = synthesis.verify(raw, docs)

    assert brief["per_person_brl"] == {"lunch": 239.9, "dinner": 239.9} and issues == []
    assert brief["per_person_fixed"] == {"lunch": True, "dinner": True}
    assert brief["formats"] == ["rodizio"]


def test_a_fixed_lunch_does_not_make_the_a_la_carte_dinner_fixed():
    """The Ristorantino case: executive lunch R$ 190, dinner à la carte."""
    docs = [{"index": 0, "url": "u", "text": "Executivo 190,00\nPolenta 117,00\nLasagna 175,00\nTiramisù 62,00"}]
    raw = answer(
        documents=[{"index": 0, "role": "dining_room", "note": None}],
        per_person={
            "lunch": {
                "basis": [{"item": "Executivo", "price_brl": 190, "document": 0}],
                "fixed_price": True,
                "note": None,
            },
            "dinner": {
                "basis": [
                    {"item": "Polenta", "price_brl": 117, "document": 0},
                    {"item": "Lasagna", "price_brl": 175, "document": 0},
                    {"item": "Tiramisù", "price_brl": 62, "document": 0},
                ],
                "fixed_price": False,
                "note": None,
            },
        },
    )

    brief, issues = synthesis.verify(raw, docs)

    assert brief["per_person_brl"] == {"lunch": 190.0, "dinner": 354.0} and issues == []
    assert brief["per_person_fixed"] == {"lunch": True, "dinner": False}


def test_low_confidence_and_other_prices_not_in_the_text_are_flagged():
    raw = answer(
        confidence="low",
        couvert_brl=36,
        tasting_menus=[{"name": "Degustação", "price_brl": 1249, "courses": 7}],
    )

    brief, issues = synthesis.verify(raw, DOCS)

    assert brief["tasting_menus"][0]["price_brl"] == 1249.0  # "1.249,00" is in the text
    assert {i["problem"] for i in issues} == {
        "price_not_in_documents",
        "low_confidence",
    }
    assert [i["field"] for i in issues if i["problem"] == "price_not_in_documents"] == ["couvert_brl"]


def test_a_document_the_model_did_not_classify_is_never_taken_as_the_dining_room():
    raw = answer(documents=[{"index": 0, "role": "dining_room", "note": None}])

    brief, _ = synthesis.verify(raw, DOCS)

    assert [d["role"] for d in brief["documents"]] == ["dining_room", "other"]


@pytest.mark.parametrize(
    "text, price",
    [
        ("Polvo 1.249,00", 1249.0),
        ("Tiramisu R$ 58", 58.0),
        ("Burrata 110,00", 110.0),
        ("Taça 89.90", 89.9),
    ],
)
def test_prices_are_read_as_menus_write_them(text, price):
    assert price in synthesis.price_mentions(text)


def test_long_documents_share_the_input_fairly():
    docs = [
        {"index": 0, "text": "a" * 100},
        {"index": 1, "text": "b" * 10_000},
        {"index": 2, "text": "c" * 10_000},
    ]

    fitted = dict(synthesis.fit_documents(docs, max_chars=5_100))

    assert len(fitted[0]) == 100 and len(fitted[1]) == 2_500 and len(fitted[2]) == 2_500


class _Registry:
    def get_config(self, service):
        assert service == "menu_synthesis_text"
        return {"model": "m-1", "config": {"max_completion_tokens": 10}}

    def render_prompt(self, service, variables):
        return "{restaurant}|{documents}".format(**variables)


def _client(content):
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    return (
        SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
        calls,
    )


async def test_the_synthesizer_sends_every_document_once_with_the_strict_schema():
    client, calls = _client(json.dumps(answer()))

    raw, model = await synthesis.MenuSynthesizer(client, _Registry()).synthesize("Casa", "R. A, 1", "", DOCS)

    assert model == "m-1" and raw["confidence"] == "high"
    assert len(calls) == 1 and calls[0]["response_format"]["json_schema"]["strict"] is True
    prompt = calls[0]["messages"][0]["content"]
    assert "=== DOCUMENT 0 | pdf" in prompt and "=== DOCUMENT 1 | html" in prompt


async def test_an_invalid_reply_fails_with_a_short_message():
    client, _ = _client("not json at all")

    with pytest.raises(ValueError, match="invalid JSON"):
        await synthesis.MenuSynthesizer(client, _Registry()).synthesize("Casa", "", "", DOCS)


def test_a_house_fact_stays_only_when_its_excerpt_is_in_the_page():
    docs = [{"index": 0, "url": "u", "text": "Reservas pelo   telefone\n3065-5560 (de terça a sábado)\nCOL B texto"}]
    raw = answer(
        documents=[{"index": 0, "role": "other", "note": None}],
        per_person={"lunch": None, "dinner": None},
        facts=[
            {
                "topic": "reservations",
                "fact": "Reserva por telefone.",
                "evidence": "Reservas pelo telefone 3065-5560",
                "page": 0,
            },
            {"topic": "pets", "fact": "Aceita pets.", "evidence": "pets são bem-vindos", "page": 0},
        ],
    )

    brief, issues = synthesis.verify(raw, docs)

    assert [f["topic"] for f in brief["facts"]] == ["reservations"]
    assert [i["problem"] for i in issues] == ["fact_without_evidence"]


def test_an_excerpt_split_by_a_pdf_column_is_still_found():
    words = synthesis._words("CRIANÇAS ATÉ   R$ 89 Picanha 06 ANOS NÃO PAGAM")
    assert synthesis.evidence_found("Crianças até 06 anos não pagam", words)
    assert not synthesis.evidence_found("Crianças até 12 anos não pagam", words)


def test_a_price_a_pdf_repeats_is_read_once():
    assert {58.0, 147.0} <= synthesis.price_mentions("COULANT 5858\nCOMBINADO 1 PESSOA 147147")


def test_low_confidence_without_a_price_is_not_a_problem():
    raw = answer(confidence="low", per_person={"lunch": None, "dinner": None})

    _, issues = synthesis.verify(raw, DOCS)

    assert issues == []


async def test_the_triage_returns_a_verdict_per_known_page():
    reply = {"pages": [
        {"index": 0, "useful": True, "topics": ["menu", "bogus"], "reason": "cardápio"},
        {"index": 7, "useful": True, "topics": ["menu"], "reason": "not a page we sent"},
    ]}  # fmt: skip
    client, calls = _client(json.dumps(reply))

    class Registry(_Registry):
        def get_config(self, service):
            return {"model": "light", "config": {}}

        def render_prompt(self, service, variables):
            assert service == "site_triage_text"
            return variables["pages"]

    verdicts = await synthesis.SiteTriager(client, Registry()).triage("Casa", "", DOCS)

    assert verdicts == {0: {"useful": True, "topics": ["menu"], "reason": "cardápio"}}
    assert "[1] html | https://casa.example/natal" in calls[0]["messages"][0]["content"]


def test_a_site_concept_stays_only_when_its_excerpt_is_in_a_page():
    raw = answer(
        concepts=[
            {"category": "menu", "value": " Tasting Menu ", "evidence": "Polvo 1.249,00", "page": 0},
            {"category": "special_features", "value": "pet friendly", "evidence": "aceitamos pets", "page": 0},
            {"category": "menu", "value": "tasting menu", "evidence": "Polvo 1.249,00", "page": 0},
        ]
    )

    brief, issues = synthesis.verify(raw, DOCS)

    assert brief["concepts"] == [{"category": "menu", "value": "tasting menu", "evidence": "Polvo 1.249,00", "page": 0}]
    (dropped,) = [i for i in issues if i["problem"] == "concept_without_evidence"]
    assert dropped["value"] == "pet friendly" and "concept_without_evidence" not in synthesis.BLOCKING


def test_site_concepts_use_only_factual_categories():
    schema = synthesis.RESPONSE_FORMAT["json_schema"]["schema"]["properties"]["concepts"]
    categories = schema["items"]["properties"]["category"]["enum"]

    assert "mood" not in categories and "crowd" not in categories and "price_range" not in categories
    assert {"menu", "special_features", "suitable_for"} <= set(categories)
