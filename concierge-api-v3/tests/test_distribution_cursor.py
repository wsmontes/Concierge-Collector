from datetime import datetime, timedelta, timezone

import pytest

from app.services.distribution_cursor import CursorError, decode_cursor, encode_cursor


NOW = datetime(2026, 8, 20, tzinfo=timezone.utc)
PAYLOAD = {
    "purpose": "collection-items",
    "applicationId": "app-1",
    "collectionId": "collection-1",
    "publishedVersion": 3,
    "schemaVersion": 1,
    "filtersHash": "default",
    "lastCurationId": "curation-1",
}


def test_cursor_is_signed_expiring_and_bound_to_its_context():
    cursor = encode_cursor(PAYLOAD, "cursor-secret", now=NOW, ttl=timedelta(minutes=15))
    assert (
        decode_cursor(
            cursor, "cursor-secret", now=NOW, expected={"applicationId": "app-1", "collectionId": "collection-1"}
        )["publishedVersion"]
        == 3
    )

    with pytest.raises(CursorError):
        decode_cursor(cursor, "cursor-secret", now=NOW, expected={"applicationId": "app-2"})
    with pytest.raises(CursorError):
        decode_cursor(cursor + "x", "cursor-secret", now=NOW)
    with pytest.raises(CursorError):
        decode_cursor(cursor, "cursor-secret", now=NOW + timedelta(minutes=16))
