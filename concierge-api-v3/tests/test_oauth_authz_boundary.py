from datetime import datetime, timezone


def test_existing_allowlisted_user_uses_shared_cas_audit_writer(in_memory_db, monkeypatch):
    import app.api.auth as auth_module
    from app.core.config import settings

    in_memory_db._collections.clear()
    email = "oauth-shared-writer@example.test"
    in_memory_db.users.insert_one(
        {
            "_id": "oauth-shared-writer-user",
            "email": email,
            "google_id": "google-oauth-shared-writer",
            "name": "Before",
            "picture": None,
            "authorized": False,
            "role": "curator",
            "created_at": datetime.now(timezone.utc),
            "last_login": datetime.now(timezone.utc),
            "refresh_token": None,
        }
    )
    monkeypatch.setattr(settings, "admin_emails", email)

    calls = []

    def shared_writer(db, **kwargs):
        calls.append(kwargs)
        db.users.update_one(
            {"email": kwargs["email"]},
            {"$set": {"authorized": kwargs["authorized"], "role": kwargs["role"]}},
        )
        return db.users.find_one({"email": kwargs["email"]})

    monkeypatch.setattr(auth_module, "apply_user_authz_change", shared_writer, raising=False)

    user = auth_module.create_or_update_user(
        in_memory_db,
        {
            "email": email,
            "google_id": "google-oauth-shared-writer",
            "name": "After",
            "picture": "https://example.test/admin.png",
        },
    )

    assert len(calls) == 1
    assert calls[0]["email"] == email
    assert calls[0]["authorized"] is True
    assert calls[0]["role"] == "admin"
    assert calls[0]["actor_id"] == "system:oauth_allowlist"
    assert calls[0]["source"] == "oauth_allowlist"
    assert user.authorized is True
    assert user.role == "admin"


def test_non_allowlisted_login_does_not_invoke_authz_mutation_writer(in_memory_db, monkeypatch):
    import app.api.auth as auth_module
    from app.core.config import settings

    in_memory_db._collections.clear()
    email = "oauth-curator@example.test"
    in_memory_db.users.insert_one(
        {
            "_id": "oauth-curator-user",
            "email": email,
            "google_id": "google-oauth-curator",
            "name": "Before",
            "picture": None,
            "authorized": True,
            "role": "curator",
            "created_at": datetime.now(timezone.utc),
            "last_login": datetime.now(timezone.utc),
            "refresh_token": None,
        }
    )
    monkeypatch.setattr(settings, "admin_emails", "someone-else@example.test")

    called = False

    def forbidden_writer(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("authz writer must not run for profile-only login")

    monkeypatch.setattr(auth_module, "apply_user_authz_change", forbidden_writer, raising=False)

    user = auth_module.create_or_update_user(
        in_memory_db,
        {
            "email": email,
            "google_id": "google-oauth-curator",
            "name": "After",
            "picture": None,
        },
    )

    assert called is False
    assert user.authorized is True
    assert user.role == "curator"
