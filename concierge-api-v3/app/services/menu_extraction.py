"""
File: menu_extraction.py
Purpose: turn the text of one menu document into structured items, and say whether it is the menu of
    this restaurant at all (not a hotel price list, a blog post, a reservation widget).
Dependencies: an OpenAI client (app.state.openai_service.client) and the config registry
    (openai_configs, service "menu_extraction_text": model, prompt_template, config kwargs).

The model only reads and classifies; numbers derived from the items are computed in menu_derive.
Long documents are split at line boundaries and read in parallel parts, then merged without repeats.
A reply that is not valid JSON fails the extraction with a short message (never the provider's text).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SERVICE = "menu_extraction_text"
MAX_CHARS = 12_000
PARALLEL_PARTS = 3
SECTIONS = ("starter", "main", "dessert", "side", "drink", "tasting", "executive", "couvert", "corkage", "other")
TAGS = ("vegetarian", "vegan", "seafood", "meat", "pasta", "light", "gluten_free", "cocktail", "spicy", "kids")
MEALS = ("lunch", "dinner", "all")
MAX_PRICE_BRL = 100_000

_NULLABLE_STRING = {"type": ["string", "null"]}
_ITEM = {
    "type": "object",
    "additionalProperties": False,
    "required": ["section", "subsection", "name", "description", "price_brl", "prices", "tags", "meal", "wine"],
    "properties": {
        "section": {"type": "string", "enum": list(SECTIONS)},
        "subsection": _NULLABLE_STRING,
        "name": {"type": "string"},
        "description": _NULLABLE_STRING,
        "price_brl": {"type": ["number", "null"]},
        "prices": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "brl"],
                "properties": {"label": {"type": "string"}, "brl": {"type": "number"}},
            },
        },
        "tags": {"type": "array", "items": {"type": "string", "enum": list(TAGS)}},
        "meal": {"type": "string", "enum": list(MEALS)},
        "wine": {
            "type": ["object", "null"],
            "additionalProperties": False,
            "required": ["producer", "vintage", "region", "grapes"],
            "properties": {
                "producer": _NULLABLE_STRING,
                "vintage": {"type": ["integer", "null"]},
                "region": _NULLABLE_STRING,
                "grapes": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
}
RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "restaurant_menu",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["is_menu_of_this_place", "reason", "menu_date", "items"],
            "properties": {
                "is_menu_of_this_place": {"type": "boolean"},
                "reason": _NULLABLE_STRING,
                "menu_date": _NULLABLE_STRING,
                "items": {"type": "array", "items": _ITEM},
            },
        },
    },
}


@dataclass
class ExtractionResult:
    is_menu: bool
    items: List[Dict[str, Any]] = field(default_factory=list)
    reason: Optional[str] = None
    menu_date: Optional[str] = None
    model: Optional[str] = None
    parts: int = 0


def split_for_model(texts: List[str], max_chars: int = MAX_CHARS) -> List[str]:
    """Parts of at most max_chars, cut at line boundaries (a single longer line is cut where it must)."""
    parts: List[str] = []
    for text in texts:
        current: List[str] = []
        size = 0
        for line in (text or "").splitlines():
            while len(line) > max_chars:
                if current:
                    parts.append("\n".join(current))
                    current, size = [], 0
                parts.append(line[:max_chars])
                line = line[max_chars:]
            if current and size + len(line) + 1 > max_chars:
                parts.append("\n".join(current))
                current, size = [], 0
            current.append(line)
            size += len(line) + 1
        if current and "".join(current).strip():
            parts.append("\n".join(current))
    return [part for part in parts if part.strip()]


def _key(item: Dict[str, Any]) -> tuple:
    name = unicodedata.normalize("NFKD", item["name"]).encode("ascii", "ignore").decode().lower()
    prices = tuple(sorted((p["label"].lower(), p["brl"]) for p in item.get("prices") or []))
    return (item["section"], re.sub(r"\W+", " ", name).strip(), item.get("price_brl"), prices)


def _price(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value < MAX_PRICE_BRL:
        return None
    return float(value)


def _clean(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or "").strip()
    if not name:
        return None
    section = raw.get("section") if raw.get("section") in SECTIONS else "other"
    prices = [
        {"label": str(p.get("label") or "").strip(), "brl": brl}
        for p in raw.get("prices") or []
        if isinstance(p, dict) and (brl := _price(p.get("brl"))) is not None
    ]
    wine = raw.get("wine") if isinstance(raw.get("wine"), dict) else None
    return {
        "section": section,
        "subsection": (str(raw.get("subsection")).strip() or None) if raw.get("subsection") else None,
        "name": name[:300],
        "description": (str(raw.get("description")).strip()[:600] or None) if raw.get("description") else None,
        "price_brl": _price(raw.get("price_brl")),
        "prices": prices,
        "tags": [t for t in dict.fromkeys(raw.get("tags") or []) if t in TAGS],
        "meal": raw.get("meal") if raw.get("meal") in MEALS else "all",
        "wine": wine,
    }


class MenuExtractor:
    def __init__(self, client: Any, registry: Any, *, max_chars: int = MAX_CHARS):
        self.client = client
        self.registry = registry
        self.max_chars = max_chars

    async def _read(self, part: str, restaurant: str, address: str, config: Dict[str, Any]) -> Dict[str, Any]:
        prompt = self.registry.render_prompt(SERVICE, {"restaurant": restaurant, "address": address, "text": part})
        response = await asyncio.to_thread(
            self.client.chat.completions.create,
            model=config["model"],
            messages=[{"role": "user", "content": prompt}],
            response_format=RESPONSE_FORMAT,
            **(config.get("config") or {}),
        )
        content = (response.choices[0].message.content or "").strip()
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            raise ValueError("menu extraction returned invalid JSON") from None
        if not isinstance(parsed, dict):
            raise ValueError("menu extraction returned an unexpected shape")
        return parsed

    async def extract(self, restaurant: str, address: str, texts: List[str]) -> ExtractionResult:
        config = self.registry.get_config(SERVICE)
        parts = split_for_model(texts, self.max_chars)
        if not parts:
            return ExtractionResult(is_menu=False, reason="empty", model=config.get("model"))
        gate = asyncio.Semaphore(PARALLEL_PARTS)

        async def one(part: str) -> Dict[str, Any]:
            async with gate:
                return await self._read(part, restaurant, address or "", config)

        answers = await asyncio.gather(*(one(part) for part in parts))
        accepted = [a for a in answers if a.get("is_menu_of_this_place") is True]
        items: List[Dict[str, Any]] = []
        seen: set = set()
        for answer in accepted:
            for raw in answer.get("items") or []:
                item = _clean(raw)
                if item is None or _key(item) in seen:
                    continue
                seen.add(_key(item))
                items.append(item)
        refused = next((a for a in answers if a.get("is_menu_of_this_place") is not True), {})
        return ExtractionResult(
            is_menu=bool(accepted),
            items=items,
            reason=None if accepted else (str(refused.get("reason") or "not_a_menu")[:200]),
            menu_date=next((a.get("menu_date") for a in accepted if a.get("menu_date")), None),
            model=config.get("model"),
            parts=len(parts),
        )
