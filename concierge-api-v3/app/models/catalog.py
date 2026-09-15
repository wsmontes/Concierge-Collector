"""Internal catalog selection contract used by the Payload CMS worker."""

from datetime import datetime
from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ``concept.<Category>=<value>`` conditions interpolate the category into a
# Mongo field path (``categories.<Category>``), so the category is the one
# client-supplied string that must never carry a path separator or a terminator.
CONCEPT_FIELD_MAX_LENGTH = 80
CONCEPT_CATEGORY_FORBIDDEN_CHARS = ("$", ".", "\x00")

# Advanced field conditions (the ``where`` query parameter and
# ``CatalogFilters.where``). The wire format is one JSON object per condition,
# ``{"field": ..., "op": ..., "value": ...}``; the field allowlist is CLOSED on
# purpose, because every field is interpolated into a Mongo path — a field the
# boundary cannot address is refused by name instead of silently ignored.
FilterOperator = Literal[
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "starts_with",
    "greater_than",
    "less_than",
    "exists",
    "not_exists",
    "is_empty",
    "is_not_empty",
    "before",
    "after",
    "contains_any",
    "contains_all",
]
FILTER_OPERATORS: frozenset[str] = frozenset(get_args(FilterOperator))

# Operators whose ``value`` is meaningless: they ask about the field itself.
FILTER_VALUE_LESS_OPERATORS: frozenset[str] = frozenset({"exists", "not_exists", "is_empty", "is_not_empty"})

FILTER_FIELD_MAX_LENGTH = 200

# Fields addressed by their exact stored root path.
FILTER_FIELD_PATHS: dict[str, str] = {
    "restaurant_name": "restaurant_name",
    "status": "status",
    "city": "city",
    "type": "type",
    "entity_id": "entity_id",
    "curator_id": "curator_id",
    "curator_type": "curator_type",
    "curator.name": "curator.name",
    "notes.public": "notes.public",
    "notes.private": "notes.private",
    "transcript": "transcript",
    "catalog_sequence": "catalog_sequence",
    "version": "version",
    "createdAt": "createdAt",
    "updatedAt": "updatedAt",
}
# Flexible roots: ``sources.image``, ``metadata.google_places.rating`` … Capped
# at three segments so a client cannot walk an arbitrarily deep stored path.
FILTER_PATH_PREFIXES = ("sources", "metadata")
FILTER_PATH_MAX_DEPTH = 3


def _path_key_is_safe(key: str) -> bool:
    return bool(key) and len(key) <= CONCEPT_FIELD_MAX_LENGTH and concept_category_is_safe(key)


def resolve_filter_field(field: str) -> str:
    """The stored Mongo path for one allowlisted ``where`` field.

    Raises ``ValueError`` naming the field for anything outside the allowlist,
    so both the request model and the predicate builder refuse identically.
    """
    direct = FILTER_FIELD_PATHS.get(field)
    if direct is not None:
        return direct

    root, _, rest = field.partition(".")
    if root == "categories" and rest:
        if not _path_key_is_safe(rest):
            raise ValueError(f"Unknown filter field {field!r}")
        return f"categories.{rest}"
    if root in FILTER_PATH_PREFIXES and rest:
        segments = field.split(".")
        if len(segments) > FILTER_PATH_MAX_DEPTH or not all(_path_key_is_safe(segment) for segment in segments):
            raise ValueError(f"Unknown filter field {field!r}")
        return field
    raise ValueError(f"Unknown filter field {field!r}")


# Sort values published to the Admin. ``sequence_asc`` is the server default
# and reproduces the ordering every existing consumer (the Collector included)
# already gets; the Admin list asks for ``updated_at_desc`` explicitly.
CurationSort = Literal[
    "sequence_asc",
    "sequence_desc",
    "updated_at_desc",
    "updated_at_asc",
    "created_at_desc",
    "created_at_asc",
    "name_asc",
    "name_desc",
]
DEFAULT_CURATION_SORT: CurationSort = "sequence_asc"


def concept_category_is_safe(category: str) -> bool:
    """True when ``category`` can be interpolated into a Mongo field path."""
    return bool(category) and not any(char in category for char in CONCEPT_CATEGORY_FORBIDDEN_CHARS)


class ConceptFilter(BaseModel):
    """One ``concept.<Category>=<value>`` array-contains condition.

    The value must be contained in the stored ``categories.<Category>`` array;
    every supplied condition must hold (AND).
    """

    category: str = Field(min_length=1, max_length=CONCEPT_FIELD_MAX_LENGTH)
    value: str = Field(min_length=1, max_length=CONCEPT_FIELD_MAX_LENGTH)

    @field_validator("category")
    @classmethod
    def _reject_unsafe_category(cls, value: str) -> str:
        if not concept_category_is_safe(value):
            raise ValueError("category must not contain '$', '.' or a null byte")
        return value


class AdminFilterCondition(BaseModel):
    """One advanced field condition (``where``).

    Every condition must hold (AND), so the same field may carry several of
    them. ``field`` is validated against the closed allowlist here — the model
    is the single place both the query parameter and the scan body go through —
    and resolved into its stored Mongo path by ``resolve_filter_field``.
    """

    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1, max_length=FILTER_FIELD_MAX_LENGTH)
    op: FilterOperator
    value: Any = None

    @field_validator("field")
    @classmethod
    def _reject_unknown_field(cls, value: str) -> str:
        try:
            resolve_filter_field(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from None
        return value

    @model_validator(mode="after")
    def _validate_value(self) -> "AdminFilterCondition":
        if self.op in FILTER_VALUE_LESS_OPERATORS:
            # The operator asks about the field itself; a stray value is
            # dropped so two equivalent requests canonicalize identically.
            self.value = None
        elif self.op in ("contains", "not_contains", "starts_with"):
            if not isinstance(self.value, str):
                raise ValueError(f"operator '{self.op}' requires a string value")
        elif self.op in ("contains_any", "contains_all"):
            if not isinstance(self.value, list) or not self.value:
                raise ValueError(f"operator '{self.op}' requires a non-empty list value")
            if not all(isinstance(item, (str, int, float, bool)) for item in self.value):
                raise ValueError(f"operator '{self.op}' accepts scalar list items only")
        elif self.op in ("greater_than", "less_than"):
            if isinstance(self.value, bool) or not isinstance(self.value, (int, float, str)):
                raise ValueError(f"operator '{self.op}' requires a number or a string value")
        elif self.op in ("before", "after"):
            if not isinstance(self.value, str):
                raise ValueError(f"operator '{self.op}' requires an ISO 8601 string value")
            try:
                datetime.fromisoformat(self.value)
            except ValueError:
                raise ValueError(f"operator '{self.op}' requires an ISO 8601 string value") from None
        return self


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
    concepts: list[ConceptFilter] = Field(default_factory=list)
    unlinked: bool | None = Field(
        default=None,
        description=(
            "True selects Curations with no Entity (``entity_id`` missing, null, empty or "
            "whitespace-only); false selects only Curations that have one. Omitted means both."
        ),
    )
    where: list[AdminFilterCondition] = Field(
        default_factory=list,
        description="Advanced field conditions, ANDed with every other filter.",
    )
    # Optional like the query parameter: the server default (``sequence_asc``)
    # is resolved when the filters are normalized, so an omitted sort still
    # pages — and still signs a cursor — exactly like the default listing.
    sort: CurationSort | None = None


class AdminCurationRow(BaseModel):
    curation_id: str
    catalog_sequence: int = Field(ge=1)
    status: str
    restaurant_name: str | None = None
    city: str | None = None
    entity_type: str | None = None
    curator_id: str | None = None
    updated_at: datetime | None = None
    created_at: datetime | None = Field(
        default=None, description="Stored ``createdAt`` (null when the document has none)."
    )
    curator_name: str | None = Field(
        default=None, description="Stored ``curator.name`` (null when the document has none)."
    )
    concepts: list[str] | None = Field(
        default=None,
        description=(
            "Every concept value stored under ``categories``, de-duplicated and capped — "
            "null when ``categories`` is not a stored mapping."
        ),
    )
    source_count: int | None = Field(
        default=None, description="Keys in the stored ``sources`` mapping (null when it is not a mapping)."
    )
    image_count: int | None = Field(
        default=None, description="Length of ``sources.image`` (null when it is not a list)."
    )
    audio_count: int | None = Field(
        default=None, description="Length of ``sources.audio`` (null when it is not a list)."
    )
    has_transcript: bool = Field(default=False, description="True only when ``transcript`` is a non-empty string.")
    version: int | None = Field(default=None, description="Stored optimistic-locking version.")


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
