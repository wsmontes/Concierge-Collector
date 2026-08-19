"""Internal catalog selection contract used by the Payload CMS worker."""

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
