#!/usr/bin/env python3
"""Export the intentionally small FastAPI contract consumed by the CMS.

The public application schema is much broader than the Admin/CMS boundary.
This exporter is the single place that narrows it to endpoints the CMS is
allowed to call, while preserving only schemas reachable from those endpoints.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = API_ROOT.parent
CONTRACT_PATH = REPOSITORY_ROOT / "contracts/openapi/fastapi-admin-internal.v1.json"

# Prefixes remain deliberately narrow. New API routes do not enter the CMS
# contract simply because they happen to be part of the main FastAPI app.
ALLOWED_PATH_PREFIXES = (
    "/api/v3/auth/cms/",
    "/api/v3/catalog/",
)
ALLOWED_PATHS = {
    "/api/v3/internal/curations/hydrate",
    "/api/v3/curations/{curation_id}/collections",
}

# ``verify_auth`` supports administrative API keys for other operational
# routes, but the CMS handoff explicitly rejects them: it requires a human
# JWT/cookie session. Keep the published boundary accurate rather than
# leaking the broader implementation dependency into this contract.
HUMAN_SESSION_SECURITY = [{"HTTPBearer": []}, {"FastApiAccessCookie": []}]
CMS_SERVICE_SECURITY = [{"CmsServiceKey": []}]
COLLECTOR_BEARER_SECURITY = [
    {"HTTPBearer": [], "CmsServiceKey": []},
    {"FastApiAccessCookie": [], "CmsServiceKey": []},
]
CMS_SECURITY_SCHEMES = {
    "CmsServiceKey": {"type": "apiKey", "in": "header", "name": "X-CMS-Service-Key"},
    "FastApiAccessCookie": {"type": "apiKey", "in": "cookie", "name": "access_token"},
}


def is_allowed_path(path: str) -> bool:
    return path in ALLOWED_PATHS or path.startswith(ALLOWED_PATH_PREFIXES)


def find_schema_references(value: Any) -> set[str]:
    """Return local ``#/components/schemas/*`` references in a JSON value."""
    references: set[str] = set()
    if isinstance(value, dict):
        reference = value.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/components/schemas/"):
            references.add(reference.rsplit("/", 1)[1])
        for child in value.values():
            references.update(find_schema_references(child))
    elif isinstance(value, list):
        for child in value:
            references.update(find_schema_references(child))
    return references


def reachable_schemas(paths: dict[str, Any], schemas: dict[str, Any]) -> dict[str, Any]:
    """Keep only schemas referenced by a selected path or another schema."""
    pending = list(find_schema_references(paths))
    selected: dict[str, Any] = {}

    while pending:
        name = pending.pop()
        if name in selected:
            continue
        schema = schemas.get(name)
        if schema is None:
            raise ValueError(f"OpenAPI schema reference not found: {name}")
        selected[name] = schema
        pending.extend(find_schema_references(schema))

    return selected


def reachable_security_schemes(paths: dict[str, Any], schemes: dict[str, Any]) -> dict[str, Any]:
    """Keep security schemes named by selected operations."""
    selected_names: set[str] = set()

    def collect(value: Any) -> None:
        if isinstance(value, dict):
            security = value.get("security")
            if isinstance(security, list):
                for requirement in security:
                    if isinstance(requirement, dict):
                        selected_names.update(requirement)
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    collect(paths)
    return {name: schemes[name] for name in selected_names if name in schemes}


def normalize_selected_operations(paths: dict[str, Any]) -> dict[str, Any]:
    """Copy selected paths and correct security semantics at the CMS boundary."""
    normalized = json.loads(json.dumps(paths))
    authorize = normalized.get("/api/v3/auth/cms/authorize", {}).get("get")
    if authorize is not None:
        authorize["security"] = HUMAN_SESSION_SECURITY
    associations = normalized.get("/api/v3/curations/{curation_id}/collections", {}).get("get")
    if associations is not None:
        associations["security"] = HUMAN_SESSION_SECURITY
    for path in (
        "/api/v3/auth/cms/exchange",
        "/api/v3/auth/cms/introspect",
        "/api/v3/catalog/curations/resolve",
        "/api/v3/internal/curations/hydrate",
    ):
        operation = normalized.get(path, {}).get("post")
        if operation is None:
            continue
        operation["security"] = CMS_SERVICE_SECURITY
        # The generated optional Header parameter reflects FastAPI's typing,
        # while the dependency rejects a missing header. The OpenAPI security
        # scheme is the authoritative representation for this boundary.
        operation["parameters"] = [
            parameter for parameter in operation.get("parameters", []) if parameter.get("name") != "X-CMS-Service-Key"
        ]
        for parameter in operation["parameters"]:
            if parameter.get("name") == "X-CMS-Actor-Id":
                parameter["required"] = True
                parameter["schema"] = {"type": "string"}
    collector_bearer = normalized.get("/api/v3/auth/cms/introspect-bearer", {}).get("post")
    if collector_bearer is not None:
        collector_bearer["security"] = COLLECTOR_BEARER_SECURITY
        collector_bearer["parameters"] = [
            parameter for parameter in collector_bearer.get("parameters", []) if parameter.get("name") != "X-CMS-Service-Key"
        ]
    return normalized


def build_contract() -> dict[str, Any]:
    """Return a canonical, minimal Admin contract from the FastAPI app."""
    if str(API_ROOT) not in sys.path:
        sys.path.insert(0, str(API_ROOT))

    from main import app

    document = app.openapi()
    paths = normalize_selected_operations(
        {path: item for path, item in document["paths"].items() if is_allowed_path(path)}
    )
    components = document.get("components", {})
    schemas = components.get("schemas", {})
    contract_components: dict[str, Any] = {"schemas": reachable_schemas(paths, schemas)}
    security_schemes = reachable_security_schemes(
        paths,
        {**components.get("securitySchemes", {}), **CMS_SECURITY_SCHEMES},
    )
    if security_schemes:
        contract_components["securitySchemes"] = security_schemes

    return {
        "openapi": document["openapi"],
        "info": document["info"],
        "paths": paths,
        "components": contract_components,
    }


def canonical_json(document: dict[str, Any]) -> str:
    return json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if the versioned contract is stale")
    arguments = parser.parse_args()

    rendered = canonical_json(build_contract())
    if arguments.check:
        if not CONTRACT_PATH.exists() or CONTRACT_PATH.read_text(encoding="utf-8") != rendered:
            print(f"Admin OpenAPI contract is stale: {CONTRACT_PATH}", file=sys.stderr)
            return 1
        return 0

    CONTRACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONTRACT_PATH.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
