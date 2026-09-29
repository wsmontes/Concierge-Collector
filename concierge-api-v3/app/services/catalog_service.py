"""Bounded selection resolution and high-water scans for CMS Explorer."""

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json

from fastapi import HTTPException, status
from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.database import Database

from app.models.catalog import RejectedCuration, ResolveCurationsResponse

SELECTABLE_STATUSES = frozenset({"active", "draft", "linked"})
CATALOG_SEQUENCE_COUNTER_ID = "curations_catalog_sequence"


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


def _normalized_filters(filters: dict) -> dict:
    value = dict(filters)
    if isinstance(value.get("q"), str):
        value["q"] = value["q"].strip().lower() or None
    if isinstance(value.get("status"), list):
        value["status"] = sorted(set(value["status"]))
    return {key: item for key, item in value.items() if item not in (None, [], "")}


def _filter_query(filters: dict) -> dict:
    query: dict = {}
    if filters.get("status"):
        query["status"] = {"$in": filters["status"]}
    if filters.get("city"):
        query["city"] = filters["city"]
    if filters.get("entity_type"):
        query["type"] = filters["entity_type"]
    if filters.get("curator_id"):
        query["curator_id"] = filters["curator_id"]
    if filters.get("q"):
        query["restaurant_name"] = {"$regex": filters["q"], "$options": "i"}
    if filters.get("updated_from") or filters.get("updated_to"):
        updated: dict = {}
        if filters.get("updated_from"):
            updated["$gte"] = filters["updated_from"]
        if filters.get("updated_to"):
            updated["$lte"] = filters["updated_to"]
        query["updatedAt"] = updated
    return query


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
    last_sequence = last_id = None
    if cursor:
        position = _decode_token(cursor, secret)
        if (
            any(position.get(key) != scan.get(key) for key in ("actor", "filters", "max", "exp"))
            or position.get("kind") != "catalog-page"
        ):
            raise CatalogCursorError("invalid cursor")
        if not isinstance(position.get("sequence"), int) or not isinstance(position.get("curation_id"), str):
            raise CatalogCursorError("invalid cursor")
        last_sequence, last_id = position["sequence"], position["curation_id"]
    clauses: list[dict] = [_filter_query(scan["filters"]), {"catalog_sequence": {"$lte": scan["max"]}}]
    if last_sequence is not None:
        clauses.append(
            {
                "$or": [
                    {"catalog_sequence": {"$gt": last_sequence}},
                    {"catalog_sequence": last_sequence, "curation_id": {"$gt": last_id}},
                ]
            }
        )
    rows = list(
        db.curations.find(
            {"$and": clauses},
            {
                "_id": 0,
                "curation_id": 1,
                "catalog_sequence": 1,
                "status": 1,
                "restaurant_name": 1,
                "city": 1,
                "type": 1,
                "curator_id": 1,
                "updatedAt": 1,
            },
        )
        .sort([("catalog_sequence", 1), ("curation_id", 1)])
        .limit(limit + 1)
    )
    page, more = rows[:limit], len(rows) > limit
    items = [
        {
            "curation_id": str(row["curation_id"]),
            "catalog_sequence": int(row["catalog_sequence"]),
            "status": str(row.get("status") or "draft"),
            "restaurant_name": row.get("restaurant_name"),
            "city": row.get("city"),
            "entity_type": row.get("type"),
            "curator_id": row.get("curator_id"),
            "updated_at": row.get("updatedAt"),
        }
        for row in page
        if isinstance(row.get("curation_id"), str) and isinstance(row.get("catalog_sequence"), int)
    ]
    next_cursor = None
    if more and items:
        tail = items[-1]
        next_cursor = _encode_token(
            {
                "kind": "catalog-page",
                "actor": scan["actor"],
                "filters": scan["filters"],
                "max": scan["max"],
                "exp": scan["exp"],
                "sequence": tail["catalog_sequence"],
                "curation_id": tail["curation_id"],
            },
            secret,
        )
    return {"items": items, "next_cursor": next_cursor}


def catalog_search_page(
    db: Database, actor_id: str, filters: dict, cursor: str | None, limit: int, secret: str
) -> dict:
    """Page through the live Explorer catalog with a cursor bound to its filters.

    This is deliberately a narrow projection: the Admin can discover Curations
    at scale, but never receives the capture transcript or embedding payloads.
    """

    require_current_cms_admin(db, actor_id)
    normalized = _normalized_filters(filters)
    last_sequence = last_id = None
    if cursor:
        position = _decode_token(cursor, secret)
        if (
            position.get("kind") != "catalog-search"
            or position.get("actor") != actor_id
            or position.get("filters") != normalized
            or not isinstance(position.get("sequence"), int)
            or not isinstance(position.get("curation_id"), str)
        ):
            raise CatalogCursorError("invalid cursor")
        last_sequence, last_id = position["sequence"], position["curation_id"]

    clauses: list[dict] = [_filter_query(normalized), {"catalog_sequence": {"$type": "number"}}]
    if last_sequence is not None:
        clauses.append(
            {
                "$or": [
                    {"catalog_sequence": {"$gt": last_sequence}},
                    {"catalog_sequence": last_sequence, "curation_id": {"$gt": last_id}},
                ]
            }
        )
    rows = list(
        db.curations.find(
            {"$and": clauses},
            {
                "_id": 0,
                "curation_id": 1,
                "catalog_sequence": 1,
                "status": 1,
                "restaurant_name": 1,
                "city": 1,
                "type": 1,
                "curator_id": 1,
                "updatedAt": 1,
            },
        )
        .sort([("catalog_sequence", 1), ("curation_id", 1)])
        .limit(limit + 1)
    )
    page, more = rows[:limit], len(rows) > limit
    items = [
        {
            "curation_id": str(row["curation_id"]),
            "catalog_sequence": int(row["catalog_sequence"]),
            "status": str(row.get("status") or "draft"),
            "restaurant_name": row.get("restaurant_name"),
            "city": row.get("city"),
            "entity_type": row.get("type"),
            "curator_id": row.get("curator_id"),
            "updated_at": row.get("updatedAt"),
        }
        for row in page
        if isinstance(row.get("curation_id"), str) and isinstance(row.get("catalog_sequence"), int)
    ]
    next_cursor = None
    if more and items:
        tail = items[-1]
        next_cursor = _encode_token(
            {
                "kind": "catalog-search",
                "actor": actor_id,
                "filters": normalized,
                "exp": int((datetime.now(timezone.utc) + timedelta(minutes=15)).timestamp()),
                "sequence": tail["catalog_sequence"],
                "curation_id": tail["curation_id"],
            },
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
