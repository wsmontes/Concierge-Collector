"""Bounded selection resolution and high-water scans for CMS Explorer."""

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import re

from fastapi import HTTPException, status
from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.database import Database

from app.models.catalog import (
    DEFAULT_CURATION_SORT,
    FILTER_OPERATORS,
    RejectedCuration,
    ResolveCurationsResponse,
    resolve_filter_field,
)

SELECTABLE_STATUSES = frozenset({"active", "draft", "linked"})
# Tombstoned Curations stay readable by id but never count as catalog rows.
DELETED_STATUS = "deleted"
CATALOG_SEQUENCE_COUNTER_ID = "curations_catalog_sequence"

# Ordered Mongo sort specs for the published allowlist. ``sequence_asc`` is the
# server default: it reproduces the ordering every existing consumer already
# gets (the Admin asks for ``updated_at_desc`` explicitly).
CURATION_SORT_SPECS: dict[str, tuple[str, int]] = {
    "sequence_asc": ("catalog_sequence", 1),
    "sequence_desc": ("catalog_sequence", -1),
    "updated_at_desc": ("updatedAt", -1),
    "updated_at_asc": ("updatedAt", 1),
    "created_at_desc": ("createdAt", -1),
    "created_at_asc": ("createdAt", 1),
    "name_asc": ("restaurant_name", 1),
    "name_desc": ("restaurant_name", -1),
}

# Sort fields stored as BSON dates: the signed cursor carries them as ISO-8601
# because the token body is JSON, and compares them as datetimes again.
_DATE_SORT_FIELDS = frozenset({"updatedAt", "createdAt"})

# The Admin list row is derived from ONE projection per document — the same
# stored Curation the search already reads. No per-row query, no invented value.
_ADMIN_ROW_PROJECTION = {
    "_id": 0,
    "curation_id": 1,
    "catalog_sequence": 1,
    "status": 1,
    "restaurant_name": 1,
    "city": 1,
    "type": 1,
    "curator_id": 1,
    "updatedAt": 1,
    "createdAt": 1,
    "curator": 1,
    "categories": 1,
    "sources": 1,
    "transcript": 1,
    "version": 1,
}

_ROW_CONCEPT_LIMIT = 12
_SOURCE_LIST_KEYS = ("image", "audio")


def _curator_name(curator: object) -> str | None:
    if not isinstance(curator, dict):
        return None
    name = curator.get("name")
    return name if isinstance(name, str) and name else None


def _row_concepts(categories: object) -> list[str] | None:
    """Every concept stored under ``categories`` — flattened, de-duplicated,
    stable order, capped. ``None`` means the document stores no mapping."""
    if not isinstance(categories, dict):
        return None
    concepts: list[str] = []
    for values in categories.values():
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str) and value not in concepts:
                concepts.append(value)
                if len(concepts) >= _ROW_CONCEPT_LIMIT:
                    return concepts
    return concepts


def _source_length(source_map: dict | None, key: str) -> int | None:
    if source_map is None:
        return None
    value = source_map.get(key)
    return len(value) if isinstance(value, list) else None


def utc_iso(value: datetime) -> str:
    """ISO-8601 for a stored BSON datetime, always carrying its offset.

    BSON datetimes are UTC by definition, but the driver hands them back naive.
    Serializing a naive datetime drops the offset, so every client parses it as
    local time and every rendered date shifts by the viewer's UTC offset (a
    Curation updated seconds ago displayed as "in 7 hours" on a UTC-7 machine).
    Absent tzinfo therefore means UTC here, and the emitted string says so.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def admin_curation_row(row: dict) -> dict:
    """Derive one Admin list row from the stored Curation document."""
    sources = row.get("sources")
    source_map = sources if isinstance(sources, dict) else None
    transcript = row.get("transcript")
    updated_at = row.get("updatedAt")
    created_at = row.get("createdAt")
    return {
        "curation_id": str(row["curation_id"]),
        "catalog_sequence": int(row["catalog_sequence"]),
        "status": str(row.get("status") or "draft"),
        "restaurant_name": row.get("restaurant_name"),
        "city": row.get("city"),
        "entity_type": row.get("type"),
        "curator_id": row.get("curator_id"),
        # Real documents carry BSON datetimes; a value that is already a string
        # is left for the response model to validate rather than dropped.
        "updated_at": utc_iso(updated_at) if isinstance(updated_at, datetime) else updated_at,
        "created_at": utc_iso(created_at) if isinstance(created_at, datetime) else created_at,
        "curator_name": _curator_name(row.get("curator")),
        "concepts": _row_concepts(row.get("categories")),
        "source_count": len(source_map) if source_map is not None else None,
        "image_count": _source_length(source_map, "image"),
        "audio_count": _source_length(source_map, "audio"),
        "has_transcript": isinstance(transcript, str) and bool(transcript),
        "version": row.get("version"),
    }


def admin_curation_rows(rows: list[dict]) -> list[dict]:
    """Rows exposed by both the list and the scan; documents without a usable
    identity are skipped exactly as before."""
    return [
        admin_curation_row(row)
        for row in rows
        if isinstance(row.get("curation_id"), str) and isinstance(row.get("catalog_sequence"), int)
    ]


def _is_empty_clause(path: str) -> dict:
    """Missing, null, empty string or empty array."""
    return {"$or": [{path: None}, {path: ""}, {path: []}]}


def unlinked_entity_clause(unlinked: bool) -> dict:
    """The ONE "no Entity attached" predicate of the CMS boundary.

    ``True`` selects Curations whose ``entity_id`` is absent, null, an empty
    string or whitespace-only; ``False`` selects only the ones that do carry a
    usable reference. The ``content-health`` counter and the ``unlinked`` list
    filter both call this, so the card and the list it links to can never
    disagree about what "unlinked" means.
    """
    if unlinked:
        return {"$or": [{"entity_id": {"$in": [None, ""]}}, {"entity_id": {"$regex": r"^\s*$"}}]}
    return {"$and": [{"entity_id": {"$nin": [None, ""]}}, {"entity_id": {"$not": {"$regex": r"^\s*$"}}}]}


def _invalid_condition(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def _condition_text(value: object, operator: str) -> str:
    if not isinstance(value, str):
        raise _invalid_condition(f"Operator '{operator}' requires a string value")
    return value


def _condition_list(value: object, operator: str) -> list:
    if not isinstance(value, list) or not value or not all(isinstance(item, (str, int, float, bool)) for item in value):
        raise _invalid_condition(f"Operator '{operator}' requires a non-empty list of scalars")
    return value


def _condition_order(value: object, operator: str) -> object:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise _invalid_condition(f"Operator '{operator}' requires a number or a string value")
    return value


def _condition_boundary(value: object, operator: str) -> datetime:
    """An ISO-8601 boundary as the naive UTC datetime the cursor compares with.

    BSON datetimes are UTC but the driver hands them back naive, and PyMongo
    reads a naive value as UTC, so a naive boundary compares correctly against
    both the stored documents and the signed cursor's restored position.
    """
    if not isinstance(value, str):
        raise _invalid_condition(f"Operator '{operator}' requires an ISO 8601 string value")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise _invalid_condition(f"Operator '{operator}' requires an ISO 8601 string value") from None
    return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo is not None else parsed


def _ci_regex(pattern: str) -> dict:
    return {"$regex": pattern, "$options": "i"}


def filter_condition_clause(condition: dict) -> dict:
    """The Mongo predicate of one field condition (``where``).

    List search, scan/start and scan/page all reach Mongo through this helper
    — the ``concept.<Category>`` facets are built as conditions too — so a bulk
    selection can never diverge from what the list showed. The field is
    interpolated into the path, so an unaddressable one is refused here as well
    as at every model boundary.
    """
    field = condition.get("field")
    operator = condition.get("op")
    if not isinstance(field, str) or not isinstance(operator, str):
        raise _invalid_condition("Invalid filter condition")
    try:
        path = resolve_filter_field(field)
    except ValueError as exc:
        raise _invalid_condition(str(exc)) from None
    if operator not in FILTER_OPERATORS:
        raise _invalid_condition(f"Unknown filter operator {operator!r}")

    value = condition.get("value")
    if operator == "exists":
        return {path: {"$exists": True}}
    if operator == "not_exists":
        return {path: {"$exists": False}}
    if operator == "is_empty":
        return _is_empty_clause(path)
    if operator == "is_not_empty":
        return {
            "$and": [
                {path: {"$exists": True}},
                {path: {"$ne": None}},
                {path: {"$ne": ""}},
                {path: {"$ne": []}},
            ]
        }
    if operator == "equals":
        return {path: value}
    if operator == "not_equals":
        return {path: {"$ne": value}}
    if operator == "contains":
        return {path: _ci_regex(re.escape(_condition_text(value, operator)))}
    if operator == "not_contains":
        return {path: {"$not": _ci_regex(re.escape(_condition_text(value, operator)))}}
    if operator == "starts_with":
        return {path: _ci_regex("^" + re.escape(_condition_text(value, operator)))}
    if operator == "greater_than":
        return {path: {"$gt": _condition_order(value, operator)}}
    if operator == "less_than":
        return {path: {"$lt": _condition_order(value, operator)}}
    if operator == "before":
        return {path: {"$lt": _condition_boundary(value, operator)}}
    if operator == "after":
        return {path: {"$gt": _condition_boundary(value, operator)}}
    if operator == "contains_any":
        return {path: {"$in": _condition_list(value, operator)}}
    # ``contains_all``: one array-contains clause per value, ANDed — never a
    # single merged dict key.
    return {"$and": [{path: item} for item in _condition_list(value, operator)]}


def concept_query_clauses(concepts: list[dict]) -> list[dict]:
    """Every ``concept.<Category>=<value>`` array-contains condition.

    A concept facet is the ``categories.<Category>`` form of a field condition,
    so it is built by the SAME clause builder as every ``where`` condition
    instead of living beside it.
    """
    clauses: list[dict] = []
    for concept in concepts:
        category = concept.get("category")
        value = concept.get("value")
        if not isinstance(category, str) or not isinstance(value, str) or not value:
            raise _invalid_condition("Invalid concept filter")
        clauses.append(filter_condition_clause({"field": f"categories.{category}", "op": "equals", "value": value}))
    return clauses


def field_condition_clauses(conditions: list[dict]) -> list[dict]:
    """Every ``where`` predicate, in the order the caller sent it."""
    return [filter_condition_clause(condition) for condition in conditions]


def catalog_filter_clauses(filters: dict) -> list[dict]:
    """Every predicate of one filter set, as a flat list of ANDed clauses.

    The live list and the frozen scan both build their Mongo query from this
    ONE list, so a materialized all-matching selection applies exactly the
    predicate of the list it came from. Conditions are never merged into a
    single dict key: the same field may legitimately carry several of them.
    """
    clauses: list[dict] = []
    if filters.get("status"):
        clauses.append({"status": {"$in": filters["status"]}})
    if filters.get("city"):
        clauses.append({"city": filters["city"]})
    if filters.get("entity_type"):
        clauses.append({"type": filters["entity_type"]})
    if filters.get("curator_id"):
        clauses.append({"curator_id": filters["curator_id"]})
    if filters.get("q"):
        clauses.append({"restaurant_name": {"$regex": filters["q"], "$options": "i"}})
    if filters.get("updated_from") or filters.get("updated_to"):
        updated: dict = {}
        if filters.get("updated_from"):
            updated["$gte"] = filters["updated_from"]
        if filters.get("updated_to"):
            updated["$lte"] = filters["updated_to"]
        clauses.append({"updatedAt": updated})
    if filters.get("unlinked") is not None:
        clauses.append(unlinked_entity_clause(bool(filters["unlinked"])))
    if filters.get("exclude_curation_ids"):
        # The set is already de-duplicated and sorted by ``_normalized_filters``,
        # so an equivalent exclusion always serializes — and signs — identically.
        clauses.append({"curation_id": {"$nin": filters["exclude_curation_ids"]}})
    clauses.extend(concept_query_clauses(filters.get("concepts") or []))
    clauses.extend(field_condition_clauses(filters.get("where") or []))
    return clauses


def catalog_query(filters: dict) -> dict:
    """The filter clause of the list/scan query (``{}`` when nothing filters)."""
    clauses = catalog_filter_clauses(filters)
    return {"$and": clauses} if clauses else {}


def _sort_spec(sort: str) -> tuple[str, int]:
    spec = CURATION_SORT_SPECS.get(sort)
    if spec is None:
        raise CatalogCursorError("invalid sort")
    return spec


def sort_order(sort: str) -> list[tuple[str, int]]:
    """Mongo sort for one allowlisted value, tie-broken by the string
    ``curation_id`` (a total order — never by ``_id``, which is ObjectId in
    bulk-imported documents and a string in API-created ones)."""
    field, direction = _sort_spec(sort)
    return [(field, direction), ("curation_id", direction)]


def _position_key_name(field: str) -> str:
    # ``sequence`` keeps the pre-sort cursor payload byte-identical for the
    # sequence orderings, including cursors already in flight.
    return "sequence" if field == "catalog_sequence" else "sort_value"


def _position_item_key(field: str) -> str:
    return {
        "catalog_sequence": "catalog_sequence",
        "updatedAt": "updated_at",
        "createdAt": "created_at",
        "restaurant_name": "restaurant_name",
    }[field]


def _position_payload(sort: str, item: dict) -> dict:
    """Cursor fragment locating the last returned row inside the sort."""
    field, _ = _sort_spec(sort)
    value = item.get(_position_item_key(field))
    if isinstance(value, datetime):
        value = value.isoformat()
    return {_position_key_name(field): value, "curation_id": item["curation_id"]}


def _position_value(field: str, raw: object) -> object:
    if field == "catalog_sequence":
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise CatalogCursorError("invalid cursor")
        return raw
    if not isinstance(raw, str):
        raise CatalogCursorError("invalid cursor")
    if field not in _DATE_SORT_FIELDS:
        return raw
    try:
        return datetime.fromisoformat(raw)
    except ValueError as exc:
        raise CatalogCursorError("invalid cursor") from exc


def _position_clause(sort: str, payload: dict) -> dict:
    """Keyset clause for the requested sort, read back from a signed cursor."""
    field, direction = _sort_spec(sort)
    last_id = payload.get("curation_id")
    if not isinstance(last_id, str):
        raise CatalogCursorError("invalid cursor")
    value = _position_value(field, payload.get(_position_key_name(field)))
    if direction > 0:
        bounded: dict = {"$gt": value}
        tie: dict = {"$gt": last_id}
    else:
        bounded = {"$lt": value}
        tie = {"$lt": last_id}
    if field != "catalog_sequence":
        # Mongo sorts missing/null keys first ascending and last descending:
        # without this a descending keyset re-admits them on every page.
        bounded["$ne"] = None
    return {"$or": [{field: bounded}, {field: value, "curation_id": tie}]}


def _canonical_concepts(concepts: list[dict]) -> list[dict]:
    """De-duplicated, canonical order: the cursor compares the whole filter
    payload, so equivalent condition sets must serialize identically."""
    pairs = {(concept["category"], concept["value"]) for concept in concepts}
    return [{"category": category, "value": value} for category, value in sorted(pairs)]


def _position_cursor(payload: dict, sort: str, item: dict, secret: str) -> str | None:
    """Signed cursor continuing after ``item``, or ``None`` when the row's sort
    key is null (it sits at the tail of the ordering, where a keyset cannot
    address past it)."""
    position = _position_payload(sort, item)
    if any(value is None for value in position.values()):
        return None
    return _encode_token({**payload, **position}, secret)


def _admin_rows(db: Database, clauses: list[dict], sort: str, limit: int) -> list[dict]:
    """The single row query shared by the live list and the frozen scan."""
    return list(db.curations.find({"$and": clauses}, _ADMIN_ROW_PROJECTION).sort(sort_order(sort)).limit(limit + 1))


def reserve_catalog_sequences(db: Database, count: int) -> range:
    """Reserve a disjoint, monotonically increasing server-owned range."""

    if not isinstance(count, int) or count < 1:
        raise ValueError("count must be a positive integer")
    highest = db.curations.find_one(
        {"catalog_sequence": {"$type": "number"}},
        projection={"catalog_sequence": 1},
        sort=[("catalog_sequence", -1)],
    )
    current_max = int((highest or {}).get("catalog_sequence", 0))
    db.counters.update_one(
        {"_id": CATALOG_SEQUENCE_COUNTER_ID},
        {"$max": {"value": current_max}, "$set": {"initialized": True}},
        upsert=True,
    )
    counter = db.counters.find_one_and_update(
        {"_id": CATALOG_SEQUENCE_COUNTER_ID},
        {"$inc": {"value": count}},
        return_document=ReturnDocument.AFTER,
    )
    end = int(counter["value"])
    return range(end - count + 1, end + 1)


def ensure_catalog_sequence(db: Database, document: dict) -> int:
    """Assign a fresh sequence immediately before a Curation write."""

    sequence = next(iter(reserve_catalog_sequences(db, 1)))
    document["catalog_sequence"] = sequence
    return sequence


class CatalogCursorError(ValueError):
    """A scan or page cursor is malformed, expired or bound to another actor."""


class CatalogScanUnavailable(RuntimeError):
    """The scan window cannot be described, so it must fail loudly.

    The window is frozen from the highest ``catalog_sequence``; a collection with
    rows and no sequenced document yields ``max = 0``, and every page would come
    back empty. That is a data-invariant violation — every Curation is written
    through :func:`ensure_catalog_sequence` — not an empty catalog. Returning the
    empty list is what hid it: the Admin rendered "no Curations" over 1057 stored
    rows (production, 2026-09-15).
    """


def _encode_token(value: dict, secret: str) -> str:
    body = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    body_b64 = base64.urlsafe_b64encode(body).decode().rstrip("=")
    signature_b64 = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{body_b64}.{signature_b64}"


def _decode_token(token: str, secret: str) -> dict:
    try:
        body_part, signature_part = token.split(".")
        body = base64.urlsafe_b64decode(body_part + "=" * (-len(body_part) % 4))
        signature = base64.urlsafe_b64decode(signature_part + "=" * (-len(signature_part) % 4))
        expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
        value = json.loads(body)
    except (TypeError, ValueError, UnicodeDecodeError) as exc:
        raise CatalogCursorError("invalid cursor") from exc
    if not hmac.compare_digest(signature, expected) or not isinstance(value, dict):
        raise CatalogCursorError("invalid cursor")
    if not isinstance(value.get("exp"), int) or value["exp"] < int(datetime.now(timezone.utc).timestamp()):
        raise CatalogCursorError("invalid cursor")
    return value


def _canonical_conditions(conditions: list[dict]) -> list[dict]:
    """De-duplicated, canonical order for one condition list.

    The signed cursor compares the whole filter payload, so equivalent
    condition sets must serialize identically; every condition is ANDed, so the
    order they arrived in carries no meaning.
    """
    canonical: dict[tuple, dict] = {}
    for condition in conditions:
        field = condition.get("field")
        operator = condition.get("op")
        value = condition.get("value")
        key = (str(field), str(operator), json.dumps(value, sort_keys=True, default=str))
        canonical[key] = {"field": field, "op": operator, "value": value}
    return [canonical[key] for key in sorted(canonical)]


def _normalized_filters(filters: dict) -> dict:
    value = dict(filters)
    if isinstance(value.get("q"), str):
        value["q"] = value["q"].strip().lower() or None
    if isinstance(value.get("status"), list):
        value["status"] = sorted(set(value["status"]))
    if isinstance(value.get("concepts"), list):
        value["concepts"] = _canonical_concepts(value["concepts"])
    if isinstance(value.get("where"), list):
        value["where"] = _canonical_conditions(value["where"])
    if isinstance(value.get("exclude_curation_ids"), list):
        # A set, not a sequence: the same ids in another order are the same
        # request, so the token and every cursor minted from it stay identical.
        value["exclude_curation_ids"] = sorted(set(value["exclude_curation_ids"]))
    if value.get("sort") == DEFAULT_CURATION_SORT:
        # Absence and the server default are the same request: the scan token
        # and the cursor payload stay byte-compatible with the ones minted
        # before this parameter existed.
        value.pop("sort")
    return {key: item for key, item in value.items() if item not in (None, [], "")}


def start_catalog_scan(db: Database, actor_id: str, filters: dict, secret: str) -> dict:
    """Freeze a high-water sequence while keeping mutable filters live."""

    require_current_cms_admin(db, actor_id)
    normalized = _normalized_filters(filters)
    highest = db.curations.find_one(
        {"catalog_sequence": {"$type": "number"}},
        projection={"catalog_sequence": 1},
        sort=[("catalog_sequence", -1)],
    )
    maximum = int((highest or {}).get("catalog_sequence", 0))
    if maximum == 0 and db.curations.find_one({}, projection={"_id": 1}) is not None:
        raise CatalogScanUnavailable(
            "no Curation carries catalog_sequence; the catalog scan window would be empty. "
            "Run scripts/python-tools/backfill_catalog_sequence.py"
        )
    expires = int((datetime.now(timezone.utc) + timedelta(minutes=15)).timestamp())
    token = _encode_token(
        {"kind": "catalog-scan", "actor": actor_id, "filters": normalized, "max": maximum, "exp": expires}, secret
    )
    return {"scan_token": token, "max_catalog_sequence": maximum}


def catalog_scan_page(
    db: Database, actor_id: str, scan_token: str, cursor: str | None, limit: int, secret: str
) -> dict:
    require_current_cms_admin(db, actor_id)
    scan = _decode_token(scan_token, secret)
    if scan.get("kind") != "catalog-scan" or scan.get("actor") != actor_id or not isinstance(scan.get("max"), int):
        raise CatalogCursorError("invalid scan")
    sort = scan["filters"].get("sort") or DEFAULT_CURATION_SORT
    position = None
    if cursor:
        position = _decode_token(cursor, secret)
        if (
            any(position.get(key) != scan.get(key) for key in ("actor", "filters", "max", "exp"))
            or position.get("kind") != "catalog-page"
        ):
            raise CatalogCursorError("invalid cursor")
    clauses: list[dict] = [catalog_query(scan["filters"]), {"catalog_sequence": {"$lte": scan["max"]}}]
    if position is not None:
        clauses.append(_position_clause(sort, position))
    rows = _admin_rows(db, clauses, sort, limit)
    page, more = rows[:limit], len(rows) > limit
    items = admin_curation_rows(page)
    next_cursor = None
    if more and items:
        next_cursor = _position_cursor(
            {
                "kind": "catalog-page",
                "actor": scan["actor"],
                "filters": scan["filters"],
                "max": scan["max"],
                "exp": scan["exp"],
            },
            sort,
            items[-1],
            secret,
        )
    return {"items": items, "next_cursor": next_cursor}


def catalog_search_page(
    db: Database, actor_id: str, filters: dict, cursor: str | None, limit: int, secret: str
) -> dict:
    """Page through the live Explorer catalog with a cursor bound to its filters.

    This is deliberately a narrow projection: the Admin can discover Curations
    at scale, but never receives the embedding payloads. The signed cursor
    carries the filters *and* the requested sort, so a cursor minted for one
    ordering is refused instead of being reinterpreted into a wrong page.
    """

    require_current_cms_admin(db, actor_id)
    normalized = _normalized_filters(filters)
    sort = normalized.get("sort") or DEFAULT_CURATION_SORT
    position = None
    if cursor:
        position = _decode_token(cursor, secret)
        if (
            position.get("kind") != "catalog-search"
            or position.get("actor") != actor_id
            or position.get("filters") != normalized
        ):
            raise CatalogCursorError("invalid cursor")

    clauses: list[dict] = [catalog_query(normalized), {"catalog_sequence": {"$type": "number"}}]
    if position is not None:
        clauses.append(_position_clause(sort, position))
    rows = _admin_rows(db, clauses, sort, limit)
    if (
        not rows
        and db.curations.find_one({}, projection={"_id": 1}) is not None
        and db.curations.find_one({"catalog_sequence": {"$type": "number"}}, projection={"_id": 1}) is None
    ):
        # Uma página vazia aqui é ambígua: pode ser filtro sem resultado ou a
        # coleção inteira sem `catalog_sequence` — este caminho pagina por esse
        # campo, então sem ele NADA casa e a tela diz "não há Curadorias" sobre
        # milhares de linhas (produção, 2026-09-15). O custo da checagem só
        # existe no caso vazio.
        raise CatalogScanUnavailable(
            "no Curation carries catalog_sequence, so this listing can only be empty. "
            "Run scripts/python-tools/backfill_catalog_sequence.py"
        )
    page, more = rows[:limit], len(rows) > limit
    items = admin_curation_rows(page)
    next_cursor = None
    if more and items:
        next_cursor = _position_cursor(
            {
                "kind": "catalog-search",
                "actor": actor_id,
                "filters": normalized,
                "exp": int((datetime.now(timezone.utc) + timedelta(minutes=15)).timestamp()),
            },
            sort,
            items[-1],
            secret,
        )
    return {"items": items, "next_cursor": next_cursor}


def _distinct_in_order(curation_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for curation_id in curation_ids:
        if curation_id not in seen:
            seen.add(curation_id)
            result.append(curation_id)
    return result


def require_current_cms_admin(db: Database, actor_subject: str) -> None:
    """Re-read the worker's asserted actor, accepting only a live admin.

    Payload forwards the opaque ``user_id`` obtained during CMS introspection,
    while service callers may use the stable email subject. Neither value is
    trusted until the operational user record is loaded again.
    """

    actor_ids: list[object] = [actor_subject]
    if ObjectId.is_valid(actor_subject):
        actor_ids.append(ObjectId(actor_subject))
    actor = db.users.find_one({"$or": [{"_id": {"$in": actor_ids}}, {"email": actor_subject}]})
    if actor is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CMS actor was not found")
    if actor.get("authorized") is not True or actor.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CMS admin access is required")


def resolve_curations(
    db: Database,
    curation_ids: list[str],
    actor_subject: str,
) -> ResolveCurationsResponse:
    """Resolve a selection without ever treating catalog eligibility as public availability."""

    require_current_cms_admin(db, actor_subject)
    requested_ids = _distinct_in_order(curation_ids)
    records = {
        record["curation_id"]: record
        for record in db.curations.find(
            {"curation_id": {"$in": requested_ids}},
            {"_id": 0, "curation_id": 1, "status": 1},
        )
    }

    eligible_ids: list[str] = []
    rejected: list[RejectedCuration] = []
    for curation_id in requested_ids:
        record = records.get(curation_id)
        if record is None:
            rejected.append(RejectedCuration(curation_id=curation_id, reason="not_found"))
        elif record.get("status") in SELECTABLE_STATUSES:
            eligible_ids.append(curation_id)
        else:
            rejected.append(RejectedCuration(curation_id=curation_id, reason="ineligible_status"))

    return ResolveCurationsResponse(eligible_ids=eligible_ids, rejected=rejected)


def curation_summaries(db: Database, curation_ids: list[str], actor_subject: str) -> dict:
    """The Admin list row of every requested Curation, in the requested order.

    Humanizes Collection members and draft diffs: ONE ``$in`` query, the SAME
    row builder the list serves, and unknown ids omitted instead of rejected —
    a stale membership renders as nothing rather than failing the whole batch.
    """

    require_current_cms_admin(db, actor_subject)
    requested = _distinct_in_order(curation_ids)
    if not requested:
        return {"items": []}
    rows = list(db.curations.find({"curation_id": {"$in": requested}}, _ADMIN_ROW_PROJECTION))
    by_id = {row["curation_id"]: row for row in admin_curation_rows(rows)}
    return {"items": [by_id[curation_id] for curation_id in requested if curation_id in by_id]}


# ``without_images`` counts the Curations with no usable image source at all:
# the key is absent, is not a list, or is an empty list.
_WITHOUT_IMAGES_CLAUSE = {
    "$or": [
        {"sources.image": {"$exists": False}},
        {"sources.image": {"$not": {"$type": "array"}}},
        {"sources.image": {"$size": 0}},
    ]
}

# The 24h window the ``updated_today`` counter reports. There is deliberately
# no "processing errors" counter: nothing in the stored Curation carries a
# processing outcome or an error signal (``sources`` entries and
# ``embeddings_metadata`` included), and inventing one is not an option.
CONTENT_HEALTH_WINDOW = timedelta(hours=24)

CONTENT_HEALTH_COUNTERS = (
    "total",
    "unlinked",
    "synthetic_drafts",
    "without_images",
    "without_transcript",
    "updated_today",
    "without_collections",
)


def _facet_count(bucket: object) -> int:
    """The count of one ``$facet`` branch (an empty bucket counts zero)."""
    if isinstance(bucket, list) and bucket and isinstance(bucket[0], dict):
        count = bucket[0].get("count")
        if isinstance(count, int):
            return count
    return 0


def content_health(db: Database, member_curation_ids: list[str], actor_subject: str) -> dict:
    """Editorial counters for the Admin overview, in ONE aggregation.

    Every counter is computed over the non-deleted Curations only, and the
    member ids are de-duplicated first so the answer never depends on how the
    caller ordered or repeated them.
    """

    require_current_cms_admin(db, actor_subject)
    members = _distinct_in_order(member_curation_ids)
    # BSON datetimes are UTC but come back naive, and PyMongo reads a naive
    # value as UTC, so the window is compared as naive UTC on both ends.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    pipeline = [
        {"$match": {"status": {"$ne": DELETED_STATUS}}},
        {
            "$facet": {
                "total": [{"$count": "count"}],
                "unlinked": [{"$match": unlinked_entity_clause(True)}, {"$count": "count"}],
                "synthetic_drafts": [
                    {"$match": {"curator_type": "synthetic", "status": "draft"}},
                    {"$count": "count"},
                ],
                "without_images": [{"$match": _WITHOUT_IMAGES_CLAUSE}, {"$count": "count"}],
                "without_transcript": [{"$match": _is_empty_clause("transcript")}, {"$count": "count"}],
                "updated_today": [
                    {"$match": {"updatedAt": {"$gte": now - CONTENT_HEALTH_WINDOW, "$lte": now}}},
                    {"$count": "count"},
                ],
                "without_collections": [{"$match": {"curation_id": {"$nin": members}}}, {"$count": "count"}],
            }
        },
    ]
    facets = next(iter(db.curations.aggregate(pipeline)), {})
    return {name: _facet_count(facets.get(name)) for name in CONTENT_HEALTH_COUNTERS}
