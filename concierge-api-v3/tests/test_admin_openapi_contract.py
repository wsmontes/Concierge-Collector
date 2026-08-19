"""Regression coverage for the internal Admin OpenAPI snapshot."""

import json
from pathlib import Path
import sys

CONTRACT = Path(__file__).parents[2] / "contracts/openapi/fastapi-admin-internal.v1.json"
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))

from export_admin_openapi import reachable_schemas  # noqa: E402


def test_admin_contract_contains_auth_boundary():
    """The versioned Admin contract exposes only its CMS auth boundary."""
    document = json.loads(CONTRACT.read_text())

    assert set(document["paths"]) == {
        "/api/v3/auth/cms/authorize",
        "/api/v3/auth/cms/exchange",
        "/api/v3/auth/cms/introspect",
    }
    assert set(document["components"]["schemas"]) == {
        "CmsAuthorization",
        "CmsExchangeRequest",
        "CmsIntrospectionRequest",
        "HTTPValidationError",
        "ValidationError",
    }
    assert document["components"]["securitySchemes"] == {
        "CmsServiceKey": {"in": "header", "name": "X-CMS-Service-Key", "type": "apiKey"},
        "FastApiAccessCookie": {"in": "cookie", "name": "access_token", "type": "apiKey"},
        "HTTPBearer": {"scheme": "bearer", "type": "http"},
    }
    assert document["paths"]["/api/v3/auth/cms/authorize"]["get"]["security"] == [
        {"HTTPBearer": []},
        {"FastApiAccessCookie": []},
    ]
    for path in ("/api/v3/auth/cms/exchange", "/api/v3/auth/cms/introspect"):
        operation = document["paths"][path]["post"]
        assert operation["security"] == [{"CmsServiceKey": []}]
        assert all(parameter["name"] != "X-CMS-Service-Key" for parameter in operation.get("parameters", []))


def test_reachable_schemas_follows_nested_references():
    schemas = {
        "Root": {"properties": {"child": {"$ref": "#/components/schemas/Child"}}},
        "Child": {"items": {"$ref": "#/components/schemas/Leaf"}},
        "Leaf": {"type": "string"},
        "Unreachable": {"type": "number"},
    }
    paths = {"/example": {"get": {"responses": {"200": {"$ref": "#/components/schemas/Root"}}}}}

    assert set(reachable_schemas(paths, schemas)) == {"Root", "Child", "Leaf"}
