"""Regression coverage for correctness-first semantic fallback."""

from types import SimpleNamespace

import numpy as np

from app.api.curations import _vector_search_or_fallback
from app.models.schemas import SemanticSearchResponse


class ExhaustiveCursor(list):
    def sort(self, *_args, **_kwargs):  # pragma: no cover - failure path is the assertion
        raise AssertionError("semantic fallback must not introduce recency sorting")

    def limit(self, *_args, **_kwargs):  # pragma: no cover - failure path is the assertion
        raise AssertionError("semantic fallback must not truncate eligible candidates")


class CurationsCollection:
    def __init__(self, documents):
        self.documents = documents
        self.find_calls = []

    def find(self, query, projection):
        self.find_calls.append((query, projection))
        return ExhaustiveCursor(self.documents)

    def aggregate(self, *_args, **_kwargs):
        raise AssertionError("Atlas search should not run when no vector index is configured")


def test_semantic_fallback_scans_every_eligible_curation(monkeypatch):
    monkeypatch.delenv("MONGODB_CURATIONS_VECTOR_INDEX", raising=False)
    documents = [
        {"_id": "newest", "embeddings": [{"vector": [0.0, 1.0]}]},
        {"_id": "middle", "embeddings": [{"vector": [0.5, 0.5]}]},
        {"_id": "old-best", "embeddings": [{"vector": [1.0, 0.0]}]},
    ]
    collection = CurationsCollection(documents)
    db = SimpleNamespace(curations=collection)

    candidates, used_atlas = _vector_search_or_fallback(
        db,
        {"embeddings": 1},
        np.asarray([1.0, 0.0], dtype=np.float32),
        candidate_limit=1,
        fallback_filter={"embeddings": {"$exists": True, "$ne": []}},
    )

    assert used_atlas is False
    assert [document["_id"] for document in candidates] == ["newest", "middle", "old-best"]
    assert len(collection.find_calls) == 1


def test_semantic_fallback_does_not_claim_partial_recall_contract():
    """The route must expose exhaustive fallback as complete, not partial."""
    import inspect
    from app.api import curations

    source = inspect.getsource(curations.semantic_search_curations)
    assert 'search_mode="atlas_vector" if used_atlas else "fallback_exhaustive"' in source
    assert "partial=False" in source


def test_semantic_response_schema_documents_the_exhaustive_contract():
    fields = SemanticSearchResponse.model_fields

    assert fields["search_mode"].default == "fallback_exhaustive"
    assert "fallback_exhaustive" in (fields["search_mode"].description or "")
    assert fields["partial"].default is False
    assert "exhaust" in (fields["partial"].description or "").lower()
