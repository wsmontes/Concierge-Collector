"""Internal catalog selection contract used by the Payload CMS worker."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ResolveCurationsRequest(BaseModel):
    """A bounded, explicitly chosen set of Curations to resolve."""

    curation_ids: list[str] = Field(min_length=1, max_length=500)


class RejectedCuration(BaseModel):
    curation_id: str
    reason: Literal["not_found", "ineligible_status"]


class ResolveCurationsResponse(BaseModel):
    eligible_ids: list[str]
    rejected: list[RejectedCuration]


class CatalogFilters(BaseModel):
    q: str | None = Field(default=None, max_length=200)
    status: list[Literal["draft", "linked", "active", "deleted", "archived"]] = Field(default_factory=list)
    city: str | None = Field(default=None, max_length=120)
    entity_type: str | None = Field(default=None, max_length=80)
    curator_id: str | None = Field(default=None, max_length=200)
    updated_from: datetime | None = None
    updated_to: datetime | None = None


class AdminCurationRow(BaseModel):
    curation_id: str
    catalog_sequence: int = Field(ge=1)
    status: str
    restaurant_name: str | None = None
    city: str | None = None
    entity_type: str | None = None
    curator_id: str | None = None
    updated_at: datetime | None = None


class CatalogSearchPage(BaseModel):
    items: list[AdminCurationRow]
    next_cursor: str | None = None
    total: int | None = Field(default=None, ge=0)


class CatalogScanStartRequest(BaseModel):
    filters: CatalogFilters = Field(default_factory=CatalogFilters)


class CatalogScanStart(BaseModel):
    scan_token: str
    max_catalog_sequence: int = Field(ge=0)


class CatalogScanPageRequest(BaseModel):
    scan_token: str = Field(min_length=1)
    cursor: str | None = None
    limit: int = Field(default=100, ge=1, le=500)


class CatalogScanPage(BaseModel):
    items: list[AdminCurationRow]
    next_cursor: str | None = None
