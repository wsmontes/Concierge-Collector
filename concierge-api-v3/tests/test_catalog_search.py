"""Allowlisted, cursor-paginated search for the CMS Curation Explorer.

Beyond the allowlist/cursor guarantees, this file pins the editorial list
contract: the sort allowlist (server default included), the concept predicate
and the derived columns the Admin table renders.
"""

from datetime import datetime, timedelta, timezone
import json
from typing import get_args

import pytest

from app.core.config import settings
from app.models.catalog import CurationSort
from app.services.catalog_service import CURATION_SORT_SPECS, _encode_token
from tests.factories import active_curation

ACTOR_ID = "cms-admin-test"
SECRET = "catalog-test-secret"


def _headers() -> dict[str, str]:
    return {"X-CMS-Service-Key": settings.cms_service_key_value, "X-CMS-Actor-Id": ACTOR_ID}


def _seed_admin(database) -> None:
    database.users.insert_one(
        {"_id": ACTOR_ID, "email": f"{ACTOR_ID}@example.com", "authorized": True, "role": "admin"}
    )


def _sorted_rows() -> list[dict]:
    """Four Curations whose every sortable value differs, so no two published
    sort values can produce the same order by accident."""
    spec = (
        # id, sequence, updatedAt, createdAt, name
        ("seq-old", 1, datetime(2026, 9, 4, tzinfo=timezone.utc), datetime(2026, 1, 3, tzinfo=timezone.utc), "Zebra"),
        ("seq-mid", 2, datetime(2026, 9, 1, tzinfo=timezone.utc), datetime(2026, 1, 1, tzinfo=timezone.utc), "Mango"),
        ("seq-new", 3, datetime(2026, 9, 3, tzinfo=timezone.utc), datetime(2026, 1, 4, tzinfo=timezone.utc), "Alpha"),
        ("seq-late", 4, datetime(2026, 9, 2, tzinfo=timezone.utc), datetime(2026, 1, 2, tzinfo=timezone.utc), "Banana"),
    )
    return [
        active_curation(
            _id=curation_id,
            curation_id=curation_id,
            catalog_sequence=sequence,
            status="active",
            restaurant_name=name,
            updatedAt=updated_at,
            createdAt=created_at,
        )
        for curation_id, sequence, updated_at, created_at, name in spec
    ]


_SORT_EXPECTATIONS = {
    "sequence_asc": ["seq-old", "seq-mid", "seq-new", "seq-late"],
    "sequence_desc": ["seq-late", "seq-new", "seq-mid", "seq-old"],
    "updated_at_desc": ["seq-old", "seq-new", "seq-late", "seq-mid"],
    "updated_at_asc": ["seq-mid", "seq-late", "seq-new", "seq-old"],
    "created_at_desc": ["seq-new", "seq-old", "seq-late", "seq-mid"],
    "created_at_asc": ["seq-mid", "seq-late", "seq-old", "seq-new"],
    "name_asc": ["seq-new", "seq-late", "seq-mid", "seq-old"],
    "name_desc": ["seq-old", "seq-mid", "seq-late", "seq-new"],
}


def _concept_rows() -> list[dict]:
    """Concept fixtures chosen so a collapsed predicate would over-select:
    ``c-business`` satisfies one half of the repeated-category conditions."""
    return [
        active_curation(
            _id="c-mood",
            curation_id="c-mood",
            catalog_sequence=1,
            status="active",
            updatedAt=datetime(2026, 9, 1, tzinfo=timezone.utc),
            categories={"Mood": ["Casual", "Business"]},
        ),
        active_curation(
            _id="c-cuisine",
            curation_id="c-cuisine",
            catalog_sequence=2,
            status="active",
            updatedAt=datetime(2026, 9, 4, tzinfo=timezone.utc),
            categories={"Cuisine": ["Japanese"], "Mood": ["Date night"]},
        ),
        active_curation(
            _id="c-plain",
            curation_id="c-plain",
            catalog_sequence=3,
            status="active",
            updatedAt=datetime(2026, 9, 2, tzinfo=timezone.utc),
            categories={},
        ),
        active_curation(
            _id="c-business",
            curation_id="c-business",
            catalog_sequence=4,
            status="active",
            updatedAt=datetime(2026, 9, 3, tzinfo=timezone.utc),
            categories={"Mood": ["Business"]},
        ),
    ]


@pytest.mark.asyncio
async def test_search_is_allowlisted_and_uses_a_cursor_bound_to_filters(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    in_memory_db.users.insert_one(
        {"_id": "cms-admin-test", "email": "cms-admin-test@example.com", "authorized": True, "role": "admin"}
    )
    first = active_curation(curation_id="c1", catalog_sequence=1, restaurant_name="Sushi Jun", status="active")
    first["transcript"] = "private transcript"
    first["embeddings"] = [{"vector": [1, 2, 3]}]
    in_memory_db.curations.insert_one(first)
    in_memory_db.curations.insert_one(
        active_curation(curation_id="c2", catalog_sequence=2, restaurant_name="Sushi Zen", status="active")
    )
    in_memory_db.curations.insert_one(
        active_curation(curation_id="c3", catalog_sequence=3, restaurant_name="Pizza House", status="active")
    )

    page_one = await async_client.get("/api/v3/catalog/curations?q=sushi&limit=1", headers=_headers())
    assert page_one.status_code == 200
    assert [item["curation_id"] for item in page_one.json()["items"]] == ["c1"]
    assert "transcript" not in page_one.json()["items"][0]
    assert "embeddings" not in page_one.json()["items"][0]

    page_two = await async_client.get(
        f"/api/v3/catalog/curations?q=sushi&cursor={page_one.json()['next_cursor']}", headers=_headers()
    )
    assert [item["curation_id"] for item in page_two.json()["items"]] == ["c2"]
    mismatch = await async_client.get(
        f"/api/v3/catalog/curations?q=pizza&cursor={page_one.json()['next_cursor']}", headers=_headers()
    )
    assert mismatch.status_code == 409


def test_published_sort_allowlist_matches_the_query_specs():
    assert set(CURATION_SORT_SPECS) == set(get_args(CurationSort))


@pytest.mark.asyncio
@pytest.mark.parametrize("sort", sorted(_SORT_EXPECTATIONS))
async def test_every_sort_value_orders_the_fixture_set(sort, async_client, in_memory_db, monkeypatch):
    """Each published sort is exercised through the real keyset cursor: paging
    one row at a time must walk the whole set in the expected order."""
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _sorted_rows():
        in_memory_db.curations.insert_one(row)

    seen: list[str] = []
    cursor = None
    for _ in range(len(_SORT_EXPECTATIONS[sort])):
        query = f"/api/v3/catalog/curations?sort={sort}&limit=1"
        if cursor:
            query = f"{query}&cursor={cursor}"
        response = await async_client.get(query, headers=_headers())
        assert response.status_code == 200, response.text
        body = response.json()
        seen.extend(item["curation_id"] for item in body["items"])
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert seen == _SORT_EXPECTATIONS[sort]


@pytest.mark.asyncio
async def test_unknown_sort_value_is_a_validation_error(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)

    response = await async_client.get("/api/v3/catalog/curations?sort=updated_at", headers=_headers())

    assert response.status_code == 422
    assert any(error["loc"] == ["query", "sort"] for error in response.json()["detail"])


@pytest.mark.asyncio
async def test_cursor_minted_for_another_sort_is_refused(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _sorted_rows():
        in_memory_db.curations.insert_one(row)

    first = await async_client.get("/api/v3/catalog/curations?sort=updated_at_desc&limit=1", headers=_headers())
    cursor = first.json()["next_cursor"]
    assert cursor

    for other in ("sort=name_asc", "sort=sequence_desc", ""):
        mismatch = await async_client.get(
            f"/api/v3/catalog/curations?{other}{'&' if other else ''}cursor={cursor}", headers=_headers()
        )
        assert mismatch.status_code == 409, other


@pytest.mark.asyncio
async def test_default_cursor_still_accepts_a_token_minted_before_sort_existed(async_client, in_memory_db, monkeypatch):
    """The server default keeps today's ordering AND today's cursor payload: a
    token without a ``sort`` key is still a valid default listing cursor."""
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _sorted_rows():
        in_memory_db.curations.insert_one(row)

    legacy_token = _encode_token(
        {
            "kind": "catalog-search",
            "actor": ACTOR_ID,
            "filters": {},
            "exp": int((datetime.now(timezone.utc) + timedelta(minutes=5)).timestamp()),
            "sequence": 2,
            "curation_id": "seq-mid",
        },
        SECRET,
    )

    response = await async_client.get(f"/api/v3/catalog/curations?cursor={legacy_token}", headers=_headers())

    assert response.status_code == 200, response.text
    assert [item["curation_id"] for item in response.json()["items"]] == ["seq-new", "seq-late"]


@pytest.mark.asyncio
async def test_concept_filter_is_array_contains_and_ands_every_condition(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _concept_rows():
        in_memory_db.curations.insert_one(row)

    single = await async_client.get("/api/v3/catalog/curations?concept.Mood=Casual", headers=_headers())
    assert [item["curation_id"] for item in single.json()["items"]] == ["c-mood"]

    across_categories = await async_client.get(
        "/api/v3/catalog/curations?concept.Mood=Casual&concept.Cuisine=Japanese", headers=_headers()
    )
    assert across_categories.json()["items"] == []

    # Same category twice: both conditions must hold, so the single-condition
    # row (`c-business`) is not over-selected.
    repeated = await async_client.get(
        "/api/v3/catalog/curations?concept.Mood=Casual&concept.Mood=Business", headers=_headers()
    )
    assert [item["curation_id"] for item in repeated.json()["items"]] == ["c-mood"]

    unknown = await async_client.get("/api/v3/catalog/curations?concept.Unknown=Casual", headers=_headers())
    assert unknown.json()["items"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("category", ["Mood$where", "Mood.Business", "Mood\x00", "", "M" * 81])
async def test_unsafe_concept_category_is_refused(category, async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _concept_rows():
        in_memory_db.curations.insert_one(row)

    response = await async_client.get(
        "/api/v3/catalog/curations", params={f"concept.{category}": "Casual"}, headers=_headers()
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["query", f"concept.{category}"]


@pytest.mark.asyncio
async def test_concept_predicate_is_identical_for_the_list_and_the_scan(async_client, in_memory_db, monkeypatch):
    """A materialized all-matching selection can never diverge from the list."""
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _concept_rows():
        in_memory_db.curations.insert_one(row)

    listed = await async_client.get(
        "/api/v3/catalog/curations?concept.Mood=Casual&concept.Mood=Business", headers=_headers()
    )
    started = await async_client.post(
        "/api/v3/catalog/curations/scan/start",
        headers=_headers(),
        json={
            "filters": {
                "concepts": [
                    {"category": "Mood", "value": "Casual"},
                    {"category": "Mood", "value": "Business"},
                ]
            }
        },
    )
    assert started.status_code == 200, started.text
    scanned = await async_client.post(
        "/api/v3/catalog/curations/scan/page",
        headers=_headers(),
        json={"scan_token": started.json()["scan_token"], "limit": 100},
    )
    assert scanned.status_code == 200, scanned.text

    listed_ids = {item["curation_id"] for item in listed.json()["items"]}
    scanned_ids = {item["curation_id"] for item in scanned.json()["items"]}
    assert listed_ids == scanned_ids == {"c-mood"}


@pytest.mark.asyncio
async def test_list_and_scan_materialize_the_same_selection_in_the_same_order(async_client, in_memory_db, monkeypatch):
    """The bulk materialization must be the listing: same ids, same order."""
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _concept_rows():
        in_memory_db.curations.insert_one(row)

    listed = await async_client.get("/api/v3/catalog/curations?sort=updated_at_desc", headers=_headers())
    started = await async_client.post(
        "/api/v3/catalog/curations/scan/start", headers=_headers(), json={"filters": {"sort": "updated_at_desc"}}
    )
    scanned = await async_client.post(
        "/api/v3/catalog/curations/scan/page",
        headers=_headers(),
        json={"scan_token": started.json()["scan_token"], "limit": 100},
    )

    listed_order = [item["curation_id"] for item in listed.json()["items"]]
    assert listed_order == ["c-cuisine", "c-business", "c-plain", "c-mood"]
    assert listed_order == [item["curation_id"] for item in scanned.json()["items"]]


@pytest.mark.asyncio
async def test_scan_start_refuses_an_unsafe_concept_category(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)

    response = await async_client.post(
        "/api/v3/catalog/curations/scan/start",
        headers=_headers(),
        json={"filters": {"concepts": [{"category": "Mood$where", "value": "Casual"}]}},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_rows_serialize_naive_bson_datetimes_as_utc(async_client, in_memory_db, monkeypatch):
    """The driver hands BSON datetimes back naive.

    Serializing them as-is drops the offset, so every client parses the value
    as local time and the Admin renders "in 7 hours" for a record just updated.
    The stored value is UTC by definition; the response must say so.
    """
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    in_memory_db.curations.insert_one(
        active_curation(
            _id="c-naive",
            curation_id="c-naive",
            catalog_sequence=1,
            status="active",
            createdAt=datetime(2026, 7, 1, 12, 30),
            updatedAt=datetime(2026, 9, 11, 21, 45, 30, 500000),
        )
    )

    response = await async_client.get("/api/v3/catalog/curations?limit=5", headers=_headers())

    assert response.status_code == 200
    row = response.json()["items"][0]
    assert datetime.fromisoformat(row["updated_at"]).utcoffset() == timedelta(0)
    assert row["updated_at"].startswith("2026-09-11T21:45:30.500000")
    assert datetime.fromisoformat(row["created_at"]).utcoffset() == timedelta(0)


async def test_list_rows_carry_every_derived_editorial_column(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    in_memory_db.curations.insert_one(
        active_curation(
            _id="c-rich",
            curation_id="c-rich",
            catalog_sequence=1,
            status="active",
            curator={"id": "cur-1", "name": "Wagner Montes"},
            createdAt="2026-07-01T00:00:00Z",
            updatedAt="2026-09-11T00:00:00Z",
            categories={
                "Mood": ["Casual", "Business"],
                "Cuisine": ["Japanese", "Casual"],
                "Tag": list("ABCDEFGHIJK"),
            },
            sources={"image": [{"url": "a"}, {"url": "b"}], "audio": [{"url": "c"}], "google_places": {"id": "x"}},
            transcript="captured",
            version=7,
        )
    )
    in_memory_db.curations.insert_one(
        active_curation(_id="c-bare", curation_id="c-bare", catalog_sequence=2, status="active", transcript="")
    )
    in_memory_db.curations.insert_one(
        active_curation(
            _id="c-scalar-sources",
            curation_id="c-scalar-sources",
            catalog_sequence=3,
            status="active",
            sources={"image": {"url": "single"}},
        )
    )

    response = await async_client.get("/api/v3/catalog/curations", headers=_headers())

    assert response.status_code == 200, response.text
    rows = {item["curation_id"]: item for item in response.json()["items"]}

    rich = rows["c-rich"]
    assert rich["curator_name"] == "Wagner Montes"
    assert rich["created_at"] == "2026-07-01T00:00:00Z"
    assert rich["updated_at"] == "2026-09-11T00:00:00Z"
    assert rich["version"] == 7
    assert rich["source_count"] == 3
    assert rich["image_count"] == 2
    assert rich["audio_count"] == 1
    assert rich["has_transcript"] is True
    assert rich["concepts"] == ["Casual", "Business", "Japanese", "A", "B", "C", "D", "E", "F", "G", "H", "I"]

    bare = rows["c-bare"]
    assert bare["has_transcript"] is False, "empty transcript is not a transcript"
    assert bare["concepts"] is None, "no stored categories means 'unknown', never []"
    assert bare["source_count"] is None
    assert bare["image_count"] is None
    assert bare["audio_count"] is None
    assert bare["curator_name"] == "Test Curator"

    scalar = rows["c-scalar-sources"]
    assert scalar["source_count"] == 1
    assert scalar["image_count"] is None, "a non-list source group is 'unknown', never a derived count"


# ── Advanced field conditions (`where`) ──────────────────────────────────────


def _condition_rows() -> list[dict]:
    """Three Curations chosen so every published operator splits the set.

    ``transcript`` covers the three emptiness shapes (text, empty string,
    absent), ``sources.image`` the three image shapes (list, empty list,
    absent) and ``categories.Mood`` a full match, a partial match and none.
    The ``updatedAt`` values are naive UTC on purpose — that is how the driver
    hands BSON datetimes back, and ``before``/``after`` must still compare.
    """
    return [
        active_curation(
            _id="r-alpha",
            curation_id="r-alpha",
            catalog_sequence=1,
            status="active",
            restaurant_name="Alpha Grill",
            city="São Paulo",
            curator_type="human",
            entity_id="ent-1",
            curator={"id": "cur-1", "name": "Ana"},
            notes={"public": "Bright room", "private": "noisy"},
            transcript="Grilled sardines",
            version=1,
            createdAt=datetime(2026, 8, 1),
            updatedAt=datetime(2026, 9, 1),
            categories={"Mood": ["Casual", "Business"]},
            sources={"image": [{"url": "a"}], "audio": [{"url": "b"}]},
            metadata={"google_places": {"rating": 4.8}},
        ),
        active_curation(
            _id="r-beta",
            curation_id="r-beta",
            catalog_sequence=2,
            status="draft",
            restaurant_name="Beta Diner",
            city="Lisbon",
            curator_type="synthetic",
            entity_id="",
            curator={"id": "cur-2", "name": "Beto"},
            notes={"public": "", "private": "quiet"},
            transcript="",
            version=2,
            createdAt=datetime(2026, 8, 2),
            updatedAt=datetime(2026, 9, 10),
            categories={"Mood": ["Date night"]},
            sources={"image": []},
            metadata={},
        ),
        active_curation(
            _id="r-gamma",
            curation_id="r-gamma",
            catalog_sequence=3,
            status="linked",
            restaurant_name="Gamma Bistro",
            city="Lisbon",
            curator_type="human",
            entity_id="ent-2",
            curator={"id": "cur-3", "name": "Gabi"},
            notes={"public": "Terrace", "private": "hot"},
            version=3,
            createdAt=datetime(2026, 8, 3),
            updatedAt=datetime(2026, 9, 20),
            categories={},
            sources={"audio": [{"url": "c"}]},
            metadata={"source": "web"},
        ),
    ]


# Every published operator, against the fixture above. ``exists`` is presence
# (a stored empty string counts), which is why it differs from ``is_not_empty``.
_CONDITION_EXPECTATIONS = (
    ({"field": "status", "op": "equals", "value": "active"}, ["r-alpha"]),
    ({"field": "status", "op": "not_equals", "value": "active"}, ["r-beta", "r-gamma"]),
    ({"field": "restaurant_name", "op": "contains", "value": "GRILL"}, ["r-alpha"]),
    ({"field": "restaurant_name", "op": "not_contains", "value": "grill"}, ["r-beta", "r-gamma"]),
    ({"field": "restaurant_name", "op": "starts_with", "value": "gam"}, ["r-gamma"]),
    ({"field": "catalog_sequence", "op": "greater_than", "value": 2}, ["r-gamma"]),
    ({"field": "catalog_sequence", "op": "less_than", "value": 2}, ["r-alpha"]),
    ({"field": "transcript", "op": "exists"}, ["r-alpha", "r-beta"]),
    ({"field": "transcript", "op": "not_exists"}, ["r-gamma"]),
    ({"field": "transcript", "op": "is_empty"}, ["r-beta", "r-gamma"]),
    ({"field": "transcript", "op": "is_not_empty"}, ["r-alpha"]),
    ({"field": "notes.public", "op": "is_empty"}, ["r-beta"]),
    ({"field": "sources.image", "op": "is_empty"}, ["r-beta", "r-gamma"]),
    ({"field": "entity_id", "op": "is_empty"}, ["r-beta"]),
    ({"field": "curator.name", "op": "equals", "value": "Ana"}, ["r-alpha"]),
    ({"field": "updatedAt", "op": "before", "value": "2026-09-05T00:00:00Z"}, ["r-alpha"]),
    ({"field": "updatedAt", "op": "after", "value": "2026-09-05T00:00:00Z"}, ["r-beta", "r-gamma"]),
    ({"field": "categories.Mood", "op": "contains_any", "value": ["Casual", "Date night"]}, ["r-alpha", "r-beta"]),
    ({"field": "categories.Mood", "op": "contains_all", "value": ["Casual", "Business"]}, ["r-alpha"]),
    ({"field": "metadata.google_places.rating", "op": "greater_than", "value": 4.5}, ["r-alpha"]),
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "condition,expected",
    _CONDITION_EXPECTATIONS,
    ids=[f"{condition['op']}-{condition['field']}" for condition, _ in _CONDITION_EXPECTATIONS],
)
async def test_every_where_operator_selects_the_matching_rows(
    condition, expected, async_client, in_memory_db, monkeypatch
):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _condition_rows():
        in_memory_db.curations.insert_one(row)

    response = await async_client.get(
        "/api/v3/catalog/curations", params={"where": json.dumps(condition)}, headers=_headers()
    )

    assert response.status_code == 200, response.text
    assert sorted(item["curation_id"] for item in response.json()["items"]) == sorted(expected)


@pytest.mark.asyncio
async def test_where_conditions_are_anded_even_on_the_same_field(async_client, in_memory_db, monkeypatch):
    """Two conditions on one field must both hold — a merged dict key would
    silently drop one of them."""
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _condition_rows():
        in_memory_db.curations.insert_one(row)

    params = {
        "where": json.dumps({"field": "categories.Mood", "op": "contains", "value": "Casual"}),
        "limit": "100",
    }
    single = await async_client.get("/api/v3/catalog/curations", params=params, headers=_headers())
    assert [item["curation_id"] for item in single.json()["items"]] == ["r-alpha"]

    both = await async_client.get(
        "/api/v3/catalog/curations",
        params=[
            ("where", json.dumps({"field": "categories.Mood", "op": "contains", "value": "Casual"})),
            ("where", json.dumps({"field": "categories.Mood", "op": "contains", "value": "Business"})),
        ],
        headers=_headers(),
    )
    assert both.status_code == 200, both.text
    assert [item["curation_id"] for item in both.json()["items"]] == ["r-alpha"]

    impossible = await async_client.get(
        "/api/v3/catalog/curations",
        params=[
            ("where", json.dumps({"field": "city", "op": "equals", "value": "Lisbon"})),
            ("where", json.dumps({"field": "curator_type", "op": "equals", "value": "human"})),
        ],
        headers=_headers(),
    )
    assert [item["curation_id"] for item in impossible.json()["items"]] == ["r-gamma"]


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["nope", "categories.$where", "sources.a.b.c.d", "metadata.a.b.c", "curator"])
async def test_where_unknown_field_is_refused_and_named(field, async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)

    response = await async_client.get(
        "/api/v3/catalog/curations",
        params={"where": json.dumps({"field": field, "op": "equals", "value": "x"})},
        headers=_headers(),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["loc"] == ["query", "where"]
    assert field in detail[0]["msg"], detail


@pytest.mark.asyncio
async def test_where_unknown_operator_is_refused(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)

    response = await async_client.get(
        "/api/v3/catalog/curations",
        params={"where": json.dumps({"field": "status", "op": "matches", "value": "a"})},
        headers=_headers(),
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["query", "where"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "condition",
    [
        {"field": "transcript", "op": "contains", "value": 7},
        {"field": "categories.Mood", "op": "contains_any", "value": "Casual"},
        {"field": "categories.Mood", "op": "contains_all", "value": []},
        {"field": "updatedAt", "op": "before", "value": "yesterday"},
        {"field": "version", "op": "greater_than", "value": True},
        {"field": "status", "op": "equals", "value": "active", "extra": 1},
    ],
)
async def test_where_rejects_a_value_the_operator_cannot_use(condition, async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)

    response = await async_client.get(
        "/api/v3/catalog/curations", params={"where": json.dumps(condition)}, headers=_headers()
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["query", "where"]


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", ["{not json", '["a"]', ""])
async def test_where_rejects_a_value_that_is_not_a_json_object(raw, async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)

    response = await async_client.get("/api/v3/catalog/curations", params={"where": raw}, headers=_headers())

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["query", "where"]


@pytest.mark.asyncio
async def test_a_cursor_minted_with_where_is_refused_without_it(async_client, in_memory_db, monkeypatch):
    """``where`` is part of the signed filter payload: a cursor cannot be
    reinterpreted into a different selection."""
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    for row in _condition_rows():
        in_memory_db.curations.insert_one(row)

    page_one = await async_client.get(
        "/api/v3/catalog/curations",
        params={"where": json.dumps({"field": "city", "op": "equals", "value": "Lisbon"}), "limit": "1"},
        headers=_headers(),
    )
    cursor = page_one.json()["next_cursor"]
    assert cursor

    same = await async_client.get(
        "/api/v3/catalog/curations",
        params=[
            ("where", json.dumps({"field": "city", "op": "equals", "value": "Lisbon"})),
            ("limit", "1"),
            ("cursor", cursor),
        ],
        headers=_headers(),
    )
    assert same.status_code == 200, same.text
    assert [item["curation_id"] for item in same.json()["items"]] == ["r-gamma"]

    without_condition = await async_client.get(f"/api/v3/catalog/curations?limit=1&cursor={cursor}", headers=_headers())
    assert without_condition.status_code == 409


# ── unlinked (saved view) ────────────────────────────────────────────────────


def _unlinked_rows() -> list[dict]:
    return [
        active_curation(_id="u-linked", curation_id="u-linked", catalog_sequence=1, entity_id="ent-1"),
        active_curation(_id="u-absent", curation_id="u-absent", catalog_sequence=2, entity_id=None),
        active_curation(_id="u-empty", curation_id="u-empty", catalog_sequence=3, entity_id=""),
        active_curation(_id="u-blank", curation_id="u-blank", catalog_sequence=4, entity_id="   "),
    ]


@pytest.mark.asyncio
async def test_unlinked_filter_partitions_the_catalog(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    rows = _unlinked_rows()
    del rows[1]["entity_id"]  # the "absent key" shape, not just a null value
    for row in rows:
        in_memory_db.curations.insert_one(row)

    unlinked = await async_client.get("/api/v3/catalog/curations?unlinked=true", headers=_headers())
    linked = await async_client.get("/api/v3/catalog/curations?unlinked=false", headers=_headers())
    everything = await async_client.get("/api/v3/catalog/curations", headers=_headers())

    unlinked_ids = {item["curation_id"] for item in unlinked.json()["items"]}
    linked_ids = {item["curation_id"] for item in linked.json()["items"]}
    assert unlinked_ids == {"u-absent", "u-empty", "u-blank"}
    assert linked_ids == {"u-linked"}
    assert unlinked_ids | linked_ids == {item["curation_id"] for item in everything.json()["items"]}
    assert unlinked_ids & linked_ids == set()


@pytest.mark.asyncio
async def test_is_empty_matches_missing_null_and_empty_array(async_client, in_memory_db, monkeypatch):
    """``is_empty`` is the four shapes an editor cannot distinguish from a
    value that is simply not there: missing, null, empty string, empty array."""
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", SECRET)
    _seed_admin(in_memory_db)
    in_memory_db.curations.insert_one(
        active_curation(_id="e-missing", curation_id="e-missing", catalog_sequence=1, sources={})
    )
    in_memory_db.curations.insert_one(
        active_curation(
            _id="e-null", curation_id="e-null", catalog_sequence=2, transcript=None, sources={"image": None}
        )
    )
    in_memory_db.curations.insert_one(
        active_curation(
            _id="e-empty-string",
            curation_id="e-empty-string",
            catalog_sequence=3,
            transcript="",
            sources={"image": []},
        )
    )
    in_memory_db.curations.insert_one(
        active_curation(
            _id="e-present",
            curation_id="e-present",
            catalog_sequence=4,
            transcript="captured",
            sources={"image": [{"url": "a"}]},
        )
    )

    for condition, expected in (
        ({"field": "transcript", "op": "is_empty"}, ["e-empty-string", "e-missing", "e-null"]),
        ({"field": "sources.image", "op": "is_empty"}, ["e-empty-string", "e-missing", "e-null"]),
        ({"field": "transcript", "op": "is_not_empty"}, ["e-present"]),
    ):
        response = await async_client.get(
            "/api/v3/catalog/curations", params={"where": json.dumps(condition)}, headers=_headers()
        )
        assert response.status_code == 200, response.text
        assert sorted(item["curation_id"] for item in response.json()["items"]) == expected, condition
