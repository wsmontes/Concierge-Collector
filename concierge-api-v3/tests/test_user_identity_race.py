"""User identity creation must be idempotent under concurrent OAuth callbacks."""

from unittest.mock import patch

from pymongo.errors import DuplicateKeyError


def test_user_id_is_stable_and_scoped_to_google_subject():
    from app.api.auth import _user_id_for_google_id

    first = _user_id_for_google_id("google-subject-a")
    retry = _user_id_for_google_id("google-subject-a")
    other = _user_id_for_google_id("google-subject-b")

    assert first.startswith("usr_")
    assert first == retry
    assert first != other
    assert "google-subject-a" not in first


def test_first_login_duplicate_key_race_reuses_winner(in_memory_db):
    """Two first-login callbacks for one Google subject must produce one user."""
    from app.api.auth import create_or_update_user, _user_id_for_google_id

    google_id = "race-google-subject"
    email = "race-user@example.com"
    in_memory_db.users.delete_many({"google_id": google_id})
    original_insert = in_memory_db.users.insert_one

    def winner_inserts_then_loser_gets_duplicate(doc):
        original_insert(dict(doc))
        raise DuplicateKeyError("simulated concurrent winner")

    with patch.object(
        in_memory_db.users,
        "insert_one",
        side_effect=winner_inserts_then_loser_gets_duplicate,
    ):
        user = create_or_update_user(
            in_memory_db,
            {
                "email": email,
                "google_id": google_id,
                "name": "Race User",
                "picture": None,
            },
        )

    stored = list(in_memory_db.users.find({"google_id": google_id}))
    assert len(stored) == 1
    assert stored[0]["_id"] == _user_id_for_google_id(google_id)
    assert user.email == email
    assert user.google_id == google_id
