from datetime import datetime, timezone


def _seed(db, *, email="audit-admin@example.test", authorized=False, role="curator"):
    db.users.delete_many({"email": email})
    db.user_authz_audit_events.delete_many({"targetEmail": email})
    db.users.insert_one(
        {
            "_id": f"user-{email}",
            "email": email,
            "google_id": f"google-{email}",
            "name": "Audit User",
            "authorized": authorized,
            "role": role,
            "created_at": datetime.now(timezone.utc),
            "last_login": datetime.now(timezone.utc),
            "refresh_token": None,
        }
    )
    return email


def test_manual_authorization_change_is_persistently_audited(in_memory_db):
    from app.core.authz_audit import apply_user_authz_change

    in_memory_db._collections.clear()
    email = _seed(in_memory_db)

    changed = apply_user_authz_change(
        in_memory_db,
        email=email,
        authorized=True,
        role="admin",
        actor_id="cli:wagner",
        source="authorize_user",
        request_id="req-cli-1",
    )

    assert changed["authorized"] is True
    assert changed["role"] == "admin"
    events = list(in_memory_db.user_authz_audit_events.find({"targetEmail": email}))
    assert len(events) == 1
    event = events[0]
    assert event["source"] == "authorize_user"
    assert event["actorId"] == "cli:wagner"
    assert event["before"] == {"authorized": False, "role": "curator"}
    assert event["after"] == {"authorized": True, "role": "admin"}
    assert event["requestId"] == "req-cli-1"
    assert "token" not in str(event).lower()
    assert "secret" not in str(event).lower()


def test_manual_revoke_is_persistently_audited(in_memory_db):
    from app.core.authz_audit import apply_user_authz_change

    in_memory_db._collections.clear()
    email = _seed(in_memory_db, authorized=True, role="admin")

    changed = apply_user_authz_change(
        in_memory_db,
        email=email,
        authorized=False,
        role=None,
        actor_id="cli:wagner",
        source="authorize_user",
        request_id="req-cli-revoke",
    )

    assert changed["authorized"] is False
    assert changed["role"] == "admin"
    event = in_memory_db.user_authz_audit_events.find_one({"targetEmail": email})
    assert event is not None
    assert event["before"] == {"authorized": True, "role": "admin"}
    assert event["after"] == {"authorized": False, "role": "admin"}
    assert event["requestId"] == "req-cli-revoke"


def test_repeating_same_request_is_idempotent_and_noop_change_adds_no_event(in_memory_db):
    from app.core.authz_audit import append_authz_change, apply_user_authz_change

    in_memory_db._collections.clear()
    email = _seed(in_memory_db)
    before = {"authorized": False, "role": "curator"}
    after = {"authorized": True, "role": "admin"}

    first = append_authz_change(
        in_memory_db,
        actor_id="cli:wagner",
        target_user_id=f"user-{email}",
        target_email=email,
        before=before,
        after=after,
        source="authorize_user",
        request_id="req-same",
    )
    second = append_authz_change(
        in_memory_db,
        actor_id="cli:wagner",
        target_user_id=f"user-{email}",
        target_email=email,
        before=before,
        after=after,
        source="authorize_user",
        request_id="req-same",
    )
    assert first == second
    assert in_memory_db.user_authz_audit_events.count_documents({"eventKey": first}) == 1

    apply_user_authz_change(
        in_memory_db,
        email=email,
        authorized=False,
        role="curator",
        actor_id="cli:wagner",
        source="authorize_user",
        request_id="req-noop",
    )
    assert in_memory_db.user_authz_audit_events.count_documents({}) == 1


def test_oauth_allowlist_promotion_writes_same_audit_stream(in_memory_db, monkeypatch):
    from app.api.auth import create_or_update_user
    from app.core.config import settings

    in_memory_db._collections.clear()
    email = _seed(in_memory_db, email="configured-admin@example.test")
    monkeypatch.setattr(settings, "admin_emails", email)

    create_or_update_user(
        in_memory_db,
        {
            "email": email,
            "google_id": f"google-{email}",
            "name": "Configured Admin",
            "picture": None,
        },
    )

    event = in_memory_db.user_authz_audit_events.find_one({"targetEmail": email})
    assert event is not None
    assert event["source"] == "oauth_allowlist"
    assert event["before"] == {"authorized": False, "role": "curator"}
    assert event["after"] == {"authorized": True, "role": "admin"}


def test_first_login_allowlisted_admin_grant_is_audited(in_memory_db, monkeypatch):
    from app.api.auth import create_or_update_user
    from app.core.config import settings

    in_memory_db._collections.clear()
    email = "first-login-admin@example.test"
    monkeypatch.setattr(settings, "admin_emails", email)

    user = create_or_update_user(
        in_memory_db,
        {
            "email": email,
            "google_id": f"google-{email}",
            "name": "First Login Admin",
            "picture": None,
        },
    )

    assert user.authorized is True
    assert user.role == "admin"
    event = in_memory_db.user_authz_audit_events.find_one({"targetEmail": email})
    assert event is not None
    assert event["source"] == "oauth_allowlist"
    assert event["before"] == {"authorized": None, "role": None}
    assert event["after"] == {"authorized": True, "role": "admin"}


def test_read_only_cms_introspection_does_not_create_authz_mutation_event(client, in_memory_db, monkeypatch):
    from app.core.config import settings

    in_memory_db._collections.clear()
    email = _seed(in_memory_db, authorized=True, role="admin")
    monkeypatch.setattr(settings, "cms_service_key", "test-cms-key")

    response = client.post(
        "/api/v3/auth/cms/introspect",
        headers={"X-CMS-Service-Key": "test-cms-key", "X-CMS-Actor-Id": email},
        json={"subject": email},
    )

    assert response.status_code in {200, 403}
    assert in_memory_db.user_authz_audit_events.count_documents({}) == 0


def test_authz_audit_indexes_are_versioned_in_single_index_source():
    from app.core.index_specs import INDEX_SPECS

    specs = [entry for entry in INDEX_SPECS if entry[0] == "user_authz_audit_events"]
    assert (
        "user_authz_audit_events",
        [("eventKey", 1)],
        {"unique": True, "name": "user_authz_event_key_unique"},
    ) in specs
    assert (
        "user_authz_audit_events",
        [("createdAt", 1), ("_id", 1)],
        {"name": "user_authz_archive_scan"},
    ) in specs
