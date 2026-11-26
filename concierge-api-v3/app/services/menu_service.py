"""
File: menu_service.py
Purpose: what a restaurant's website says, in two layers — the RAW text of its useful pages (a broad
    crawl of the site, sorted by a light model: menu, booking, hours, events, the house, policies) and the
    BRIEF a strong model writes from them (menu, price per person, house facts with verbatim evidence,
    all verified by the code) — stored, reviewed by a curator, refreshed on demand or in the background,
    and searched as raw text when a conversation needs a detail the brief does not have.
Dependencies: menu_reading (links, text), menu_synthesis (the model + verification),
    openai_service._validate_image_request_hook (the SSRF guard, on every request and redirect),
    display_media_service.extract_image_sources (where an entity keeps its website/place_id), settings.
Spec: docs/superpowers/specs/2026-11-26-entity-menu-design.md.

Storage:
- `entity_menus` (one document per entity, `_id` = entity `_id`): `pages` (every collected page with the
  triage verdict, without text), `documents` (the useful pages' text and topics), `brief` (the verified
  brief), `synthesis` (model, input hash, what could not be verified), the status
  (auto | reviewed | needs_review | not_found) and the curator's review.
- `entities.menu_summary`: a compact copy for cards, search and the chat, written with a field `$set`
  (like `display_media`): the entity's `version` never moves, so the offline Collector sees no conflict.

What a refresh keeps: the triage runs only on pages whose text is new, the brief only when the useful
pages changed (or on request); a
curator's review is never overwritten — a change of 15% or more in the price per person, or different
dining-room documents, marks it `needs_review`; when the site cannot be read, what was there stays and
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
import heapq
import itertools
import json
import logging
import re
import time
import unicodedata
import urllib.robotparser
from collections import deque
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urlsplit

import httpx

from app.core.config import settings
from app.services.display_media_service import extract_image_sources
from app.services.menu_synthesis import BLOCKING, SYNTHESIS_VERSION, verify
from app.services.menu_reading import (
    classify_kind,
    discover_named_pages,
    html_to_text,
    link_priority,
    page_title,
    pdf_to_pages,
    same_site,
    site_links,
    site_root,
    sitemap_locations,
)

logger = logging.getLogger(__name__)

COLLECTION = "entity_menus"
SUMMARY_FIELD = "menu_summary"
# The crawl: the most promising pages first, within a page count and a time budget (slow sites exist; the
# nginx in front of the API gives a synchronous refresh 300 s in all).
MAX_PAGES = 40
MAX_DEPTH = 2
PARALLEL_FETCHES = 5
CRAWL_SECONDS = 90.0
SITEMAP_MAX = 400
MAX_DOCUMENT_CHARS = 80_000
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
    synthesizer: Any  # .synthesize(restaurant, address, context, documents) -> (raw brief, model)
    website_for: Callable[[str], Awaitable[Optional[str]]]
    triager: Any = None  # .triage(restaurant, address, pages) -> {index: verdict}; None keeps every page


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
                return Fetched(
                    str(response.url),
                    response.headers.get("content-type", ""),
                    b"".join(chunks),
                )
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
            logger.info(
                "[Menu] fetch failed for %s: %s",
                urlsplit(url).netloc,
                type(exc).__name__,
            )
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
    from app.services.menu_synthesis import MenuSynthesizer, SiteTriager

    return MenuDeps(
        fetch=safe_fetch,
        synthesizer=MenuSynthesizer(openai_service.client, openai_service.config_service),
        website_for=places_website,
        triager=SiteTriager(openai_service.client, openai_service.config_service),
    )


# ------------------------------------------------------------------------------- refresh ----
_running: set = set()
_budget = {"day": None, "used": 0}


def _spend_budget() -> bool:
    today = _now().date()
    if _budget["day"] != today:
        _budget.update(day=today, used=0)
    if _budget["used"] >= max(0, settings.menu_synthesis_daily_limit):
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


def _context(entity: dict) -> str:
    """What the catalog already says about the place, so the model can tell this place's menu from others."""
    data = entity.get("data") or {}
    location = data.get("location") or {}
    facts = (
        ("type", entity.get("type")),
        ("city", location.get("city") or data.get("city")),
        ("cuisine", data.get("cuisine")),
        ("curated price range", data.get("price_range")),
    )
    return "; ".join(f"{label}: {value}" for label, value in facts if value)


def _text_of(fetched: Fetched) -> tuple[str, str]:
    kind = classify_kind(fetched.url, fetched.content_type)
    if kind == "pdf":
        return kind, "\n\n".join(pdf_to_pages(fetched.body))
    if kind == "image":
        return (
            kind,
            "",
        )  # phase 3: a photo is transcribed by the vision model into a raw document
    return kind, html_to_text(fetched.body)


def _apply_overrides(brief: dict, overrides: Dict[str, Any]) -> dict:
    effective = copy.deepcopy(brief or {})
    for path, value in (overrides or {}).items():
        node = effective
        keys = str(path).split(".")
        for key in keys[:-1]:
            if not isinstance(node.get(key), dict):
                node[key] = {}
            node = node[key]
        node[keys[-1]] = value
    return effective


def _per_person(brief: Optional[dict]) -> Optional[float]:
    per_person = (brief or {}).get("per_person_brl") or {}
    value = per_person.get("dinner") or per_person.get("lunch")
    return float(value) if isinstance(value, (int, float)) else None


def _dining_urls(menu: dict) -> set:
    roles = {d.get("index"): d.get("role") for d in (menu.get("brief") or {}).get("documents") or []}
    return {d.get("url") for d in menu.get("documents") or [] if roles.get(d.get("index")) == "dining_room"}


def _summary(menu: dict) -> dict:
    brief = _apply_overrides(menu.get("brief") or {}, (menu.get("review") or {}).get("overrides") or {})
    tasting = [t.get("price_brl") for t in brief.get("tasting_menus") or [] if t.get("price_brl")]
    return {
        "status": menu.get("status"),
        "as_of": menu.get("refreshed_at"),
        "per_person_brl": brief.get("per_person_brl"),
        "per_person_fixed": brief.get("per_person_fixed") or {},
        "formats": brief.get("formats") or [],
        "confidence": brief.get("confidence"),
        "executive_lunch_brl": brief.get("executive_lunch_brl"),
        "tasting_min_brl": min(tasting) if tasting else None,
        "couvert_brl": brief.get("couvert_brl"),
        "corkage_brl": brief.get("corkage_brl"),
        "dietary": brief.get("dietary") or [],
        "summary": brief.get("summary"),
        "menu_date": brief.get("menu_date"),
        "house_summary": brief.get("house_summary"),
        "fact_topics": sorted({f.get("topic") for f in brief.get("facts") or [] if f.get("topic")}),
    }


# Fields of the v1 document (items extracted one by one, numbers derived by heuristics): removed on save.
_V1_FIELDS = ("sources", "items", "derived")


def _save(db, entity: dict, menu: dict) -> dict:
    for field in _V1_FIELDS:
        menu.pop(field, None)
    db[COLLECTION].update_one(
        {"_id": menu["_id"]}, {"$set": menu, "$unset": {field: "" for field in _V1_FIELDS}}, upsert=True
    )
    try:
        # Field $set only: the entity's version and updatedAt stay as they are (see module docstring).
        db.entities.update_one({"_id": entity["_id"]}, {"$set": {SUMMARY_FIELD: _summary(menu)}})
    except Exception as exc:  # noqa: BLE001 - a derived copy never fails the menu write
        logger.warning(
            "[Menu] summary not written for %s: %s",
            entity.get("_id"),
            type(exc).__name__,
        )
    return menu


def _input_hash(documents: List[dict]) -> str:
    """What the brief was made from: the documents (by url and text hash) and the synthesis version."""
    key = json.dumps(
        [
            SYNTHESIS_VERSION,
            sorted((d.get("url") or "", d.get("content_hash") or "") for d in documents),
        ]
    )
    return "sha256:" + hashlib.sha256(key.encode("utf-8")).hexdigest()


async def refresh_menu(db, entity: dict, deps: MenuDeps, *, force: bool = False, resynthesize: bool = False) -> dict:
    """Collect the raw menu documents and (when they changed) write the brief; returns the stored document.

    force: collect again inside the minimum interval. resynthesize: write the brief again from the stored
    documents, without the network (to fix a brief or try a new prompt).
    """
    key = entity["_id"]
    previous = db[COLLECTION].find_one({"_id": key}) or {}
    now = _now()
    allowed = _utc(previous.get("next_allowed_at"))
    lease = _utc(previous.get("lease_until"))
    if previous and not (force or resynthesize) and allowed and allowed > now:
        return previous
    if key in _running or (lease and lease > now):
        return previous or {"_id": key, "status": "refreshing"}
    _running.add(key)
    try:
        db[COLLECTION].update_one(
            {"_id": key},
            {"$set": {"lease_until": now + dt.timedelta(seconds=LEASE_SECONDS)}},
            upsert=True,
        )
        return await _refresh(db, entity, deps, previous, now, resynthesize)
    finally:
        _running.discard(key)


async def _refresh(
    db,
    entity: dict,
    deps: MenuDeps,
    previous: dict,
    now: dt.datetime,
    resynthesize: bool,
) -> dict:
    menu: dict = {
        "_id": entity["_id"],
        "entity_id": entity.get("entity_id") or entity["_id"],
        "website": previous.get("website"),
        "pages": previous.get("pages") or [],
        "documents": previous.get("documents") or [],
        "brief": previous.get("brief"),
        "synthesis": previous.get("synthesis"),
        "status": previous.get("status") or "not_found",
        "review": previous.get("review"),
        "rejected": [] if not resynthesize else previous.get("rejected") or [],
        "manual_sources": previous.get("manual_sources") or [],
        "last_error": None,
        "attempts": int(previous.get("attempts") or 0) + 1,
        "refreshed_at": (now if not resynthesize else previous.get("refreshed_at") or now),
        "next_allowed_at": now + dt.timedelta(hours=settings.menu_refresh_min_hours),
        "lease_until": None,
        "updatedAt": now,
    }
    if not resynthesize:
        collected = await _collect(entity, deps, previous, now, menu)
        if isinstance(collected, str):
            return _failed(db, entity, menu, collected)
        kept = await _triage(entity, deps, previous, collected, menu)
        if isinstance(kept, str):
            return _failed(db, entity, menu, kept)
        menu["documents"] = kept
    if not menu["documents"]:
        return _failed(db, entity, menu, "nothing_useful")
    return await _synthesize(db, entity, deps, previous, menu, now, again=resynthesize)


def _failed(db, entity: dict, menu: dict, code: str) -> dict:
    """What was there stays (documents and brief); the status says not_found only when there never was one."""
    menu["last_error"] = code
    if not menu.get("brief"):
        menu["status"] = "not_found"
    logger.info("[Menu] %s: %s", entity["_id"], code)
    return _save(db, entity, menu)


_NAME_STOP = {"restaurante", "restaurant", "ristorante", "bar", "the", "de", "da", "do", "e"}


async def _collect(entity: dict, deps: MenuDeps, previous: dict, now: dt.datetime, menu: dict):
    """The raw layer: the site's pages as text, most promising first (its own section and name, menus,
    booking and house pages), up to MAX_PAGES / CRAWL_SECONDS. A list of pages, or an error code."""
    website, _ = extract_image_sources(entity)
    if not website and (place_id := _place_id(entity)):
        website = await deps.website_for(place_id)
    if not website:
        return "no_website"
    menu["website"] = website
    try:
        home = await deps.fetch(website)
    except ValueError:
        return "blocked"
    except FetchFailed as error:
        return error.code
    if home is None:
        return "site_unreachable"

    root = site_root(home.url)
    start_path = urlsplit(website).path.rstrip("/")
    name_words = [w for w in re.findall(r"[a-z0-9]+", _plain(entity.get("name") or "")) if w not in _NAME_STOP]
    pages: List[dict] = []
    hashes: set = set()
    done = {website, home.url}
    best: Dict[str, int] = {}  # a link seen again with a better reason (this unit's page) moves up the queue
    heap: list = []
    order = itertools.count()

    def push(url: str, label: str, depth: int, found_via: str, bonus: int = 0) -> None:
        url = url.split("#")[0]
        score = bonus + link_priority(url, label, start_path=start_path, name_words=name_words)
        if url in done or best.get(url, -(10**6)) >= score:
            return
        best[url] = score
        heapq.heappush(heap, (-score, depth, next(order), url, found_via))

    def pop_batch() -> list:
        batch = []
        while heap and len(batch) < PARALLEL_FETCHES:
            item = heapq.heappop(heap)
            if item[3] not in done:
                done.add(item[3])
                batch.append(item)
        return batch

    def add(fetched: Fetched, depth: int, found_via: str) -> None:
        kind, text = _text_of(fetched)
        if kind in ("html", "platform") and depth < MAX_DEPTH:  # a page of links only is still followed
            for url, label in site_links(fetched.body, fetched.url):
                push(url, label, depth + 1, "website_link")
        if len(text.strip()) < 40:
            return
        content_hash = "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()
        if content_hash in hashes:
            return
        hashes.add(content_hash)
        pages.append(
            {
                "index": len(pages),
                "url": fetched.url,
                "kind": kind,
                "title": page_title(fetched.body) if kind != "pdf" else urlsplit(fetched.url).path.rsplit("/", 1)[-1],
                "found_via": found_via,
                "fetched_at": now,
                "content_hash": content_hash,
                "chars": len(text),
                "truncated": len(text) > MAX_DOCUMENT_CHARS,
                "text": text[:MAX_DOCUMENT_CHARS],
            }
        )

    add(home, 0, "website_home")
    for url in previous.get("manual_sources") or []:
        push(url, "", 1, "manual", bonus=20)
    # A group's site (one site for many restaurants and units): the page of this unit first.
    for url in discover_named_pages(home.body, home.url, entity.get("name") or "", _address(entity))[:2]:
        push(url, "", 1, "website_link", bonus=4)
    for url in await _sitemap(deps, home.url):
        if same_site(url, root):
            push(url, "", 1, "sitemap", bonus=-1)

    deadline = time.monotonic() + CRAWL_SECONDS
    fetches = 0
    while heap and len(pages) < MAX_PAGES and fetches < MAX_PAGES * 2 and time.monotonic() < deadline:
        batch = pop_batch()
        if not batch:
            break
        fetches += len(batch)
        results = await asyncio.gather(*(deps.fetch(item[3]) for item in batch), return_exceptions=True)
        for (_, depth, _, url, found_via), result in zip(batch, results):
            if isinstance(result, FetchFailed):
                menu["rejected"].append({"url": url, "reason": result.code})
            elif isinstance(result, ValueError):
                menu["rejected"].append({"url": url, "reason": "blocked"})
            elif isinstance(result, Fetched) and len(pages) < MAX_PAGES:
                add(result, depth, found_via)
    return pages


async def _sitemap(deps: MenuDeps, home_url: str) -> List[str]:
    """The sitemap's pages (what the navigation hides), following up to 4 child sitemaps."""
    parts = urlsplit(home_url)
    origin = f"{parts.scheme}://{parts.netloc}"
    for path in ("/sitemap.xml", "/sitemap_index.xml"):
        try:
            got = await deps.fetch(origin + path)
        except Exception:  # noqa: BLE001 - no sitemap is normal
            got = None
        if not got:
            continue
        locations = sitemap_locations(got.body)
        found = [u for u in locations if not u.endswith(".xml")]
        for child in [u for u in locations if u.endswith(".xml")][:4]:
            try:
                sub = await deps.fetch(child)
            except Exception:  # noqa: BLE001
                sub = None
            if sub:
                found += [u for u in sitemap_locations(sub.body) if not u.endswith(".xml")]
        return found[:SITEMAP_MAX]
    return []


async def _triage(entity: dict, deps: MenuDeps, previous: dict, pages: List[dict], menu: dict):
    """Which pages are useful for THIS unit (light model); only those keep their text. A page whose text did
    not change keeps its previous verdict (no model call). Without a triage model every page is kept."""
    cached = {p.get("content_hash"): p for p in previous.get("pages") or [] if "useful" in p}
    unknown = [p for p in pages if p["content_hash"] not in cached]
    verdicts: Dict[int, dict] = {}
    if unknown and deps.triager is not None:
        if not _spend_budget():
            return "budget_exhausted"
        try:
            verdicts = await deps.triager.triage(entity.get("name") or "", _address(entity), unknown)
        except Exception as exc:  # noqa: BLE001 - nothing kept without a verdict; the next refresh retries
            logger.warning("[Menu] triage failed for %s: %s", entity["_id"], type(exc).__name__)
            return "triage_failed"
    index: List[dict] = []
    useful: List[dict] = []
    for page in pages:
        known = cached.get(page["content_hash"])
        if deps.triager is None:
            verdict = {"useful": True, "topics": [], "reason": "no triage model"}
        elif known is not None:
            verdict = {k: known.get(k) for k in ("useful", "topics", "reason")}
        else:
            verdict = verdicts.get(page["index"]) or {"useful": False, "topics": [], "reason": "no verdict"}
        if page.get("found_via") == "manual":  # a curator added it: kept whatever the triage says
            verdict = {**verdict, "useful": True}
        index.append({**{k: v for k, v in page.items() if k != "text"}, **verdict})
        if verdict["useful"]:
            useful.append({**page, "topics": verdict["topics"]})
    for n, page in enumerate(useful):
        page["index"] = n
    menu["pages"] = index
    return useful


async def _synthesize(
    db,
    entity: dict,
    deps: MenuDeps,
    previous: dict,
    menu: dict,
    now: dt.datetime,
    *,
    again: bool,
):
    """The brief: written by the model from the useful pages, verified here. Unchanged pages: no model call."""
    documents = menu["documents"]
    input_hash = _input_hash(documents)
    old = previous.get("synthesis") or {}
    if not again and previous.get("brief") is not None and old.get("input_hash") == input_hash:
        return _save(db, entity, menu)
    if not _spend_budget():
        return _failed(db, entity, menu, "budget_exhausted")
    try:
        raw, model = await deps.synthesizer.synthesize(
            entity.get("name") or "", _address(entity), _context(entity), documents
        )
    except Exception as exc:  # noqa: BLE001 - the previous brief stays; the next refresh tries again
        logger.warning("[Menu] synthesis failed for %s: %s", entity["_id"], type(exc).__name__)
        menu["synthesis"] = {**old, "error": "synthesis_failed"}
        return _failed(db, entity, menu, "synthesis_failed")

    brief, issues = verify(raw, documents)
    blocking = [i for i in issues if i["problem"] in BLOCKING]
    menu["brief"] = brief
    menu["synthesis"] = {
        "model": model,
        "at": now,
        "version": SYNTHESIS_VERSION,
        "input_hash": input_hash,
        "issues": issues,
        "error": None,
    }
    roles = {d["role"] for d in brief["documents"]}
    has_menu = "dining_room" in roles or brief["per_person_brl"] or brief["tasting_menus"]
    if not has_menu and not brief["facts"]:
        menu["status"] = "not_found"
        menu["last_error"] = "nothing_useful"
    else:
        status = "needs_review" if blocking else "auto"
        if previous.get("status") in ("reviewed", "needs_review"):
            before, after = _per_person(previous.get("brief")), _per_person(brief)
            changed = (before is None) != (after is None) or bool(
                before and after and abs(after - before) / before >= REVIEW_CHANGE
            )
            moved = _dining_urls(menu) != _dining_urls(previous)
            keep = previous.get("status") == "reviewed" and not (changed or moved or blocking)
            status = "reviewed" if keep else "needs_review"
        menu["status"] = status
    logger.info(
        "[Menu] %s: %d pages, %d useful, %d facts, status=%s, issues=%d",
        entity["_id"],
        len(menu.get("pages") or []),
        len(documents),
        len(brief["facts"]),
        menu["status"],
        len(issues),
    )
    return _save(db, entity, menu)


# -------------------------------------------------------------------------- read / review ----
def public_view(menu: dict) -> dict:
    """The stored menu without its raw text (that is GET .../menu/text) and with the review applied."""
    view = {k: v for k, v in menu.items() if k not in _INTERNAL and k != "_id"}
    view["entity_id"] = menu.get("entity_id") or menu.get("_id")
    view["documents"] = [{k: v for k, v in d.items() if k != "text"} for d in menu.get("documents") or []]
    view["brief"] = _apply_overrides(menu.get("brief") or {}, (menu.get("review") or {}).get("overrides") or {})
    return view


def read_menu(db, entity: dict, *, max_age_days: float = 30) -> dict:
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
    return {**public_view(menu), "fresh": fresh, "refreshing": refreshing}


# Raw text for the chat: the dining-room menu first; a shop or another unit last.
_ROLE_ORDER = {
    "dining_room": 0,
    "drinks": 1,
    "delivery": 2,
    "event": 3,
    "other": 4,
    "orders_or_shop": 5,
}
_STOPWORDS = {
    "que", "tem", "com", "sem", "para", "por", "uma", "uns", "das", "dos", "nas", "nos", "qual", "quais",
    "quanto", "custa", "como", "eles", "ela", "ele", "the", "and", "menu", "cardapio", "preco", "valor",
}  # fmt: skip
CHUNK_CHARS = 700


def _plain(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()


def _terms(query: str) -> List[str]:
    words = re.findall(r"[a-z0-9]+", _plain(query))
    terms = [w[:-1] if len(w) > 4 and w.endswith("s") else w for w in words if len(w) >= 3 and w not in _STOPWORDS]
    return list(dict.fromkeys(terms))


def _chunks(text: str) -> List[str]:
    chunks, current, size = [], [], 0
    for line in (text or "").splitlines():
        if current and size + len(line) > CHUNK_CHARS:
            chunks.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        chunks.append("\n".join(current))
    return [c for c in chunks if c.strip()]


def menu_text(db, entity: dict, *, q: Optional[str] = None, topic: Optional[str] = None, max_chars: int = 6000) -> dict:
    """Excerpts of the site's useful pages for a question the brief does not answer (no model, no network).

    With q: the passages that contain its words (accents and case ignored), most words first; without q:
    the start of the pages. topic: only pages the triage tagged with it (menu, reservations, …). The
    dining-room menu comes first; pages the brief says are another unit's or not a menu are left out.
    """
    menu = db[COLLECTION].find_one({"_id": entity["_id"]}) or {}
    documents = menu.get("documents") or []
    answer = {
        "entity_id": entity.get("entity_id") or entity["_id"],
        "status": menu.get("status") or "missing",
        "as_of": menu.get("refreshed_at"),
        "documents": [],
        "excerpts": [],
        "matched": None,
        "truncated": False,
    }
    if not documents:
        answer["refreshing"] = schedule_refresh(db, entity)
        return answer
    roles = {d.get("index"): d.get("role") for d in (menu.get("brief") or {}).get("documents") or []}
    usable = sorted(
        (
            d
            for d in documents
            if roles.get(d["index"], "other") in _ROLE_ORDER and (not topic or topic in (d.get("topics") or []))
        ),
        key=lambda d: (_ROLE_ORDER[roles.get(d["index"], "other")], d["index"]),
    )
    answer["documents"] = [
        {
            "index": d["index"],
            "url": d.get("url"),
            "kind": d.get("kind"),
            "role": roles.get(d["index"], "other"),
            "topics": d.get("topics") or [],
        }
        for d in usable
    ]
    passages = [
        (rank, n, d["index"], chunk) for rank, d in enumerate(usable) for n, chunk in enumerate(_chunks(d["text"]))
    ]
    terms = _terms(q or "")
    if terms:
        scored = [(sum(t in _plain(p[3]) for t in terms), p) for p in passages]
        passages = [p for score, p in sorted(scored, key=lambda s: (-s[0], s[1][0], s[1][1])) if score > 0]
        answer["matched"] = bool(passages)
    chosen, used = [], 0
    for passage in passages:
        if used + len(passage[3]) > max_chars:
            answer["truncated"] = True
            continue
        chosen.append(passage)
        used += len(passage[3])
    answer["excerpts"] = [{"document": index, "text": text} for _, _, index, text in sorted(chosen)]
    return answer


REVIEW_STATUSES = ("reviewed", "needs_review", "not_found")


def review_menu(db, entity_id: str, payload: dict, reviewer: str) -> Optional[dict]:
    """A curator confirms, corrects (overrides on the brief by path) or rejects the menu; never overwritten."""
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
