from datetime import datetime, timezone


def test_manual_authz_change_accepts_legacy_user_missing_authz_fields(in_memory_db):
    """Raw legacy rows may rely on model defaults without persisted fields."""
    from app.core.authz_audit import apply_user_authz_change

    in_memory_db._collections.clear()
    email = "legacy-authz@example.test"
    in_memory_db.users.insert_one(
        {
            "_id": "legacy-user-authz",
            "email": email,
            "google_id": "google-legacy-authz",
            "name": "Legacy User",
            # Deliberately omit `authorized` and `role`. The User model has
            # historically interpreted those as False / curator.
            "created_at": datetime.now(timezone.utc),
            "last_login": datetime.now(timezone.utc),
            "refresh_token": None,
        }
    )

    changed = apply_user_authz_change(
        in_memory_db,
        email=email,
        authorized=True,
        role="admin",
        actor_id="cli:wagner",
        source="authorize_user",
        request_id="req-legacy-authz",
    )

    assert changed["authorized"] is True
    assert changed["role"] == "admin"
    stored = in_memory_db.users.find_one({"email": email})
    assert stored is not None
    assert stored["authorized"] is True
    assert stored["role"] == "admin"

    event = in_memory_db.user_authz_audit_events.find_one({"targetEmail": email})
    assert event is not None
    assert event["before"] == {"authorized": False, "role": "curator"}
    assert event["after"] == {"authorized": True, "role": "admin"}
    assert event["requestId"] == "req-legacy-authz"
