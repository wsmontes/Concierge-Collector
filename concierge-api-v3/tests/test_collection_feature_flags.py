import pytest
from fastapi import HTTPException

from app.core.feature_flags import enabled, require_collection_flag


def test_flags_default_on_outside_staging_and_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "testing")
    monkeypatch.delenv("COLLECTIONS_DISTRIBUTION_ENABLED", raising=False)
    assert enabled("collections_distribution") is True


def test_flags_fail_closed_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("COLLECTIONS_DISTRIBUTION_ENABLED", raising=False)
    assert enabled("collections_distribution") is False
    with pytest.raises(HTTPException) as error:
        require_collection_flag("collections_distribution")
    assert error.value.status_code == 503
    assert error.value.detail == {"code": "feature_disabled", "flag": "collections_distribution"}


def test_explicit_override_is_validated(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("COLLECTIONS_DISTRIBUTION_ENABLED", "true")
    assert enabled("collections_distribution") is True
    monkeypatch.setenv("COLLECTIONS_DISTRIBUTION_ENABLED", "maybe")
    with pytest.raises(RuntimeError, match="must be true or false"):
        enabled("collections_distribution")
