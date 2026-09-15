"""Curator directory read for the CMS curator picker.

The Curation curator field used to be display-only because no route listed the
directory. These tests pin the guarantees the picker depends on: a searched and
bounded page of the three values it renders, and the same service-credential +
live-admin-actor boundary as every other ``/catalog/*`` read.
"""

import pytest

from app.core.config import settings

PATH = "/api/v3/catalog/curators"
ACTOR_ID = "cms-admin-test"


def _headers(actor: str | None = ACTOR_ID) -> dict[str, str]:
    headers = {"X-CMS-Service-Key": settings.cms_service_key_value}
    if actor is not None:
        headers["X-CMS-Actor-Id"] = actor
    return headers


def _seed_cms_admin(db) -> None:
    db.users.insert_one({"_id": ACTOR_ID, "email": f"{ACTOR_ID}@example.com", "authorized": True, "role": "admin"})


def _seed_curators(db, rows: list[dict]) -> None:
    for row in rows:
        db.curators.insert_one(row)


def _curator(curator_id: str, name: str, email: str | None = None) -> dict:
    return {"curator_id": curator_id, "name": name, "email": email or curator_id, "picture": "https://cdn/x.png"}


@pytest.mark.asyncio
async def test_searches_by_name_or_email_and_orders_by_name(async_client, in_memory_db):
    """`q` matches both handles a person types; the page is ordered by name and
    carries only the identity and the two rendered values — never the picture
    or any other field the collection stores."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_curators(
        in_memory_db,
        [
            _curator("wagner@example.com", "Wagner Montes"),
            _curator("ana@example.com", "Ana Beatriz"),
            _curator("zoe@example.com", "Zoe Carter"),
        ],
    )

    by_name = await async_client.get(PATH, params={"q": "zoe"}, headers=_headers())
    assert by_name.status_code == 200, by_name.text
    assert by_name.json() == {
        "items": [{"curator_id": "zoe@example.com", "name": "Zoe Carter", "email": "zoe@example.com"}],
        "next_cursor": None,
    }

    by_email = await async_client.get(PATH, params={"q": "ANA@"}, headers=_headers())
    assert by_email.status_code == 200
    assert [item["curator_id"] for item in by_email.json()["items"]] == ["ana@example.com"]

    everything = await async_client.get(PATH, headers=_headers())
    assert everything.status_code == 200
    assert [item["name"] for item in everything.json()["items"]] == ["Ana Beatriz", "Wagner Montes", "Zoe Carter"]
    assert all(set(item) == {"curator_id", "name", "email"} for item in everything.json()["items"])


@pytest.mark.asyncio
async def test_search_text_is_not_a_pattern_and_the_page_is_bounded(async_client, in_memory_db):
    """A typed query is text: a regex metacharacter matches itself instead of
    every curator, and the page never grows past the ceiling it publishes."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_curators(
        in_memory_db,
        [_curator(f"curator-{index}@example.com", f"Curator {index:02d}") for index in range(60)],
    )

    literal = await async_client.get(PATH, params={"q": "curator-.*"}, headers=_headers())
    assert literal.status_code == 200
    assert literal.json()["items"] == []

    bounded = await async_client.get(PATH, params={"q": "curator-", "limit": 3}, headers=_headers())
    assert bounded.status_code == 200
    assert [item["name"] for item in bounded.json()["items"]] == ["Curator 00", "Curator 01", "Curator 02"]

    over_ceiling = await async_client.get(PATH, params={"limit": 51}, headers=_headers())
    assert over_ceiling.status_code == 422


@pytest.mark.asyncio
async def test_no_match_returns_an_empty_page(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    _seed_curators(in_memory_db, [_curator("ana@example.com", "Ana Beatriz")])

    response = await async_client.get(PATH, params={"q": "nobody"}, headers=_headers())

    assert response.status_code == 200, response.text
    assert response.json() == {"items": [], "next_cursor": None}


@pytest.mark.asyncio
async def test_requires_the_service_credential_and_a_live_admin_actor(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_curators(in_memory_db, [_curator("ana@example.com", "Ana Beatriz")])
    in_memory_db.users.insert_one(
        {"_id": "curator-1", "email": "curator-1@example.com", "authorized": True, "role": "curator"}
    )

    no_actor = await async_client.get(PATH, headers=_headers(actor=None))
    assert no_actor.status_code == 401
    assert no_actor.json()["detail"] == "CMS actor is required"

    bad_key = await async_client.get(PATH, headers={"X-CMS-Service-Key": "not-the-cms-key", "X-CMS-Actor-Id": ACTOR_ID})
    assert bad_key.status_code == 401
    assert bad_key.json()["detail"] == "Invalid CMS service credential"

    unknown_actor = await async_client.get(PATH, headers=_headers(actor="ghost"))
    assert unknown_actor.status_code == 401
    assert unknown_actor.json()["detail"] == "CMS actor was not found"

    unprivileged = await async_client.get(PATH, headers=_headers(actor="curator-1"))
    assert unprivileged.status_code == 403
    assert unprivileged.json()["detail"] == "CMS admin access is required"
