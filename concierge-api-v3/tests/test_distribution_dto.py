from app.models.distribution_api import PublicCurationItemV1
from tests.factories import active_curation, active_entity


def test_public_dto_never_leaks_private_fields():
    curation = active_curation(
        curation_id="c1",
        entity_id="e1",
        transcript="SENTINEL_TRANSCRIPT",
        sources=[{"secret": "SENTINEL_SOURCE"}],
        notes={"public": "Wheelchair access", "private": "SENTINEL_PRIVATE"},
        embeddings=[{"vector": [0.1]}],
        curator={"email": "SENTINEL_CURATOR"},
        categories={"mood": ["quiet"]},
    )
    entity = active_entity(
        entity_id="e1",
        data={
            "location": {"address": "10 Main", "city": "Vancouver", "lat": 49.2, "lng": -123.1},
            "contacts": {"phone": "+1 555 0000", "website": "https://place.example"},
            "media": {"photos": ["https://img.example/a.jpg"]},
            "sync": {"token": "SENTINEL_SYNC"},
        },
    )

    serialized = PublicCurationItemV1.from_documents(curation, entity).model_dump_json()

    assert "Wheelchair access" in serialized
    for sentinel in [
        "SENTINEL_TRANSCRIPT",
        "SENTINEL_SOURCE",
        "SENTINEL_PRIVATE",
        "SENTINEL_CURATOR",
        "SENTINEL_SYNC",
    ]:
        assert sentinel not in serialized


def test_public_dto_maps_only_explicit_address_contact_and_media_fields():
    item = PublicCurationItemV1.from_documents(
        active_curation(curation_id="c1", entity_id="e1", notes={"public": "Note"}),
        active_entity(
            entity_id="e1",
            data={
                "location": {"address": "10 Main", "city": "Vancouver", "country": "CA", "lat": 49.2, "lng": -123.1},
                "contacts": {
                    "phone": "+1 555 0000",
                    "website": "https://place.example",
                    "email": "hello@place.example",
                },
                "media": {"photos": ["https://img.example/a.jpg", 12]},
            },
        ),
    )

    assert item.entity.address.city == "Vancouver"
    assert item.entity.contact.website == "https://place.example"
    assert item.entity.media.photos == ["https://img.example/a.jpg"]
