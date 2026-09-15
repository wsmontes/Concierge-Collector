"""Record contract for the Admin editorial CMS boundary.

The Admin must render 100% of a stored Curation or Entity — including fields no
editorial screen knows about — so these payloads carry the stored document
key-for-key (only BSON-only values are made JSON-safe at the boundary) instead
of an allowlisted projection. Writes go through the CMS-boundary PATCH routes,
which reuse the domain update pipelines and refuse system-managed fields.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.catalog import AdminCurationRow
from app.models.schemas import CurationUpdate, EntityUpdate

# Bounds for the two batch reads of the CMS boundary. Both are published to the
# Admin so the worker and the UI agree on the limit instead of discovering it
# through a rejection.
CURATION_SUMMARIES_MAX_IDS = 200
CONTENT_HEALTH_MEMBER_LIMIT = 10000


class CmsCurationUpdate(CurationUpdate):
    """Curation update sent by the CMS: every root key is accepted.

    The domain model stays strict on purpose; this boundary is the one that
    lets the Admin edit a legacy field no screen ever declared (plan §45).
    System-managed keys are rejected against the raw request body before this
    model is built, so a rejected key never reaches a write.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class CmsEntityUpdate(EntityUpdate):
    """Entity update sent by the CMS: every root key is accepted."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class CatalogRecordResponse(BaseModel):
    """The complete stored document, JSON-safe and key-for-key faithful.

    Mongo's ``_id`` is exposed as ``id``; ``ObjectId``/``Decimal128`` become
    strings, dates become ISO-8601 strings and binary payloads (packed float32
    embedding vectors included) become a ``{"format": ..., "byte_length": N}``
    summary. Every other key — unknown and legacy ones included — is returned
    untouched.
    """

    record: dict[str, Any]


class EntityRow(BaseModel):
    """One row of the Admin Entity list."""

    id: str
    entity_id: str | None = None
    name: str | None = None
    type: str | None = None
    status: str | None = None
    city: str | None = Field(
        default=None,
        description="City derived from the stored ``data.city`` value (null when the document has none).",
    )
    updated_at: datetime | None = None
    version: int | None = None
    curations_count: int = Field(
        default=0,
        ge=0,
        description="Curations referencing this Entity, excluding those with status == 'deleted'.",
    )
    curation_ids: list[str] = Field(
        default_factory=list,
        description=(
            "Ids of the Curations referencing this Entity (deleted tombstones excluded), so the CMS can count the "
            "Collections that hold them. A boundary-only join input: it is not part of the Admin browser contract."
        ),
    )


class EntityListPage(BaseModel):
    items: list[EntityRow]
    next_cursor: str | None = None
    total: int | None = Field(default=None, ge=0)


class EntityCurationsPage(BaseModel):
    """Every stored Curation attached to one Entity, newest first."""

    items: list[dict[str, Any]]
    total: int = Field(ge=0)


class CurationSummariesRequest(BaseModel):
    """A bounded batch of Curations the CMS wants to render as list rows."""

    curation_ids: list[str] = Field(min_length=1, max_length=CURATION_SUMMARIES_MAX_IDS)


class CurationSummariesResponse(BaseModel):
    """One ``AdminCurationRow`` per requested Curation, in the requested order.

    Ids that do not exist are omitted — a stale Collection membership or a
    deleted Curation renders as nothing instead of failing the whole batch.
    """

    items: list[AdminCurationRow]


class ContentHealthRequest(BaseModel):
    """Members the caller already tracks in published Collections."""

    member_curation_ids: list[str] = Field(
        description=(
            f"Curation ids currently published as Collection members (at most {CONTENT_HEALTH_MEMBER_LIMIT}; "
            "over the bound the route answers 413)."
        )
    )


class ContentHealthResponse(BaseModel):
    """Editorial counters for the Admin overview, over non-deleted Curations.

    ``updated_today`` counts Curations whose ``updatedAt`` falls inside the last
    24 hours from the moment of the request. ``without_collections`` counts the
    Curations that are not in the member ids the caller reported.
    """

    total: int = Field(ge=0)
    unlinked: int = Field(ge=0, description="No Entity attached (``entity_id`` missing, null or blank).")
    synthetic_drafts: int = Field(ge=0, description="``curator_type == 'synthetic'`` and ``status == 'draft'``.")
    without_images: int = Field(ge=0, description="No usable ``sources.image`` list (absent, non-list or empty).")
    without_transcript: int = Field(ge=0, description="``transcript`` missing, null or empty.")
    updated_today: int = Field(ge=0, description="``updatedAt`` inside the last 24 hours.")
    without_collections: int = Field(ge=0, description="Not among the reported Collection member ids.")
