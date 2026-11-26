"""
File: test_menu_extraction.py
Purpose: the model turns menu text into items, says whether it is this restaurant's menu, and long menus
    are read in parts and merged without repeats.
Dependencies: app.services.menu_extraction (the OpenAI client and the config registry are faked).
"""

import json

import pytest

from app.services.menu_extraction import MenuExtractor, split_for_model

CONFIG = {"model": "test-model", "config": {"max_completion_tokens": 4000}, "prompt_template": "{restaurant}|{text}"}


class _Registry:
    def get_config(self, service):
        assert service == "menu_extraction_text"
        return CONFIG

    def render_prompt(self, service, variables):
        return f"{variables['restaurant']} @ {variables['address']}\n---\n{variables['text']}"


class _Completions:
    def __init__(self, answers):
        self.answers = list(answers)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        answer = self.answers.pop(0)
        content = answer if isinstance(answer, str) else json.dumps(answer)
        message = type("M", (), {"content": content})
        return type("R", (), {"choices": [type("C", (), {"message": message})]})


class _Client:
    def __init__(self, answers):
        self.chat = type("Chat", (), {"completions": _Completions(answers)})()


def dish(name, price, section="main"):
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
    }


def answer(items, is_menu=True, reason=None, menu_date=None):
    return {"is_menu_of_this_place": is_menu, "reason": reason, "menu_date": menu_date, "items": items}


async def test_items_come_back_with_the_model_and_the_date_the_menu_declares():
    client = _Client([answer([dish("Fettuccine", 260), dish("Tiramisu", 58, "dessert")], menu_date="2026-09")])

    result = await MenuExtractor(client, _Registry()).extract("Picchi", "R. Oscar Freire, 533", ["Fettuccine 260,00"])

    assert result.is_menu and result.model == "test-model" and result.menu_date == "2026-09"
    assert [i["name"] for i in result.items] == ["Fettuccine", "Tiramisu"]
    call = client.chat.completions.calls[0]
    assert call["model"] == "test-model" and call["response_format"]["type"] == "json_schema"
    assert "Picchi @ R. Oscar Freire, 533" in call["messages"][0]["content"]


async def test_a_page_that_is_not_this_restaurants_menu_is_rejected_with_the_reason():
    client = _Client([answer([], is_menu=False, reason="hotel rooms price list")])

    result = await MenuExtractor(client, _Registry()).extract("Fasano", "", ["Suíte Deluxe R$ 3.200,00"])

    assert not result.is_menu and result.reason == "hotel rooms price list" and result.items == []


async def test_a_long_menu_is_read_in_parts_and_merged_without_repeats():
    client = _Client([answer([dish("Fettuccine", 260)]), answer([dish("Fettuccine", 260), dish("Polvo", 220)])])

    result = await MenuExtractor(client, _Registry(), max_chars=40).extract(
        "Picchi", "", ["Fettuccine 260,00\n" * 2 + "Polvo 220,00\n" * 2]
    )

    assert len(client.chat.completions.calls) == 2
    assert [i["name"] for i in result.items] == ["Fettuccine", "Polvo"]


async def test_invalid_items_are_dropped_and_sections_kept_to_the_known_ones():
    bad = dish("Sem nome", 10)
    bad["name"] = ""
    odd = dish("Pão", 36)
    odd["section"] = "bread"
    client = _Client([answer([dish("Fettuccine", 260), bad, odd, {"nonsense": True}])])

    result = await MenuExtractor(client, _Registry()).extract("Picchi", "", ["x"])

    assert [(i["name"], i["section"]) for i in result.items] == [("Fettuccine", "main"), ("Pão", "other")]


async def test_a_reply_that_is_not_json_fails_the_extraction_without_leaking_it():
    client = _Client(["not json at all, and some provider text"])

    with pytest.raises(ValueError) as error:
        await MenuExtractor(client, _Registry()).extract("Picchi", "", ["x"])

    assert "provider text" not in str(error.value)


def test_text_is_split_at_line_boundaries_under_the_limit():
    parts = split_for_model(["a" * 10 + "\n" + "b" * 10 + "\n" + "c" * 10], max_chars=22)

    assert parts == ["a" * 10 + "\n" + "b" * 10, "c" * 10]
