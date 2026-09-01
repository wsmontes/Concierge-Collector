"""Legacy Curations without `version` still need a real compare-and-swap boundary."""

from unittest.mock import MagicMock


def test_legacy_curation_patch_cas_matches_version_absence():
    from app.api.curations import update_curation
    from app.models.schemas import CurationUpdate

    current = {
        "_id": "legacy-curation",
        "curation_id": "legacy-curation",
        "entity_id": None,
        "curator_id": "owner@example.com",
        "curator": {"id": "owner@example.com", "name": "Owner"},
        "status": "draft",
        "restaurant_name": "Before",
        "categories": {},
    }
    updated = {
        **current,
        "restaurant_name": "After",
        "version": 2,
    }

    db = MagicMock()
    db.curations.find_one.return_value = current
    db.curations.find_one_and_update.return_value = updated

    result = update_curation(
        curation_id="legacy-curation",
        updates=CurationUpdate(restaurant_name="After"),
        if_match='"1"',
        db=db,
        auth={"method": "api_key"},
    )

    assert result.version == 2
    write_filter = db.curations.find_one_and_update.call_args.args[0]
    assert write_filter == {"_id": "legacy-curation", "version": {"$exists": False}}
