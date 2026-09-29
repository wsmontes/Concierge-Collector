"""Total, JSON-safe serialization for full CMS record reads.

Raw Mongo documents mix BSON types (ObjectId, Decimal128, Binary) and
datetimes that a narrow projection would hide, and the Admin inspector must
never lose unknown/legacy fields. This module walks the whole document instead
of projecting it, degrading unrecognized values instead of raising.
"""

from datetime import date, datetime
from typing import Any

from bson import Binary, Decimal128, ObjectId

_PRIMITIVES = (str, int, float, bool)


def json_safe(value: Any) -> Any:
    """Recursively convert ``value`` into JSON-serializable data.

    Total by construction: an unrecognized type degrades to ``str(value)``
    so a single exotic field cannot break a whole record read.
    """
    if value is None or isinstance(value, _PRIMITIVES):
        return value
    if isinstance(value, ObjectId):
        return str(value)
    # ``datetime`` subclasses ``date``; both serialize to ISO-8601. Naive
    # values stay naive (isoformat adds no offset) rather than inventing UTC.
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal128):
        return str(value)
    if isinstance(value, (bytes, Binary)):
        return {"$binary": len(value)}
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return str(value)


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def embedding_summary(entries: Any) -> list[dict[str, Any]]:
    """Summarize embedding entries, dropping the raw vectors.

    Vectors are ~6KB each and are binary payload, not admin-facing content.
    """
    if not isinstance(entries, list):
        return []
    summary: list[dict[str, Any]] = []
    for entry in entries:
        source = entry if isinstance(entry, dict) else {}
        vector = source.get("vector")
        if vector is None:
            vector = source.get("embedding")
        summary.append(
            {
                "model": _optional_str(source.get("model")),
                "dimensions": len(vector) if isinstance(vector, list) else None,
                "created_at": _optional_str(source.get("created_at")),
            }
        )
    return summary


def _record(doc: dict[str, Any]) -> dict[str, Any]:
    # Drop embeddings before the deep walk: serializing the vectors just to
    # replace them would copy the exact payload we are avoiding.
    record = {str(key): json_safe(value) for key, value in doc.items() if key != "embeddings"}
    if "embeddings" in doc:
        record["embeddings"] = embedding_summary(doc["embeddings"])
    return record


def curation_record(doc: dict[str, Any]) -> dict[str, Any]:
    """Deep-serialize a curation document; ``embeddings`` becomes a summary."""
    return _record(doc)


def entity_record(doc: dict[str, Any]) -> dict[str, Any]:
    """Deep-serialize an entity document; ``embeddings`` becomes a summary."""
    return _record(doc)
