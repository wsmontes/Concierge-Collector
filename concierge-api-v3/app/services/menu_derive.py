"""
File: menu_derive.py
Purpose: the numbers a restaurant's menu yields, computed in code from the extracted items (the model
    only reads and classifies; it never estimates a price).
Dependencies: stdlib only.

"Por pessoa" (decided 2026-11-26) = median starter + median main + median dessert, without drinks and
without the 13% service. Lunch and dinner are computed apart when the menu marks its items; tasting and
executive menus are reported on their own and never enter the average. A dish priced "para dois" counts
half. Values are whole reais, rounded half up.

Item shape (from menu_extraction): {"section", "name", "price_brl" | "prices": [{"label", "brl"}],
"tags": [...], "meal": "lunch" | "dinner" | "all", "wine": {...} | None, ...}.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

COURSES = ("starter", "main", "dessert")
_FOR_TWO = re.compile(r"\b(para|p/)\s*(dois|duas|2)\b|\b2\s*pessoas\b|\bfor\s*two\b", re.I)
# Whole words only: "Atacama" is not "taça", "Jacopo" is not "copo".
_GLASS = re.compile(r"\b(ta[cç]as?|glass|copos?|c[aá]lice|bicchiere|calice|copa)\b|\b(1[0-9]{2})\s?ml\b", re.I)
_BOTTLE = re.compile(r"\b(garrafa|bottle|btl)\b", re.I)
_DIET_TAGS = {
    "vegetarian": "vegetarian_options",
    "vegan": "vegan_options",
    "seafood": "seafood",
    "light": "light_options",
    "gluten_free": "gluten_free_options",
}


def _round(value: float) -> int:
    return int(value + 0.5)


def _percentile(values: List[float], q: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def _stats(values: List[float]) -> Optional[Dict[str, int]]:
    if not values:
        return None
    return {
        "min": _round(min(values)),
        "p25": _round(_percentile(values, 0.25)),
        "median": _round(_percentile(values, 0.5)),
        "p75": _round(_percentile(values, 0.75)),
        "max": _round(max(values)),
        "count": len(values),
    }


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return None
    return float(value)


def unit_price(item: Dict[str, Any]) -> Optional[float]:
    """The price of one portion for one person (a dish for two counts half; the smallest option otherwise)."""
    single = _number(item.get("price_brl"))
    if single is not None:
        return single / 2 if _FOR_TWO.search(str(item.get("name") or "")) else single
    options = []
    for option in item.get("prices") or []:
        brl = _number((option or {}).get("brl"))
        if brl is not None:
            options.append(brl / 2 if _FOR_TWO.search(str(option.get("label") or "")) else brl)
    return min(options) if options else None


def _priced(items: Iterable[Dict[str, Any]], section: str, meal: Optional[str] = None) -> List[float]:
    out = []
    for item in items:
        if item.get("section") != section:
            continue
        if meal and (item.get("meal") or "all") not in (meal, "all"):
            continue
        price = unit_price(item)
        if price is not None:
            out.append(price)
    return out


def _per_person(items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    result: Dict[str, Any] = {}
    partial = False
    for meal in ("lunch", "dinner"):
        medians = {course: _priced(items, course, meal) for course in COURSES}
        if not medians["main"]:
            return None
        partial = partial or not all(medians.values())
        result[meal] = _round(sum(_percentile(values, 0.5) for values in medians.values() if values))
    return {**result, "basis": "starter+main+dessert", "partial": partial}


def _drinks(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    glass, bottle, cocktails, labels = [], [], [], 0
    for item in items:
        if item.get("section") != "drink":
            continue
        is_wine = bool(item.get("wine")) or re.search(
            r"vinho|wine|tinto|branco|ros[eé]|espumante", str(item.get("subsection") or ""), re.I
        )
        if is_wine:
            labels += 1
            options = item.get("prices") or []
            if options:
                for option in options:
                    brl = _number((option or {}).get("brl"))
                    label = str((option or {}).get("label") or "")
                    if brl is None:
                        continue
                    (glass if _GLASS.search(label) else bottle).append(brl)
            elif _number(item.get("price_brl")) is not None:
                by_the_glass = _GLASS.search(f"{item.get('subsection') or ''} {item.get('name') or ''}")
                (glass if by_the_glass else bottle).append(float(item["price_brl"]))
        elif "cocktail" in (item.get("tags") or []) or re.search(
            r"coquet|cocktail|drink", str(item.get("subsection") or ""), re.I
        ):
            price = unit_price(item)
            if price is not None:
                cocktails.append(price)
    return {
        "wine_by_glass_brl": {"median": _round(_percentile(glass, 0.5)), "count": len(glass)} if glass else None,
        "wine_bottle_brl": (
            {"min": _round(min(bottle)), "median": _round(_percentile(bottle, 0.5)), "count": len(bottle)}
            if bottle
            else None
        ),
        "cocktail_brl": {"median": _round(_percentile(cocktails, 0.5)), "count": len(cocktails)} if cocktails else None,
        "wine_labels": labels,
    }


def derive(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    items = [item for item in items or [] if isinstance(item, dict)]
    executive = _priced(items, "executive")
    couvert = _priced(items, "couvert")
    corkage = _priced(items, "corkage")
    tags = {tag for item in items for tag in item.get("tags") or []}
    return {
        "per_person_brl": _per_person(items),
        **{f"{course}_brl": _stats(_priced(items, course)) for course in COURSES},
        "executive_lunch_brl": _round(_percentile(executive, 0.5)) if executive else None,
        "tasting_menus": [
            {"name": item.get("name"), "price_brl": _round(price)}
            for item in items
            if item.get("section") == "tasting" and (price := unit_price(item)) is not None
        ],
        # The typical charge: a stray line (bread, butter) classified as couvert does not set it.
        "couvert_brl": _round(_percentile(couvert, 0.5)) if couvert else None,
        "corkage_brl": _round(min(corkage)) if corkage else None,
        "drinks": _drinks(items),
        "tags": sorted(_DIET_TAGS[tag] for tag in tags if tag in _DIET_TAGS),
    }
