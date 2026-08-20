"""Narrow internal contract for live Collection availability hydration."""

from typing import Literal

from pydantic import BaseModel, Field

AvailabilityReason = Literal[
    "curation_missing",
    "curation_not_public",
    "missing_entity",
    "entity_not_public",
    "schema_invalid",
]


class HydrateCurationsRequest(BaseModel):
    curation_ids: list[str] = Field(min_length=1, max_length=500)


class PublicCurationItem(BaseModel):
    """The only Curation/Entity fields permitted across the CMS boundary."""

    curation_id: str = Field(min_length=1)
    entity_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    curation_note: str | None = None


class UnavailableItem(BaseModel):
    curation_id: str
    reason: AvailabilityReason


class HydrateCurationsResponse(BaseModel):
    items: list[PublicCurationItem]
    unavailable: list[UnavailableItem]
    selected_count: int = Field(ge=0)
    available_count: int = Field(ge=0)
    unavailable_count: int = Field(ge=0)
