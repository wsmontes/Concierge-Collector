from app.services.distribution_service import hydrate_public_batch
from tests.factories import active_curation, active_entity


class Collection:
    def __init__(self, documents):
        self.documents = documents

    def find(self, query, _projection):
        ids = set(query[next(iter(query))]["$in"])
        key = "curation_id" if self.documents and "curation_id" in self.documents[0] else "entity_id"
        return [document for document in self.documents if document.get(key) in ids]


class Database:
    def __init__(self):
        self.curations = Collection([active_curation(curation_id="c1", entity_id="e1", notes={"public": "Public"})])
        self.entities = Collection([active_entity(entity_id="e1", data={"location": {"city": "Vancouver"}})])


def test_v1_hydration_preserves_frozen_order_and_reports_live_unavailable():
    batch = hydrate_public_batch(Database(), ["missing", "c1", "c1"])

    assert [item.curation.id for item in batch.items] == ["c1"]
    assert batch.items[0].entity.address.city == "Vancouver"
    assert [(item.curation_id, item.reason) for item in batch.unavailable] == [("missing", "curation_missing")]
