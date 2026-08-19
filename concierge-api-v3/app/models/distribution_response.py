from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.distribution import UnavailableItem
from app.models.distribution_api import PublicCurationItemV1


class DistributionCollectionInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    version: int
    selected_count: int = Field(ge=0)


class CollectionDistributionEnvelopeV1(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = 1
    collection: DistributionCollectionInfo
    items: list[PublicCurationItemV1]
    unavailable: list[UnavailableItem]
    available_count: int = Field(ge=0)
    unavailable_count: int = Field(ge=0)
    next_cursor: str | None = None
