"""Regressions for authentication hardening follow-up."""

from unittest.mock import patch


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
