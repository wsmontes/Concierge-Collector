import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backfill_curation_location import plan_backfill


def test_plan_backfill_only_missing_with_entity():
    curations = [
        {"curation_id": "a", "entity_id": "e1"},                 # ambos faltam -> plan
        {"curation_id": "b", "entity_id": "e2", "city": "X"},    # tem city, falta type -> plan (type)
        {"curation_id": "c", "entity_id": "e_missing"},          # sem entity -> pula
        {"curation_id": "d", "entity_id": "e3", "type": "bar"},  # tem type, falta city -> plan (city)
        {"curation_id": "e", "entity_id": "e4", "city": "S", "type": "T"},  # ambos -> pula
    ]
    entities = {
        "e1": {"type": "bar", "data": {"location": {"city": "São Paulo"}}},
        "e2": {"type": "restaurant", "data": {"location": {"city": "Rio"}}},
        "e3": {"type": "cafe", "data": {"location": {"city": "Curitiba"}}},
        "e4": {"type": "hotel", "data": {"location": {"city": "Brasília"}}},
    }
    plan = plan_backfill(curations, entities)
    assert plan == [
        {"curation_id": "a", "set": {"type": "bar", "city": "São Paulo"}},
        {"curation_id": "b", "set": {"type": "restaurant"}},
        {"curation_id": "d", "set": {"city": "Curitiba"}},
    ]
