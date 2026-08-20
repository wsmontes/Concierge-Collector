"""Regressions for authentication hardening follow-up."""

from datetime import datetime, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException
from jose import jwt


def test_production_callback_origins_do_not_inherit_development_frontend():
    """Production must not trust the localhost default via FRONTEND_URL."""
    from app.core.config import settings

    production_frontend = "https://collector.example.com"
    explicit_origin = "https://preview.example.com"
    with (
        patch.object(settings, "environment", "production"),
        patch.object(settings, "frontend_url", "http://127.0.0.1:5500"),
        patch.object(settings, "frontend_url_production", production_frontend),
        patch.object(settings, "trusted_callback_origins", f'["{explicit_origin}"]'),
    ):
        origins = settings.trusted_callback_origins_list

    assert "http://127.0.0.1:5500" not in origins
    assert production_frontend in origins
    assert explicit_origin in origins


def test_development_callback_origins_include_configured_development_frontend():
    from app.core.config import settings

    development_frontend = "http://127.0.0.1:5500"
    with (
        patch.object(settings, "environment", "development"),
        patch.object(settings, "frontend_url", development_frontend),
        patch.object(settings, "frontend_url_production", "https://collector.example.com"),
        patch.object(settings, "trusted_callback_origins", "[]"),
    ):
        origins = settings.trusted_callback_origins_list

    assert development_frontend in origins


def test_oauth_state_is_opaque_and_pkce_verifier_stays_server_side(in_memory_db):
    from app.services.oauth_state_service import issue_oauth_state

    in_memory_db.oauth_login_states.delete_many({})
    state, browser_binding = issue_oauth_state(
        in_memory_db,
        code_verifier="server-only-pkce-verifier",
        frontend_url="https://collector.example.com",
        now=datetime.now(timezone.utc),
    )

    stored = in_memory_db.oauth_login_states.find_one({})
    assert stored is not None
    assert state not in str(stored)
    assert browser_binding not in str(stored)
    assert stored["code_verifier"] == "server-only-pkce-verifier"
    assert stored["frontend_url"] == "https://collector.example.com"
    assert stored["state_hash"]
    assert stored["browser_binding_hash"]


def test_oauth_state_requires_browser_binding_and_is_one_shot(in_memory_db):
    from app.services.oauth_state_service import consume_oauth_state, issue_oauth_state

    in_memory_db.oauth_login_states.delete_many({})
    now = datetime.now(timezone.utc)
    state, browser_binding = issue_oauth_state(
        in_memory_db,
        code_verifier="pkce-verifier",
        frontend_url="https://collector.example.com",
        now=now,
    )

    with pytest.raises(HTTPException) as wrong_browser:
        consume_oauth_state(in_memory_db, state=state, browser_binding="attacker-binding", now=now)
    assert wrong_browser.value.status_code == 400

    consumed = consume_oauth_state(
        in_memory_db,
        state=state,
        browser_binding=browser_binding,
        now=now,
    )
    assert consumed["code_verifier"] == "pkce-verifier"
    assert consumed["frontend_url"] == "https://collector.example.com"

    with pytest.raises(HTTPException) as replay:
        consume_oauth_state(
            in_memory_db,
            state=state,
            browser_binding=browser_binding,
            now=now,
        )
    assert replay.value.status_code == 400


def test_oauth_init_sets_binding_cookie_and_state_excludes_pkce(client, in_memory_db):
    """The HTTP authorization URL must expose no PKCE verifier."""
    from app.core.config import settings
    from app.core.security import ALGORITHM, get_jwt_secret

    in_memory_db.oauth_login_states.delete_many({})
    trusted = "http://127.0.0.1:5500"
    with (
        patch.object(settings, "environment", "development"),
        patch.object(settings, "frontend_url", trusted),
        patch.object(settings, "trusted_callback_origins", "[]"),
        patch.object(settings, "google_oauth_client_id", "test-google-client"),
        patch.object(settings, "google_oauth_redirect_uri", "http://localhost:8000/api/v3/auth/callback"),
    ):
        response = client.get(
            f"/api/v3/auth/google?callback_url={trusted}",
            follow_redirects=False,
        )

    assert response.status_code == 307
    location = response.headers["location"]
    state = parse_qs(urlparse(location).query)["state"][0]
    state_payload = jwt.decode(state, get_jwt_secret(), algorithms=[ALGORITHM])
    stored = in_memory_db.oauth_login_states.find_one({})

    assert stored is not None
    assert state_payload["sd"] == trusted
    assert stored["code_verifier"] not in state
    assert "code_verifier" not in state_payload
    assert "oauth_state_binding=" in response.headers.get("set-cookie", "")
    assert "HttpOnly" in response.headers.get("set-cookie", "")


def test_oauth_callback_rejects_valid_state_without_browser_binding_before_google(client, in_memory_db):
    """A stolen state URL alone is insufficient to complete the login."""
    from app.core.config import settings
    from app.services.oauth_state_service import issue_oauth_state

    in_memory_db.oauth_login_states.delete_many({})
    state, _browser_binding = issue_oauth_state(
        in_memory_db,
        code_verifier="server-verifier",
        frontend_url="http://127.0.0.1:5500",
        now=datetime.now(timezone.utc),
    )
    client.cookies.clear()

    with (
        patch.object(settings, "google_oauth_client_id", "test-google-client"),
        patch.object(settings, "google_oauth_client_secret", "test-google-secret"),
        patch("app.api.auth.httpx.Client") as google_client,
    ):
        response = client.get(
            f"/api/v3/auth/callback?code=stolen-code&state={state}",
            follow_redirects=False,
        )

    assert response.status_code == 400
    google_client.assert_not_called()


def test_existing_google_refresh_token_is_cleared_on_next_login(in_memory_db):
    """Legacy plaintext Google credentials must not survive a later login."""
    from app.api.auth import create_or_update_user

    email = "legacy-google-token@example.com"
    google_id = "legacy-google-id"
    in_memory_db.users.delete_many({"google_id": google_id})
    in_memory_db.users.insert_one(
        {
            "_id": "legacy-google-user",
            "email": email,
            "google_id": google_id,
            "name": "Legacy User",
            "picture": None,
            "authorized": True,
            "role": "curator",
            "created_at": datetime.now(timezone.utc),
            "last_login": datetime.now(timezone.utc),
            "refresh_token": "plaintext-google-refresh-secret",
        }
    )

    create_or_update_user(
        in_memory_db,
        {
            "email": email,
            "google_id": google_id,
            "name": "Legacy User Updated",
            "picture": None,
            "refresh_token": "new-google-secret-that-must-be-ignored",
        },
    )

    stored = in_memory_db.users.find_one({"google_id": google_id})
    assert stored["refresh_token"] is None
