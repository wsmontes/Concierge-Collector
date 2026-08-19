"""Live availability evaluation for a frozen Collection membership."""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError
from pymongo.database import Database
from pymongo.errors import PyMongoError

from app.models.distribution import (
    AvailabilityReason,
    HydrateCurationsResponse,
    PublicCurationItem,
    UnavailableItem,
)
from app.models.distribution_api import PublicCurationItemV1


class DistributionDependencyError(RuntimeError):
    """The live source is unavailable; it must never look like an empty set."""


@dataclass(frozen=True)
class AvailabilityResult:
    item: PublicCurationItem | None
    reason: AvailabilityReason | None


@dataclass(frozen=True)
class HydrationBatch:
    """The versioned public representation plus live unavailability reasons."""

    items: list[PublicCurationItemV1]
    unavailable: list[UnavailableItem]


def _canonical_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized or "\x00" in normalized or "\n" in normalized:
        return None
    return normalized


def _display_name(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def evaluate_public_item(curation: dict | None, entity: dict | None) -> AvailabilityResult:
    """Classify domain data without swallowing database/transport failures."""

    if curation is None:
        return AvailabilityResult(None, "curation_missing")
    if curation.get("status") != "active":
        return AvailabilityResult(None, "curation_not_public")

    curation_id = _canonical_id(curation.get("curation_id"))
    if curation_id is None:
        return AvailabilityResult(None, "schema_invalid")
    if curation.get("entity_id") is None:
        return AvailabilityResult(None, "missing_entity")
    entity_id = _canonical_id(curation.get("entity_id"))
    if entity_id is None:
        return AvailabilityResult(None, "schema_invalid")
    if entity is None:
        return AvailabilityResult(None, "missing_entity")
    if entity.get("status") != "active":
        return AvailabilityResult(None, "entity_not_public")
    if _canonical_id(entity.get("entity_id")) != entity_id:
        return AvailabilityResult(None, "schema_invalid")

    name = _display_name(entity.get("name"))
    if name is None:
        return AvailabilityResult(None, "schema_invalid")
    notes = curation.get("notes")
    public_note = notes.get("public") if isinstance(notes, dict) else None
    if public_note is not None and not isinstance(public_note, str):
        return AvailabilityResult(None, "schema_invalid")

    try:
        return AvailabilityResult(
            PublicCurationItem(
                curation_id=curation_id,
                entity_id=entity_id,
                name=name,
                curation_note=public_note.strip() if isinstance(public_note, str) and public_note.strip() else None,
            ),
            None,
        )
    except ValidationError:
        return AvailabilityResult(None, "schema_invalid")


def _distinct_in_order(curation_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for curation_id in curation_ids:
        if curation_id not in seen:
            seen.add(curation_id)
            ordered.append(curation_id)
    return ordered


def hydrate_public_items(db: Database, curation_ids: list[str]) -> HydrateCurationsResponse:
    """Hydrate up to 500 selected IDs against current operational documents."""

    requested = _distinct_in_order(curation_ids)
    try:
        curations = {
            record.get("curation_id"): record
            for record in db.curations.find(
                {"curation_id": {"$in": requested}},
                {"_id": 0, "curation_id": 1, "entity_id": 1, "status": 1, "notes": 1},
            )
            if isinstance(record.get("curation_id"), str)
        }
        entity_ids = [
            record.get("entity_id") for record in curations.values() if isinstance(record.get("entity_id"), str)
        ]
        entities = {
            record.get("entity_id"): record
            for record in db.entities.find(
                {"entity_id": {"$in": entity_ids}},
                {"_id": 0, "entity_id": 1, "status": 1, "name": 1},
            )
            if isinstance(record.get("entity_id"), str)
        }
    except PyMongoError as exc:
        raise DistributionDependencyError("Live distribution source is unavailable") from exc

    items: list[PublicCurationItem] = []
    unavailable: list[UnavailableItem] = []
    for curation_id in requested:
        curation = curations.get(curation_id)
        entity_id = curation.get("entity_id") if curation else None
        entity = entities.get(entity_id) if isinstance(entity_id, str) else None
        result = evaluate_public_item(curation, entity)
        if result.item is not None:
            items.append(result.item)
        else:
            unavailable.append(UnavailableItem(curation_id=curation_id, reason=result.reason or "schema_invalid"))

    return HydrateCurationsResponse(
        items=items,
        unavailable=unavailable,
        selected_count=len(requested),
        available_count=len(items),
        unavailable_count=len(unavailable),
    )


def hydrate_public_batch(db: Database, curation_ids: list[str]) -> HydrationBatch:
    """Hydrate up to 500 frozen membership IDs into the v1 public DTO.

    The Mongo projections enumerate only public candidate fields.  Even though
    the DTO mapper has a second allowlist, private transcript/source/curator
    documents are not fetched across this boundary in the first place.
    """

    requested = _distinct_in_order(curation_ids)
    if len(requested) > 500:
        raise ValueError("distribution hydration batch exceeds 500 IDs")
    try:
        curations = {
            record.get("curation_id"): record
            for record in db.curations.find(
                {"curation_id": {"$in": requested}},
                {
                    "_id": 0,
                    "curation_id": 1,
                    "entity_id": 1,
                    "status": 1,
                    "notes.public": 1,
                    "categories": 1,
                    "version": 1,
                    "createdAt": 1,
                    "created_at": 1,
                    "updatedAt": 1,
                    "updated_at": 1,
                },
            )
            if isinstance(record.get("curation_id"), str)
        }
        entity_ids = [
            record.get("entity_id") for record in curations.values() if isinstance(record.get("entity_id"), str)
        ]
        entities = {
            record.get("entity_id"): record
            for record in db.entities.find(
                {"entity_id": {"$in": entity_ids}},
                {
                    "_id": 0,
                    "entity_id": 1,
                    "name": 1,
                    "type": 1,
                    "status": 1,
                    "data.location.address": 1,
                    "data.location.formatted_address": 1,
                    "data.location.city": 1,
                    "data.location.country": 1,
                    "data.location.lat": 1,
                    "data.location.lng": 1,
                    "data.location.latitude": 1,
                    "data.location.longitude": 1,
                    "data.contacts.phone": 1,
                    "data.contacts.website": 1,
                    "data.media.photos": 1,
                    "version": 1,
                    "createdAt": 1,
                    "created_at": 1,
                    "updatedAt": 1,
                    "updated_at": 1,
                },
            )
            if isinstance(record.get("entity_id"), str)
        }
    except PyMongoError as exc:
        raise DistributionDependencyError("Live distribution source is unavailable") from exc

    items: list[PublicCurationItemV1] = []
    unavailable: list[UnavailableItem] = []
    for curation_id in requested:
        curation = curations.get(curation_id)
        entity_id = curation.get("entity_id") if curation else None
        entity = entities.get(entity_id) if isinstance(entity_id, str) else None
        availability = evaluate_public_item(curation, entity)
        if availability.item is None:
            unavailable.append(UnavailableItem(curation_id=curation_id, reason=availability.reason or "schema_invalid"))
            continue
        try:
            items.append(PublicCurationItemV1.from_documents(curation, entity))
        except (KeyError, TypeError, ValueError, ValidationError):
            unavailable.append(UnavailableItem(curation_id=curation_id, reason="schema_invalid"))
    return HydrationBatch(items=items, unavailable=unavailable)
