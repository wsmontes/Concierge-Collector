from app.services.catalog_service import ensure_catalog_sequence, reserve_catalog_sequences


def test_reservations_are_monotonic_and_seed_from_backfilled_documents(in_memory_db):
    in_memory_db._collections.clear()
    in_memory_db.curations.insert_one({"_id": "old", "curation_id": "old", "catalog_sequence": 41})
    assert list(reserve_catalog_sequences(in_memory_db, 3)) == [42, 43, 44]
    assert list(reserve_catalog_sequences(in_memory_db, 2)) == [45, 46]


def test_sequence_is_overwritten_by_the_server(in_memory_db):
    in_memory_db._collections.clear()
    document = {"catalog_sequence": 1}
    ensure_catalog_sequence(in_memory_db, document)
    assert document["catalog_sequence"] == 1
    second = {"catalog_sequence": 1}
    ensure_catalog_sequence(in_memory_db, second)
    assert second["catalog_sequence"] == 2
