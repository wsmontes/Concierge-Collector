"""Bounded-memory NDJSON and gzip encoders for Collection exports."""

from __future__ import annotations

import hashlib
import json
import zlib
from collections.abc import Iterable, Iterator
from typing import Any


def encode_record(record: dict[str, Any]) -> bytes:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8") + b"\n"


def _item_value(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return value
    raise TypeError("distribution dump item must be a public DTO or dict")


def iter_ndjson_dump(
    manifest: dict[str, Any], item_batches: Iterable[Iterable[Any] | tuple[Iterable[Any], Iterable[Any]]]
) -> Iterator[bytes]:
    """Yield manifest, item records and a footer only after complete success.

    A hydration/database failure intentionally propagates out of this iterator;
    consumers then observe a partial stream without the completion footer.
    """

    yield encode_record({"record_type": "manifest", **manifest})
    digest = hashlib.sha256()
    available_count = 0
    unavailable_count = 0
    unavailable_reasons: dict[str, int] = {}
    for batch in item_batches:
        items: Iterable[Any]
        unavailable: Iterable[Any]
        if isinstance(batch, tuple):
            items, unavailable = batch
        else:
            items, unavailable = batch, []
        for item in items:
            line = encode_record({"record_type": "item", "item": _item_value(item)})
            digest.update(line)
            available_count += 1
            yield line
        for item in unavailable:
            unavailable_count += 1
            reason = getattr(item, "reason", None)
            if reason is None and isinstance(item, dict):
                reason = item.get("reason")
            if isinstance(reason, str):
                unavailable_reasons[reason] = unavailable_reasons.get(reason, 0) + 1
    yield encode_record(
        {
            "record_type": "footer",
            "selected_count": manifest.get("selected_count"),
            "available_count": available_count,
            "unavailable_count": unavailable_count,
            "unavailable_reasons": unavailable_reasons,
            "sha256": digest.hexdigest(),
        }
    )


def collect_json_dump(
    manifest: dict[str, Any], item_batches: Iterable[Iterable[Any] | tuple[Iterable[Any], Iterable[Any]]]
) -> dict[str, Any]:
    """Aggregate a dump into one JSON document: {manifest, items, footer}.

    Callers must enforce the JSON cap (`distribution_json_max_selected`)
    before materializing; NDJSON remains the streaming path for large sets.
    Reuses the canonical encoder so the JSON and NDJSON dumps agree on the
    logical records and the footer digest.
    """

    records: dict[str, Any] = {"items": []}
    for line in iter_ndjson_dump(manifest, item_batches):
        record = json.loads(line)
        record_type = record.get("record_type")
        if record_type == "item":
            records["items"].append(record.get("item"))
        elif record_type is not None:
            records[record_type] = record
    return records


def gzip_iter(chunks: Iterable[bytes]) -> Iterator[bytes]:
    compressor = zlib.compressobj(wbits=31)
    for chunk in chunks:
        compressed = compressor.compress(chunk)
        if compressed:
            yield compressed
    tail = compressor.flush()
    if tail:
        yield tail
