"""Full-record read contract for the CMS content inspector."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class ContentRecordResponse(BaseModel):
    """A whole stored document, serialized to JSON-safe values.

    ``record`` carries every field of the source document (unknown/legacy
    fields included) so the Admin can render raw content it does not yet model.
    """

    kind: Literal["curation", "entity"]
    id: str
    record: dict[str, Any]


class CurationFieldPatch(BaseModel):
    """A dotted-field patch authored by the CMS editorial writer.

    At least one field is mandatory: an empty patch would still bump
    ``version`` and mislead the editor's optimistic-lock state.
    """

    fields: dict[str, Any] = Field(..., min_length=1)
