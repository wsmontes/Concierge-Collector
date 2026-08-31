"""Server-side feature flags for the staged Collections rollout.

Staging/production fail closed when an override is absent. Development and test
stay enabled by default so existing local workflows are not silently disabled.
The versioned ownership/removal metadata lives in config/collections-feature-flags.json.
"""

from __future__ import annotations

import os
from collections.abc import Callable

from fastapi import HTTPException, status

_FLAG_ENVS = {
    "cms_auth": "CMS_AUTH_ENABLED",
    "catalog_scan": "CATALOG_SCAN_ENABLED",
    "collections_admin": "COLLECTIONS_ADMIN_ENABLED",
    "collector_association_read": "COLLECTOR_ASSOCIATION_READ_ENABLED",
    "collector_draft_mutation": "COLLECTOR_DRAFT_MUTATION_ENABLED",
    "consumer_credentials": "CONSUMER_CREDENTIALS_ENABLED",
    "collections_distribution": "COLLECTIONS_DISTRIBUTION_ENABLED",
}


def _environment() -> str:
    return os.getenv("ENVIRONMENT", "development").strip().lower()


def enabled(name: str) -> bool:
    try:
        env_name = _FLAG_ENVS[name]
    except KeyError as exc:
        raise RuntimeError(f"Unknown Collections feature flag: {name}") from exc

    raw = os.getenv(env_name)
    if raw is None or not raw.strip():
        return _environment() not in {"staging", "production"}

    normalized = raw.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise RuntimeError(f"{env_name} must be true or false")


def require_collection_flag(name: str) -> None:
    if not enabled(name):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "feature_disabled", "flag": name},
        )


def collection_flag_dependency(name: str) -> Callable[[], None]:
    def dependency() -> None:
        require_collection_flag(name)

    return dependency
