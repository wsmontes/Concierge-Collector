"""Regressions for authentication hardening follow-up."""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException


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
