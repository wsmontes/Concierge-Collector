"""Versioned, allowlisted DTOs for consumer Collection distribution."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _PublicModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PublicAddress(_PublicModel):
    address: str | None = None
    city: str | None = None
    country: str | None = None


class PublicCoordinates(_PublicModel):
    latitude: float | None = None
    longitude: float | None = None


class PublicContact(_PublicModel):
    phone: str | None = None
    website: str | None = None


class PublicMedia(_PublicModel):
    photos: list[str] = Field(default_factory=list)


class PublicEntity(_PublicModel):
    id: str
    name: str
    type: str
    address: PublicAddress = Field(default_factory=PublicAddress)
    coordinates: PublicCoordinates = Field(default_factory=PublicCoordinates)
    contact: PublicContact = Field(default_factory=PublicContact)
    media: PublicMedia = Field(default_factory=PublicMedia)
    version: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class PublicCuration(_PublicModel):
    id: str
    entity_id: str
    description: str | None = None
    categories: dict[str, list[str]] = Field(default_factory=dict)
    version: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


def _text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _record(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _first_record(*values: object) -> dict:
    for value in values:
        record = _record(value)
        if record:
            return record
    return {}


def _categories(value: object) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, list[str]] = {}
    for key, items in value.items():
        if not isinstance(key, str) or not isinstance(items, list):
            continue
        clean = [item.strip() for item in items if isinstance(item, str) and item.strip()]
        if clean:
            result[key] = clean
    return result


def _timestamp(document: dict, *names: str) -> str | None:
    for name in names:
        value = document.get(name)
        if hasattr(value, "isoformat"):
            return value.isoformat()
        if isinstance(value, str) and value.strip():
            return value
    return None


class PublicCurationItemV1(_PublicModel):
    schema_version: Literal[1] = 1
    curation: PublicCuration
    entity: PublicEntity

    @classmethod
    def from_documents(cls, curation: dict, entity: dict) -> "PublicCurationItemV1":
        """Map selected fields only; never spread a Mongo document into output."""

        entity_data = _record(entity.get("data"))
        location = _first_record(entity_data.get("location"), entity.get("location"), entity_data.get("address"))
        contacts = _first_record(entity_data.get("contacts"), entity.get("contacts"), entity.get("contact"))
        media = _first_record(entity_data.get("media"), entity.get("media"))
        notes = _record(curation.get("notes"))
        photos = media.get("photos")
        safe_photos = (
            [photo for photo in photos if isinstance(photo, str) and photo.strip()] if isinstance(photos, list) else []
        )
        latitude = _number(location.get("lat", location.get("latitude")))
        longitude = _number(location.get("lng", location.get("longitude")))

        return cls(
            curation=PublicCuration(
                id=str(curation["curation_id"]),
                entity_id=str(curation["entity_id"]),
                description=_text(notes.get("public")),
                categories=_categories(curation.get("categories")),
                version=curation.get("version") if isinstance(curation.get("version"), int) else None,
                created_at=_timestamp(curation, "createdAt", "created_at"),
                updated_at=_timestamp(curation, "updatedAt", "updated_at"),
            ),
            entity=PublicEntity(
                id=str(entity["entity_id"]),
                name=str(entity["name"]),
                type=str(entity.get("type") or "restaurant"),
                address=PublicAddress(
                    address=_text(location.get("address", location.get("formatted_address"))),
                    city=_text(location.get("city")),
                    country=_text(location.get("country")),
                ),
                coordinates=PublicCoordinates(latitude=latitude, longitude=longitude),
                contact=PublicContact(phone=_text(contacts.get("phone")), website=_text(contacts.get("website"))),
                media=PublicMedia(photos=safe_photos),
                version=entity.get("version") if isinstance(entity.get("version"), int) else None,
                created_at=_timestamp(entity, "createdAt", "created_at"),
                updated_at=_timestamp(entity, "updatedAt", "updated_at"),
            ),
        )
