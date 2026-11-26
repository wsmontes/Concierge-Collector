"""
File: menu_synthesis.py
Purpose: the two model passes over a restaurant's website, and what the code checks after them:
    1. triage (light model, "site_triage_text"): from the url, title and start of every collected page,
       which pages are useful to a concierge for THIS unit, and their topics;
    2. brief (strong model, "menu_synthesis_text"): from the full text of the useful pages, the menu
       brief (which document is the dining-room menu, formats, a typical meal per person, wine, dietary
       options) and the house facts (booking, hours, events, chef, policies…), each with a verbatim excerpt.
Dependencies: an OpenAI client (app.state.openai_service.client) and the config registry
    (openai_configs: model, prompt_template, config kwargs per service).
Spec: docs/superpowers/specs/2026-11-26-entity-menu-design.md (v2: raw pages + brief).

Division of labour:
- The model DECIDES: document roles (dining room, delivery, shop/orders, event, another unit…), formats
  (à la carte, rodízio, tasting…), and which dishes make a typical meal (it cites them with their price
  and the document they come from). It never adds numbers up.
- The code VERIFIES, never interprets: the price per person is the sum of the cited dishes (or the one
  fixed price, for rodízio/prix fixe); every cited price, and every other price in the brief, must appear
  in the text it came from; a citation of a non-dining-room document, or a price claimed with low
  confidence, is flagged. Those flags send the brief to a curator (`needs_review`). A house fact whose
  excerpt is not in the pages (its words in order, in a short window: PDF columns interleave lines) is
  left out and recorded; nothing is silently "cleaned".
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

SERVICE = "menu_synthesis_text"
TRIAGE_SERVICE = "site_triage_text"
# Bump when a prompt or the brief's shape changes: every stored brief is synthesized again on refresh.
SYNTHESIS_VERSION = 2
TRIAGE_SNIPPET_CHARS = 1200
PAGE_TOPICS = (
    "menu",
    "drinks_wine",
    "reservations",
    "hours_location",
    "events_private_dining",
    "about_chef_story",
    "amenities_policies",
    "awards_press",
    "other_unit",
    "delivery_shop",
    "none",
)
FACT_TOPICS = (
    "reservations",
    "hours",
    "location_access",
    "events_private_dining",
    "chef_concept",
    "dress_code",
    "kids",
    "pets",
    "accessibility",
    "outdoor_seating",
    "parking",
    "payment_service",
    "corkage",
    "awards",
    "dietary",
    "signature_dishes",
    "ambience",
    "other",
)
# Issues that send a brief to a curator; a house fact without evidence is only left out.
BLOCKING = ("price_not_in_document", "price_not_in_documents", "not_dining_room", "fixed_price_needs_one_price",
            "low_confidence")  # fmt: skip
MAX_INPUT_CHARS = 150_000
ROLES = (
    "dining_room",
    "delivery",
    "orders_or_shop",
    "drinks",
    "event",
    "other_unit",
    "not_a_menu",
    "other",
)
FORMATS = ("a_la_carte", "rodizio", "tasting", "executive", "buffet", "prix_fixe")
DIETARY = ("vegetarian", "vegan", "gluten_free", "seafood", "kids")
CONFIDENCE = ("high", "medium", "low")
MAX_PRICE_BRL = 100_000

_STR = {"type": ["string", "null"]}
_NUM = {"type": ["number", "null"]}
_ESTIMATE = {
    "type": ["object", "null"],
    "additionalProperties": False,
    "required": ["basis", "fixed_price", "note"],
    "properties": {
        "basis": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["item", "price_brl", "document"],
                "properties": {
                    "item": {"type": "string"},
                    "price_brl": {"type": "number"},
                    "document": {"type": "integer"},
                },
            },
        },
        "fixed_price": {"type": "boolean"},
        "note": _STR,
    },
}
RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "menu_brief",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "documents",
                "formats",
                "per_person",
                "executive_lunch_brl",
                "tasting_menus",
                "couvert_brl",
                "corkage_brl",
                "wine",
                "dietary",
                "highlights",
                "caveats",
                "summary",
                "menu_date",
                "confidence",
                "facts",
                "house_summary",
            ],
            "properties": {
                "documents": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["index", "role", "note"],
                        "properties": {
                            "index": {"type": "integer"},
                            "role": {"type": "string", "enum": list(ROLES)},
                            "note": _STR,
                        },
                    },
                },
                "formats": {
                    "type": "array",
                    "items": {"type": "string", "enum": list(FORMATS)},
                },
                "per_person": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["lunch", "dinner"],
                    "properties": {"lunch": _ESTIMATE, "dinner": _ESTIMATE},
                },
                "executive_lunch_brl": _NUM,
                "tasting_menus": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["name", "price_brl", "courses"],
                        "properties": {
                            "name": {"type": "string"},
                            "price_brl": {"type": "number"},
                            "courses": {"type": ["integer", "null"]},
                        },
                    },
                },
                "couvert_brl": _NUM,
                "corkage_brl": _NUM,
                "wine": {
                    "type": ["object", "null"],
                    "additionalProperties": False,
                    "required": [
                        "by_the_glass",
                        "bottle_min_brl",
                        "bottle_max_brl",
                        "note",
                    ],
                    "properties": {
                        "by_the_glass": {"type": ["boolean", "null"]},
                        "bottle_min_brl": _NUM,
                        "bottle_max_brl": _NUM,
                        "note": _STR,
                    },
                },
                "dietary": {
                    "type": "array",
                    "items": {"type": "string", "enum": list(DIETARY)},
                },
                "highlights": {"type": "array", "items": {"type": "string"}},
                "caveats": {"type": "array", "items": {"type": "string"}},
                "summary": {"type": "string"},
                "menu_date": _STR,
                "confidence": {"type": "string", "enum": list(CONFIDENCE)},
                "facts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["topic", "fact", "evidence", "page"],
                        "properties": {
                            "topic": {"type": "string", "enum": list(FACT_TOPICS)},
                            "fact": {"type": "string"},
                            "evidence": {"type": "string"},
                            "page": {"type": "integer"},
                        },
                    },
                },
                "house_summary": {"type": "string"},
            },
        },
    },
}


# ------------------------------------------------------------------------------ input ----
def fit_documents(documents: List[Dict[str, Any]], max_chars: int = MAX_INPUT_CHARS) -> List[Tuple[int, str]]:
    """(index, text) for the model, sharing max_chars fairly: short documents whole, long ones cut."""
    texts = [(int(d["index"]), d.get("text") or "") for d in documents]
    budget = {index: 0 for index, _ in texts}
    remaining = max_chars
    pending = sorted(texts, key=lambda pair: len(pair[1]))
    while pending:
        share = remaining // len(pending)
        index, text = pending.pop(0)
        budget[index] = min(len(text), share)
        remaining -= budget[index]
    return [(index, text[: budget[index]]) for index, text in texts]


def render_documents(documents: List[Dict[str, Any]], max_chars: int = MAX_INPUT_CHARS) -> str:
    meta = {int(d["index"]): d for d in documents}
    blocks = []
    for index, text in fit_documents(documents, max_chars):
        d = meta[index]
        cut = " (cut)" if len(text) < len(d.get("text") or "") else ""
        topics = d.get("topics") or d.get("covers")
        blocks.append(f"=== DOCUMENT {index} | {d.get('kind')} | topics: {topics} | {d.get('url')}{cut} ===\n{text}")
    return "\n\n".join(blocks)


# ------------------------------------------------------------------------------ verify ----
# Prices as menus write them: "1.249,00", "260,00", "R$ 36", "110", "89.90".
_NUMBER = re.compile(r"(?<![\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d])")


def price_mentions(text: str) -> set:
    """Every number in the text read as reais (thousands with '.', decimals with ',' or '.')."""
    found = set()
    for token in _NUMBER.findall(text or ""):
        if re.fullmatch(r"\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?", token):
            value = token.replace(".", "").replace(",", ".")
        else:
            value = token.replace(",", ".")
        try:
            found.add(round(float(value), 2))
        except ValueError:
            continue
        # Some PDFs draw bold text twice and their text layer repeats it: "5858" is R$ 58.
        half = len(token) // 2
        if len(token) % 2 == 0 and token.isdigit() and token[:half] == token[half:]:
            found.add(float(token[:half]))
    return found


def _words(text: str) -> List[str]:
    plain = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", plain)


def evidence_found(evidence: str, page_words: List[str]) -> bool:
    """The excerpt's words appear in order in the page, within a short window (PDF columns interleave)."""
    wanted = _words(evidence)
    if len(wanted) < 2:
        return False
    window = max(len(wanted) * 3, len(wanted) + 8)
    for start, word in enumerate(page_words):
        if word != wanted[0]:
            continue
        i, j = 1, start + 1
        while i < len(wanted) and j < len(page_words) and j - start < window:
            if page_words[j] == wanted[i]:
                i += 1
            j += 1
        if i == len(wanted):
            return True
    return False


def _price(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value < MAX_PRICE_BRL:
        return None
    return round(float(value), 2)


def _texts(documents: List[Dict[str, Any]]) -> Dict[int, set]:
    return {int(d["index"]): price_mentions(d.get("text") or "") for d in documents}


def verify(raw: Dict[str, Any], documents: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """The brief the code stands behind, and what it could not confirm (each a short, typed note)."""
    mentions = _texts(documents)
    everywhere = set().union(*mentions.values()) if mentions else set()
    issues: List[Dict[str, Any]] = []
    roles = {}
    for entry in raw.get("documents") or []:
        index = entry.get("index")
        if index in mentions and entry.get("role") in ROLES:
            roles[index] = {
                "index": index,
                "role": entry["role"],
                "note": entry.get("note"),
            }
    for index in mentions:  # a document the model did not classify is "other", never silently dining room
        roles.setdefault(index, {"index": index, "role": "other", "note": None})
    dining = {i for i, r in roles.items() if r["role"] == "dining_room"}

    def grounded(value: Optional[float], field: str) -> Optional[float]:
        if value is not None and value not in everywhere:
            issues.append(
                {
                    "field": field,
                    "price_brl": value,
                    "problem": "price_not_in_documents",
                }
            )
        return value

    per_person: Dict[str, Any] = {"lunch": None, "dinner": None}
    fixed_price: Dict[str, bool] = {}
    basis: Dict[str, List[dict]] = {}
    notes: Dict[str, str] = {}
    for meal in ("lunch", "dinner"):
        estimate = (raw.get("per_person") or {}).get(meal)
        if not isinstance(estimate, dict):
            continue
        cited = []
        for part in estimate.get("basis") or []:
            price, index = _price(part.get("price_brl")), part.get("document")
            if price is None:
                continue
            item = {
                "item": str(part.get("item") or "")[:200],
                "price_brl": price,
                "document": index,
            }
            cited.append(item)
            if index not in mentions or price not in mentions[index]:
                issues.append(
                    {
                        "field": f"per_person.{meal}",
                        **item,
                        "problem": "price_not_in_document",
                    }
                )
            elif index not in dining:
                issues.append(
                    {
                        "field": f"per_person.{meal}",
                        **item,
                        "problem": "not_dining_room",
                    }
                )
        if not cited:
            continue
        fixed = bool(estimate.get("fixed_price"))
        if fixed and len(cited) != 1:
            issues.append(
                {
                    "field": f"per_person.{meal}",
                    "problem": "fixed_price_needs_one_price",
                }
            )
        per_person[meal] = round(sum(c["price_brl"] for c in cited), 2) if not fixed else cited[0]["price_brl"]
        fixed_price[meal] = fixed
        basis[meal] = cited
        if estimate.get("note"):
            notes[meal] = str(estimate["note"])[:300]

    tasting = []
    for t in raw.get("tasting_menus") or []:
        price = _price(t.get("price_brl"))
        if price is not None:
            tasting.append(
                {
                    "name": str(t.get("name") or "")[:120],
                    "price_brl": grounded(price, "tasting_menus"),
                    "courses": t.get("courses"),
                }
            )
    wine_raw = raw.get("wine") if isinstance(raw.get("wine"), dict) else None
    wine = None
    if wine_raw:
        wine = {
            "by_the_glass": wine_raw.get("by_the_glass"),
            "bottle_min_brl": grounded(_price(wine_raw.get("bottle_min_brl")), "wine.bottle_min_brl"),
            "bottle_max_brl": grounded(_price(wine_raw.get("bottle_max_brl")), "wine.bottle_max_brl"),
            "note": (str(wine_raw.get("note"))[:300] if wine_raw.get("note") else None),
        }
    confidence = raw.get("confidence") if raw.get("confidence") in CONFIDENCE else "low"
    if confidence == "low" and (per_person["lunch"] or per_person["dinner"]):
        issues.append({"field": "confidence", "problem": "low_confidence"})  # a price claimed while unsure

    page_words = {int(d["index"]): _words(d.get("text") or "") for d in documents}
    facts = []
    for item in raw.get("facts") or []:
        if not isinstance(item, dict) or item.get("topic") not in FACT_TOPICS or not item.get("fact"):
            continue
        fact = {
            "topic": item["topic"],
            "fact": str(item["fact"])[:400],
            "evidence": str(item.get("evidence") or "")[:400],
            "page": item.get("page"),
        }
        if item.get("page") in page_words and evidence_found(fact["evidence"], page_words[item["page"]]):
            facts.append(fact)
            continue
        elsewhere = next((i for i, w in page_words.items() if evidence_found(fact["evidence"], w)), None)
        if elsewhere is not None:
            facts.append({**fact, "page": elsewhere})
        else:
            issues.append({"field": "facts", **fact, "problem": "fact_without_evidence"})

    brief = {
        "documents": [roles[i] for i in sorted(roles)],
        "formats": [f for f in dict.fromkeys(raw.get("formats") or []) if f in FORMATS],
        "per_person_brl": (per_person if (per_person["lunch"] or per_person["dinner"]) else None),
        "per_person_fixed": fixed_price,  # per meal: rodízio, executive or prix fixe price (not a sum)
        "per_person_basis": basis,
        "per_person_notes": notes,
        "executive_lunch_brl": grounded(_price(raw.get("executive_lunch_brl")), "executive_lunch_brl"),
        "tasting_menus": tasting,
        "couvert_brl": grounded(_price(raw.get("couvert_brl")), "couvert_brl"),
        "corkage_brl": grounded(_price(raw.get("corkage_brl")), "corkage_brl"),
        "wine": wine,
        "dietary": [d for d in dict.fromkeys(raw.get("dietary") or []) if d in DIETARY],
        "highlights": [str(h)[:200] for h in (raw.get("highlights") or [])[:12]],
        "caveats": [str(c)[:300] for c in (raw.get("caveats") or [])[:8]],
        "summary": str(raw.get("summary") or "")[:1200],
        "menu_date": (str(raw.get("menu_date"))[:20] if raw.get("menu_date") else None),
        "confidence": confidence,
        "facts": facts[:80],
        "house_summary": str(raw.get("house_summary") or "")[:2000],
    }
    return brief, issues


# ---------------------------------------------------------------------------- the models ----
TRIAGE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "page_triage",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["pages"],
            "properties": {
                "pages": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["index", "useful", "topics", "reason"],
                        "properties": {
                            "index": {"type": "integer"},
                            "useful": {"type": "boolean"},
                            "topics": {"type": "array", "items": {"type": "string", "enum": list(PAGE_TOPICS)}},
                            "reason": {"type": "string"},
                        },
                    },
                },
            },
        },
    },
}


def render_snippets(pages: List[Dict[str, Any]]) -> str:
    """What the triage model sees of each page: index, kind, url, title and the start of the text."""
    blocks = []
    for page in pages:
        snippet = re.sub(r"\s+", " ", (page.get("text") or "")[:TRIAGE_SNIPPET_CHARS])
        blocks.append(
            f"[{page['index']}] {page.get('kind')} | {page.get('url')} | title: {page.get('title')}\n{snippet}"
        )
    return "\n\n".join(blocks)


def _call(client: Any, config: Dict[str, Any], prompt: str, response_format: dict) -> Dict[str, Any]:
    response = client.chat.completions.create(
        model=config["model"],
        messages=[{"role": "user", "content": prompt}],
        response_format=response_format,
        **(config.get("config") or {}),
    )
    content = (response.choices[0].message.content or "").strip()
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        raise ValueError("the model returned invalid JSON") from None
    if not isinstance(parsed, dict):
        raise ValueError("the model returned an unexpected shape")
    return parsed


class SiteTriager:
    """Which collected pages are useful for THIS unit, and their topics (one light-model call per site)."""

    def __init__(self, client: Any, registry: Any):
        self.client = client
        self.registry = registry

    async def triage(self, restaurant: str, address: str, pages: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
        config = self.registry.get_config(TRIAGE_SERVICE)
        prompt = self.registry.render_prompt(
            TRIAGE_SERVICE, {"restaurant": restaurant, "address": address or "", "pages": render_snippets(pages)}
        )
        parsed = await asyncio.to_thread(_call, self.client, config, prompt, TRIAGE_FORMAT)
        known = {int(p["index"]) for p in pages}
        verdicts = {}
        for entry in parsed.get("pages") or []:
            if entry.get("index") in known:
                verdicts[entry["index"]] = {
                    "useful": entry.get("useful") is True,
                    "topics": [t for t in entry.get("topics") or [] if t in PAGE_TOPICS],
                    "reason": str(entry.get("reason") or "")[:200],
                }
        return verdicts


class MenuSynthesizer:
    def __init__(self, client: Any, registry: Any, *, max_chars: int = MAX_INPUT_CHARS):
        self.client = client
        self.registry = registry
        self.max_chars = max_chars

    async def synthesize(
        self,
        restaurant: str,
        address: str,
        context: str,
        documents: List[Dict[str, Any]],
    ) -> Tuple[Dict[str, Any], Optional[str]]:
        """The model's raw brief (unverified) and the model name. Invalid JSON raises a short ValueError."""
        config = self.registry.get_config(SERVICE)
        prompt = self.registry.render_prompt(
            SERVICE,
            {
                "restaurant": restaurant,
                "address": address or "",
                "context": context or "",
                "documents": render_documents(documents, self.max_chars),
            },
        )
        parsed = await asyncio.to_thread(_call, self.client, config, prompt, RESPONSE_FORMAT)
        return parsed, config.get("model")
