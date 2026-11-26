"""
File: menu_service.py
Purpose: an entity's menu — found on the restaurant's website, read (PDF/HTML), structured by the model,
    turned into numbers, stored, reviewed by a curator, and refreshed on demand or in the background.
Dependencies: menu_reading (links, text), menu_extraction (model), menu_derive (numbers),
    openai_service._validate_image_request_hook (the SSRF guard, on every request and redirect),
    display_media_service.extract_image_sources (where an entity keeps its website/place_id), settings.
Spec: docs/superpowers/specs/2026-11-26-entity-menu-design.md.

Storage:
- `entity_menus` (one document per entity, `_id` = entity `_id`): every source document, every item,
  the derived numbers, the status (auto | reviewed | needs_review | not_found) and the review.
- `entities.menu_summary`: a compact copy for cards, search and sorting, written with a field `$set`
  (like `display_media`): the entity's `version` never moves, so the offline Collector sees no conflict.

What a refresh keeps: a source whose text hash did not change is not read by the model again; a
curator's review is never overwritten — a change of 15% or more in the price per person, or a different
set of sources, marks it `needs_review`; when the site cannot be read, what was there stays and
`last_error` says why (short codes, never provider text or URLs in logs).

Background (no queue server-side, as in display_media): reads that find the menu missing or stale ask
for a refresh; one bounded in-process queue, one consumer, dedupe by entity. The document is the queue:
a restart loses nothing that the next read does not ask for again.
"""

from __future__ import annotations

import asyncio
import copy
import datetime as dt
import hashlib
import logging
import time
import urllib.robotparser
from collections import deque
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlsplit

import httpx

from app.core.config import settings
from app.services.display_media_service import extract_image_sources
from app.services.menu_derive import derive
from app.services.menu_reading import (
    classify_kind,
    count_prices,
    discover_menu_links,
    discover_named_pages,
    html_to_text,
    pdf_to_pages,
)

logger = logging.getLogger(__name__)

COLLECTION = "entity_menus"
SUMMARY_FIELD = "menu_summary"
MAX_SOURCES = 6
# Downloads per refresh (home excluded): menus are often two clicks away (home -> "Cardápio" page -> PDF
# or platform), so a menu page without prices is followed one level deeper, within this budget.
MAX_FETCHES = 14
MIN_PRICES_IN_A_MENU = 3
REVIEW_CHANGE = 0.15
LEASE_SECONDS = 300
MAX_BYTES = 15 * 1024 * 1024
USER_AGENT = "ConciergeCollector/1.0 (+https://concierge-collector.onrender.com)"
QUEUE_MAX = 100
_INTERNAL = ("lease_until", "next_allowed_at", "attempts")


class FetchFailed(Exception):
    """A download that failed for a reason worth telling the curator (short code, never the URL or body)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Fetched:
    url: str
    content_type: str
    body: bytes


@dataclass
class MenuDeps:
    fetch: Callable[[str], Awaitable[Optional[Fetched]]]
    extractor: Any  # .extract(restaurant, address, texts) -> ExtractionResult
    website_for: Callable[[str], Awaitable[Optional[str]]]


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _utc(value: Any) -> Optional[dt.datetime]:
    if not isinstance(value, dt.datetime):
        return None
    return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value


# ------------------------------------------------------------------ network (default deps) ----
_robots: Dict[str, Optional[urllib.robotparser.RobotFileParser]] = {}


async def _allowed_by_robots(client: httpx.AsyncClient, url: str) -> bool:
    parts = urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin not in _robots:
        parser: Optional[urllib.robotparser.RobotFileParser] = None
        try:
            response = await client.get(origin + "/robots.txt")
            if response.status_code == 200:
                parser = urllib.robotparser.RobotFileParser()
                parser.parse(response.text.splitlines())
        except ValueError:
            raise
        except Exception:  # noqa: BLE001 - no robots.txt is permission
            parser = None
        _robots[origin] = parser
    parser = _robots[origin]
    return parser is None or parser.can_fetch(USER_AGENT, url)


async def safe_fetch(url: str) -> Optional[Fetched]:
    """GET through the SSRF guard (every request and redirect), with a byte cap and robots.txt respected.

    A blocked address raises ValueError (the caller records `blocked`); anything else that fails is None.
    """
    from app.services.openai_service import _validate_image_request_hook

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(15.0, connect=5.0),
        event_hooks={"request": [_validate_image_request_hook]},
        headers={"User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9"},
    ) as client:
        try:
            allowed = await _allowed_by_robots(client, url)
        except httpx.HTTPError:
            allowed = True  # robots.txt unreachable: the page itself will say whether it can be read
        if not allowed:
            logger.info("[Menu] robots.txt disallows %s", urlsplit(url).netloc)
            return None
        try:
            async with client.stream("GET", url) as response:
                if response.status_code in (401, 403, 429):
                    raise FetchFailed("site_refused")  # the site refuses automated access; we do not disguise
                if response.status_code != 200:
                    return None
                chunks, total = [], 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_BYTES:
                        return None
                    chunks.append(chunk)
                return Fetched(str(response.url), response.headers.get("content-type", ""), b"".join(chunks))
        except (ValueError, FetchFailed):
            raise
        except httpx.TimeoutException:
            raise FetchFailed("timeout") from None
        except httpx.ConnectError as exc:
            # An expired or invalid certificate is not bypassed (verification stays on).
            raise FetchFailed(
                "tls_error" if "CERTIFICATE" in str(exc).upper() or "SSL" in str(exc).upper() else "site_unreachable"
            ) from None
        except Exception as exc:  # noqa: BLE001
            logger.info("[Menu] fetch failed for %s: %s", urlsplit(url).netloc, type(exc).__name__)
            return None


async def places_website(place_id: str) -> Optional[str]:
    """websiteUri from Google Places (New) for a place id; None when unknown or on any failure."""
    key = (settings.google_places_api_key or "").strip()
    if not key or not place_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"https://places.googleapis.com/v1/places/{place_id}",
                headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": "websiteUri"},
            )
        return response.json().get("websiteUri") if response.status_code == 200 else None
    except Exception as exc:  # noqa: BLE001
        logger.info("[Menu] Places website lookup failed: %s", type(exc).__name__)
        return None


def default_deps(openai_service: Any) -> MenuDeps:
    from app.services.menu_extraction import MenuExtractor

    return MenuDeps(
        fetch=safe_fetch,
        extractor=MenuExtractor(openai_service.client, openai_service.config_service),
        website_for=places_website,
    )


# ------------------------------------------------------------------------------- refresh ----
_running: set = set()
_budget = {"day": None, "used": 0}


def _spend_budget() -> bool:
    today = _now().date()
    if _budget["day"] != today:
        _budget.update(day=today, used=0)
    if _budget["used"] >= max(0, settings.menu_extraction_daily_limit):
        return False
    _budget["used"] += 1
    return True


def _place_id(entity: dict) -> Optional[str]:
    _, place_id = extract_image_sources(entity)
    if place_id:
        return place_id
    eid = str(entity.get("entity_id") or entity.get("_id") or "")
    return eid[len("entity_") :] if eid.startswith("entity_ChIJ") else None


def _address(entity: dict) -> str:
    data = entity.get("data") or {}
    location = data.get("location") or {}
    return str(data.get("address") or data.get("formatted_address") or location.get("address") or "")


def _text_of(fetched: Fetched) -> tuple[str, List[str]]:
    kind = classify_kind(fetched.url, fetched.content_type)
    if kind == "pdf":
        return kind, pdf_to_pages(fetched.body)
    if kind == "image":
        return kind, []  # phase 3: vision model
    text = html_to_text(fetched.body)
    return kind, [text] if text else []


def _dining_room(items: List[dict], sources: List[dict]) -> List[dict]:
    """Items that set the numbers: a delivery menu is kept, but it prices the dining room only when it is all
    there is (delivery prices and portions often differ)."""
    delivery = {s["index"] for s in sources if s.get("covers") == "delivery"}
    if not delivery or len(delivery) == len(sources):
        return items
    return [item for item in items if item.get("source") not in delivery]


def _per_person(derived: Optional[dict]) -> Optional[float]:
    value = ((derived or {}).get("per_person_brl") or {}).get("dinner")
    return float(value) if isinstance(value, (int, float)) else None


def _apply_overrides(derived: dict, overrides: Dict[str, Any]) -> dict:
    effective = copy.deepcopy(derived or {})
    for path, value in (overrides or {}).items():
        node = effective
        keys = str(path).split(".")
        for key in keys[:-1]:
            if not isinstance(node.get(key), dict):
                node[key] = {}
            node = node[key]
        node[keys[-1]] = value
    return effective


def _summary(menu: dict) -> dict:
    derived = _apply_overrides(menu.get("derived") or {}, (menu.get("review") or {}).get("overrides") or {})
    per_person = derived.get("per_person_brl") or None
    tasting = [t.get("price_brl") for t in derived.get("tasting_menus") or [] if t.get("price_brl")]
    return {
        "status": menu.get("status"),
        "as_of": menu.get("refreshed_at"),
        "per_person_brl": {k: per_person.get(k) for k in ("lunch", "dinner", "partial")} if per_person else None,
        "executive_lunch_brl": derived.get("executive_lunch_brl"),
        "tasting_min_brl": min(tasting) if tasting else None,
        "couvert_brl": derived.get("couvert_brl"),
        "corkage_brl": derived.get("corkage_brl"),
        "wine_labels": (derived.get("drinks") or {}).get("wine_labels", 0),
        "tags": derived.get("tags") or [],
        "sources": [s.get("kind") for s in menu.get("sources") or []],
    }


def _save(db, entity: dict, menu: dict) -> dict:
    db[COLLECTION].update_one({"_id": menu["_id"]}, {"$set": menu}, upsert=True)
    try:
        # Field $set only: the entity's version and updatedAt stay as they are (see module docstring).
        db.entities.update_one({"_id": entity["_id"]}, {"$set": {SUMMARY_FIELD: _summary(menu)}})
    except Exception as exc:  # noqa: BLE001 - a derived copy never fails the menu write
        logger.warning("[Menu] summary not written for %s: %s", entity.get("_id"), type(exc).__name__)
    return menu


async def refresh_menu(db, entity: dict, deps: MenuDeps, *, force: bool = False) -> dict:
    """Find, read, structure and store the entity's whole menu; returns the stored document."""
    key = entity["_id"]
    previous = db[COLLECTION].find_one({"_id": key}) or {}
    now = _now()
    allowed = _utc(previous.get("next_allowed_at"))
    lease = _utc(previous.get("lease_until"))
    if previous and not force and allowed and allowed > now:
        return previous
    if key in _running or (lease and lease > now):
        return previous or {"_id": key, "status": "refreshing"}
    _running.add(key)
    try:
        db[COLLECTION].update_one(
            {"_id": key}, {"$set": {"lease_until": now + dt.timedelta(seconds=LEASE_SECONDS)}}, upsert=True
        )
        return await _refresh(db, entity, deps, previous, now)
    finally:
        _running.discard(key)


async def _refresh(db, entity: dict, deps: MenuDeps, previous: dict, now: dt.datetime) -> dict:
    menu: dict = {
        "_id": entity["_id"],
        "entity_id": entity.get("entity_id") or entity["_id"],
        "website": previous.get("website"),
        "sources": previous.get("sources") or [],
        "items": previous.get("items") or [],
        "derived": previous.get("derived") or derive(previous.get("items") or []),
        "status": previous.get("status") or "not_found",
        "review": previous.get("review"),
        "rejected": [],
        "manual_sources": previous.get("manual_sources") or [],
        "last_error": None,
        "attempts": int(previous.get("attempts") or 0) + 1,
        "refreshed_at": now,
        "next_allowed_at": now + dt.timedelta(hours=settings.menu_refresh_min_hours),
        "lease_until": None,
        "updatedAt": now,
    }

    def failed(code: str) -> dict:
        menu["last_error"] = code
        if not previous.get("items"):
            menu["status"] = "not_found"
        logger.info("[Menu] %s: %s", entity["_id"], code)
        return _save(db, entity, menu)

    website, _ = extract_image_sources(entity)
    if not website and (place_id := _place_id(entity)):
        website = await deps.website_for(place_id)
    if not website:
        return failed("no_website")
    menu["website"] = website

    try:
        home = await deps.fetch(website)
    except ValueError:
        return failed("blocked")
    except FetchFailed as error:
        return failed(error.code)
    if home is None:
        return failed("site_unreachable")

    candidates = [(link.url, link.covers, "website_link") for link in discover_menu_links(home.body, home.url)]
    home_kind, home_text = _text_of(home)
    if home_text and count_prices("\n".join(home_text)) >= MIN_PRICES_IN_A_MENU * 3:
        candidates.append((home.url, "full", "website_home"))
    if not candidates:
        # A group's site (one site for many restaurants and units): go to the page of this unit first.
        named = discover_named_pages(home.body, home.url, entity.get("name") or "", _address(entity))
        candidates += [(url, "full", "website_link") for url in named[:2]]
    listed = {url for url, _, _ in candidates}
    candidates += [(url, "full", "manual") for url in previous.get("manual_sources") or [] if url not in listed]
    if not candidates:
        return failed("no_menu_link")

    known = {s.get("url"): s for s in previous.get("sources") or []}
    old_items = previous.get("items") or []
    sources: List[dict] = []
    items: List[dict] = []
    seen_hashes: set = set()
    manual = [c for c in candidates if c[2] == "manual"]
    work = [(*c, 1) for c in manual + [c for c in candidates if c[2] != "manual"]]
    queued = {c[0] for c in work} | {home.url}
    fetches = 0
    while work and len(sources) < MAX_SOURCES and fetches < MAX_FETCHES:
        url, covers, found_via, depth = work.pop(0)
        try:
            if url == home.url:
                fetched = home
            else:
                fetches += 1
                fetched = await deps.fetch(url)
        except ValueError:
            menu["rejected"].append({"url": url, "reason": "blocked"})
            continue
        except FetchFailed as error:
            menu["rejected"].append({"url": url, "reason": error.code})
            continue
        if fetched is None:
            continue
        kind, texts = _text_of(fetched)
        joined = "\n".join(texts)
        if count_prices(joined) < MIN_PRICES_IN_A_MENU:
            if kind in ("html", "platform") and depth == 1:
                deeper = [link for link in discover_menu_links(fetched.body, fetched.url) if link.url not in queued]
                queued.update(link.url for link in deeper)
                work.extend(
                    (link.url, link.covers if link.covers != "full" else covers, found_via, 2) for link in deeper
                )
            continue
        content_hash = "sha256:" + hashlib.sha256(joined.encode("utf-8")).hexdigest()
        if content_hash in seen_hashes:
            continue
        seen_hashes.add(content_hash)
        same = known.get(url)
        if same and same.get("content_hash") == content_hash:
            reused = [dict(i) for i in old_items if i.get("source") == same.get("index")]
            source = {**same, "fetched_at": now}
            source_items, menu_date = reused, same.get("menu_date")
        else:
            if not _spend_budget():
                return failed("budget_exhausted")
            try:
                result = await deps.extractor.extract(entity.get("name") or "", _address(entity), texts)
            except Exception as exc:  # noqa: BLE001 - one document failing does not lose the others
                logger.warning("[Menu] extraction failed for %s: %s", entity["_id"], type(exc).__name__)
                menu["rejected"].append({"url": url, "reason": "extraction_failed"})
                continue
            if not result.is_menu:
                menu["rejected"].append({"url": url, "reason": result.reason or "not_a_menu"})
                continue
            source_items, menu_date = result.items, result.menu_date
            source = {
                "url": fetched.url if url != home.url else url,
                "kind": kind,
                "covers": covers,
                "found_via": found_via,
                "fetched_at": now,
                "content_hash": content_hash,
                "menu_date": menu_date,
                "model": result.model,
            }
        source["index"] = len(sources)
        sources.append(source)
        items.extend({**item, "source": source["index"]} for item in source_items)

    if not sources:
        return failed("no_menu_found" if not menu["rejected"] else "not_a_menu")

    derived = derive(_dining_room(items, sources))
    status = "auto"
    if previous.get("status") in ("reviewed", "needs_review"):
        before, after = _per_person(previous.get("derived")), _per_person(derived)
        changed = (before is None) != (after is None) or (
            before and after and abs(after - before) / before >= REVIEW_CHANGE
        )
        new_sources = {s["url"] for s in sources} != {s.get("url") for s in previous.get("sources") or []}
        status = "needs_review" if (changed or new_sources or previous.get("status") == "needs_review") else "reviewed"
    menu.update(sources=sources, items=items, derived=derived, status=status)
    logger.info("[Menu] %s: %d sources, %d items, status=%s", entity["_id"], len(sources), len(items), status)
    return _save(db, entity, menu)


# -------------------------------------------------------------------------- read / review ----
def public_view(menu: dict, *, items: Optional[int] = None) -> dict:
    view = {k: v for k, v in menu.items() if k not in _INTERNAL and k != "_id"}
    view["entity_id"] = menu.get("entity_id") or menu.get("_id")
    view["derived"] = _apply_overrides(menu.get("derived") or {}, (menu.get("review") or {}).get("overrides") or {})
    if items is not None:
        view["items"] = (menu.get("items") or [])[: max(0, items)]
    return view


def read_menu(db, entity: dict, *, max_age_days: float = 30, items: Optional[int] = None) -> dict:
    """What is stored, at once; missing or older than max_age_days asks for a background refresh."""
    menu = db[COLLECTION].find_one({"_id": entity["_id"]})
    if not menu or not menu.get("refreshed_at"):
        return {
            "entity_id": entity.get("entity_id") or entity["_id"],
            "status": "missing",
            "fresh": False,
            "refreshing": schedule_refresh(db, entity),
        }
    refreshed = _utc(menu.get("refreshed_at"))
    fresh = bool(refreshed and _now() - refreshed <= dt.timedelta(days=max_age_days))
    refreshing = False if fresh else schedule_refresh(db, entity)
    return {**public_view(menu, items=items), "fresh": fresh, "refreshing": refreshing}


REVIEW_STATUSES = ("reviewed", "needs_review", "not_found")


def review_menu(db, entity_id: str, payload: dict, reviewer: str) -> Optional[dict]:
    """A curator confirms, corrects (overrides on derived numbers) or rejects the menu; never overwritten."""
    menu = db[COLLECTION].find_one({"_id": entity_id})
    entity = db.entities.find_one({"_id": entity_id})
    if not menu or not entity:
        return None
    review = dict(menu.get("review") or {})
    if "overrides" in payload:
        review["overrides"] = {str(k): v for k, v in (payload.get("overrides") or {}).items()}
    if "note" in payload:
        review["note"] = str(payload.get("note") or "")[:1000]
    review.update(by=reviewer, at=_now())
    menu["review"] = review
    if payload.get("status") in REVIEW_STATUSES:
        menu["status"] = payload["status"]
    manual = [str(u) for u in payload.get("add_sources") or [] if str(u).startswith(("http://", "https://"))]
    if manual:
        menu["manual_sources"] = list(dict.fromkeys([*(menu.get("manual_sources") or []), *manual]))
        menu["next_allowed_at"] = None
    menu["updatedAt"] = _now()
    return _save(db, entity, menu)


# ---------------------------------------------------------------------------- background ----
_queue: "deque[tuple]" = deque()
_queued: set = set()
_consumer: "Optional[asyncio.Task[None]]" = None
_background_deps: Optional[MenuDeps] = None
_dispatched: Dict[Any, float] = {}
COOLDOWN_SECONDS = 600.0


def set_background_deps(deps: Optional[MenuDeps]) -> None:
    global _background_deps
    _background_deps = deps


def schedule_refresh(db, entity: dict) -> bool:
    """Queue a background refresh (bounded, deduplicated); False when it was not queued."""
    global _consumer
    if not settings.menu_enrich_enabled or _background_deps is None:
        return False
    key = entity["_id"]
    now = time.monotonic()
    if key in _queued or now - _dispatched.get(key, -COOLDOWN_SECONDS) < COOLDOWN_SECONDS:
        return key in _queued
    if len(_queue) >= QUEUE_MAX:
        logger.warning("[Menu] background queue full (%d); request dropped", QUEUE_MAX)
        return False
    _queue.append((db, key))
    _queued.add(key)
    _dispatched[key] = now
    if _consumer is None or _consumer.done():
        try:
            _consumer = asyncio.get_running_loop().create_task(_consume())
        except RuntimeError:
            _queue.pop()
            _queued.discard(key)
            return False
    return True


async def _consume() -> None:
    while _queue:
        db, key = _queue.popleft()
        try:
            entity = db.entities.find_one({"_id": key})
            if entity and _background_deps is not None:
                await refresh_menu(db, entity, _background_deps)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - background never escapes as a loose exception
            logger.warning("[Menu] background refresh failed for %s: %s", key, type(exc).__name__)
        finally:
            _queued.discard(key)
