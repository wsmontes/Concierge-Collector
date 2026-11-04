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


def test_public_dto_reads_google_places_entities():
    """Entities imported from Google Places: GeoJSON point, street under address, phone under contact."""
    item = PublicCurationItemV1.from_documents(
        active_curation(curation_id="c1", entity_id="e1"),
        active_entity(
            entity_id="e1",
            data={
                "google_place_id": "ChIJplace",
                "address": {"street": "R. Vitório Fasano, 88 - Jardins", "city": "São Paulo", "country": "Brazil"},
                "location": {"type": "Point", "coordinates": [-46.6695, -23.5644], "city": "São Paulo"},
                "contact": {"phone": "+55 11 3896-4000", "website": "https://fasano.com.br"},
            },
        ),
    )

    assert item.entity.google_place_id == "ChIJplace"
    assert item.entity.address.address == "R. Vitório Fasano, 88 - Jardins"
    assert item.entity.address.city == "São Paulo" and item.entity.address.country == "Brazil"
    assert (item.entity.coordinates.latitude, item.entity.coordinates.longitude) == (-23.5644, -46.6695)
    assert item.entity.contact.phone == "+55 11 3896-4000"
    assert item.entity.contact.website == "https://fasano.com.br"


def test_public_dto_reads_flat_legacy_entities():
    item = PublicCurationItemV1.from_documents(
        active_curation(curation_id="c1", entity_id="e1"),
        active_entity(
            entity_id="e1",
            data={
                "place_id": "ChIJlegacy",
                "formatted_address": "R. Treze de Maio, 647 - Bela Vista",
                "location": {"latitude": -23.56, "longitude": -46.64, "city": "São Paulo"},
                "phone": "(11) 3012-2911",
                "website": "https://jamile.example",
            },
        ),
    )

    assert item.entity.google_place_id == "ChIJlegacy"
    assert item.entity.address.address == "R. Treze de Maio, 647 - Bela Vista"
    assert (item.entity.coordinates.latitude, item.entity.coordinates.longitude) == (-23.56, -46.64)
    assert item.entity.contact.phone == "(11) 3012-2911"


def test_public_dto_names_the_curator_but_never_exposes_the_identity():
    item = PublicCurationItemV1.from_documents(
        active_curation(
            curation_id="c1",
            entity_id="e1",
            curator_id="anwar@example.com",
            curator={"id": "anwar@example.com", "name": "Anwar Nassar", "email": "anwar@example.com"},
            curator_type="human",
        ),
        active_entity(entity_id="e1"),
    )
    serialized = item.model_dump_json()

    assert item.curation.curator.name == "Anwar Nassar" and item.curation.curator.type == "human"
    assert "anwar@example.com" not in serialized

    synthetic = PublicCurationItemV1.from_documents(
        active_curation(
            curation_id="c2", entity_id="e1", curator={"name": "AI Web Research"}, curator_type="synthetic"
        ),
        active_entity(entity_id="e1"),
    )
    assert synthetic.curation.curator.type == "synthetic"
