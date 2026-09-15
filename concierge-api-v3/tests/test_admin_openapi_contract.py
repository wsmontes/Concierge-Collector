"""Regression coverage for the internal Admin OpenAPI snapshot."""

import json
from pathlib import Path
import sys

CONTRACT = Path(__file__).parents[2] / "contracts/openapi/fastapi-admin-internal.v1.json"
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))

from export_admin_openapi import reachable_schemas  # noqa: E402


def test_admin_contract_contains_only_approved_cms_boundary():
    """The versioned Admin contract exposes only approved CMS operations."""
    document = json.loads(CONTRACT.read_text())

    assert set(document["paths"]) == {
        "/api/v3/auth/cms/authorize",
        "/api/v3/auth/cms/exchange",
        "/api/v3/auth/cms/introspect",
        "/api/v3/auth/cms/introspect-bearer",
        "/api/v3/catalog/curations",
        "/api/v3/catalog/curations/resolve",
        "/api/v3/catalog/curations/summaries",
        "/api/v3/catalog/content-health",
        "/api/v3/catalog/curations/scan/start",
        "/api/v3/catalog/curations/scan/page",
        "/api/v3/catalog/curations/{curation_id}/record",
        "/api/v3/catalog/curations/{curation_id}",
        "/api/v3/catalog/entities",
        "/api/v3/catalog/entities/{entity_id}/record",
        "/api/v3/catalog/entities/{entity_id}/curations",
        "/api/v3/catalog/entities/{entity_id}",
        "/api/v3/curations/{curation_id}/collections",
        "/api/v3/internal/curations/hydrate",
    }
    assert set(document["components"]["schemas"]) == {
        "CmsAuthorization",
        "CmsExchangeRequest",
        "CmsIntrospectionRequest",
        "PublishedCollectionAssociation",
        "PublishedCollectionAssociationResponse",
        "HydrateCurationsRequest",
        "HydrateCurationsResponse",
        "HTTPValidationError",
        "ValidationError",
        "PublicCurationItem",
        "UnavailableItem",
        "RejectedCuration",
        "ResolveCurationsRequest",
        "ResolveCurationsResponse",
        "CatalogFilters",
        "AdminFilterCondition",
        "CatalogSearchPage",
        "CatalogScanStartRequest",
        "CatalogScanStart",
        "CatalogScanPageRequest",
        "CatalogScanPage",
        "CurationSummariesRequest",
        "CurationSummariesResponse",
        "ContentHealthRequest",
        "ContentHealthResponse",
        "AdminCurationRow",
        "CatalogRecordResponse",
        "CmsCurationUpdate",
        "CmsEntityUpdate",
        "ConceptFilter",
        "CurationCategories",
        "CurationNotes",
        "CuratorInfo",
        "EntityRow",
        "EntityListPage",
        "EntityCurationsPage",
        "Metadata",
        "SyncInfo",
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
    for path, method in (
        ("/api/v3/catalog/curations", "get"),
        ("/api/v3/catalog/curations/resolve", "post"),
        ("/api/v3/catalog/curations/summaries", "post"),
        ("/api/v3/catalog/content-health", "post"),
        ("/api/v3/catalog/curations/scan/start", "post"),
        ("/api/v3/catalog/curations/scan/page", "post"),
        ("/api/v3/catalog/curations/{curation_id}/record", "get"),
        ("/api/v3/catalog/curations/{curation_id}", "patch"),
        ("/api/v3/catalog/entities", "get"),
        ("/api/v3/catalog/entities/{entity_id}/record", "get"),
        ("/api/v3/catalog/entities/{entity_id}/curations", "get"),
        ("/api/v3/catalog/entities/{entity_id}", "patch"),
        ("/api/v3/internal/curations/hydrate", "post"),
    ):
        operation = document["paths"][path][method]
        assert operation["security"] == [{"CmsServiceKey": []}]
        assert all(parameter["name"] != "X-CMS-Service-Key" for parameter in operation.get("parameters", []))

    list_parameters = document["paths"]["/api/v3/catalog/curations"]["get"]["parameters"]
    assert any(parameter["name"] == "concept.<Category>" for parameter in list_parameters)
    where_parameter = next(parameter for parameter in list_parameters if parameter["name"] == "where")
    assert where_parameter["schema"]["type"] == "array"
    assert where_parameter["schema"]["items"] == {"type": "string"}
    unlinked_parameter = next(parameter for parameter in list_parameters if parameter["name"] == "unlinked")
    assert unlinked_parameter["schema"]["anyOf"] == [{"type": "boolean"}, {"type": "null"}]

    # Frozen cross-lane shapes: the Admin serializes `where` itself, so the
    # contract has to publish the clause objects and the counter names exactly.
    filters_schema = document["components"]["schemas"]["CatalogFilters"]
    assert filters_schema["properties"]["where"]["items"] == {"$ref": "#/components/schemas/AdminFilterCondition"}
    assert filters_schema["properties"]["unlinked"]["anyOf"] == [{"type": "boolean"}, {"type": "null"}]
    condition_schema = document["components"]["schemas"]["AdminFilterCondition"]
    assert condition_schema["required"] == ["field", "op"]
    assert condition_schema["properties"]["op"]["enum"] == [
        "equals",
        "not_equals",
        "contains",
        "not_contains",
        "starts_with",
        "greater_than",
        "less_than",
        "exists",
        "not_exists",
        "is_empty",
        "is_not_empty",
        "before",
        "after",
        "contains_any",
        "contains_all",
    ]
    health_schema = document["components"]["schemas"]["ContentHealthResponse"]
    assert set(health_schema["required"]) == {
        "total",
        "unlinked",
        "synthetic_drafts",
        "without_images",
        "without_transcript",
        "updated_today",
        "without_collections",
    }
    summaries_schema = document["components"]["schemas"]["CurationSummariesResponse"]
    assert summaries_schema["properties"]["items"]["items"] == {"$ref": "#/components/schemas/AdminCurationRow"}
    sort_parameter = next(parameter for parameter in list_parameters if parameter["name"] == "sort")
    assert sort_parameter["schema"]["default"] == "sequence_asc"
    assert sort_parameter["schema"]["enum"] == [
        "sequence_asc",
        "sequence_desc",
        "updated_at_desc",
        "updated_at_asc",
        "created_at_desc",
        "created_at_asc",
        "name_asc",
        "name_desc",
    ]
    assert document["paths"]["/api/v3/auth/cms/introspect-bearer"]["post"]["security"] == [
        {"HTTPBearer": [], "CmsServiceKey": []},
        {"FastApiAccessCookie": [], "CmsServiceKey": []},
    ]
    assert document["paths"]["/api/v3/curations/{curation_id}/collections"]["get"]["security"] == [
        {"HTTPBearer": []},
        {"FastApiAccessCookie": []},
    ]


def test_reachable_schemas_follows_nested_references():
    schemas = {
        "Root": {"properties": {"child": {"$ref": "#/components/schemas/Child"}}},
        "Child": {"items": {"$ref": "#/components/schemas/Leaf"}},
        "Leaf": {"type": "string"},
        "Unreachable": {"type": "number"},
    }
    paths = {"/example": {"get": {"responses": {"200": {"$ref": "#/components/schemas/Root"}}}}}

    assert set(reachable_schemas(paths, schemas)) == {"Root", "Child", "Leaf"}
