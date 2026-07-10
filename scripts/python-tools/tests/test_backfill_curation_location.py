import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backfill_curation_location import plan_backfill


def test_plan_backfill_only_missing_with_entity():
    curations = [
        {"curation_id": "a", "entity_id": "e1"},                 # falta -> plan
        {"curation_id": "b", "entity_id": "e2", "city": "X"},    # ja tem city -> pula
        {"curation_id": "c", "entity_id": "e_missing"},          # sem entity -> pula
    ]
    entities = {
        "e1": {"type": "bar", "data": {"location": {"city": "São Paulo"}}},
        "e2": {"type": "restaurant", "data": {"location": {"city": "Rio"}}},
    }
    plan = plan_backfill(curations, entities)
    assert plan == [{"curation_id": "a", "set": {"type": "bar", "city": "São Paulo"}}]
