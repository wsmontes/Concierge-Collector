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


def test_plan_backfill_uses_entity_id_not_objectid():
    """
    plan_backfill deve receber entities_by_id keyed por entity_id (string),
    não _id (ObjectId). O lookup interno usa entity_id, e se o dict vier
    keyed por _id (como no BUG de main()) o plano fica vazio.
    """
    # Simula curations com entity_id strings
    curations = [
        {"curation_id": "cur_001", "entity_id": "ent_abc", "city": None, "type": None},
        {"curation_id": "cur_002", "entity_id": "ent_xyz", "city": None, "type": None},
    ]

    # Simula entities retornadas pelo MongoDB
    mock_entities = [
        {"entity_id": "ent_abc", "type": "restaurant", "data": {"location": {"city": "Rio de Janeiro"}}},
        {"entity_id": "ent_xyz", "type": "bar", "data": {"location": {"city": "São Paulo"}}},
    ]

    # BUG: dict keyed por _id (ObjectId) → entity_id nunca match → plano vazio
    entities_by_id_bug = {e["entity_id"] + "_not_match": e for e in mock_entities}
    plan_bug = plan_backfill(curations, entities_by_id_bug)
    assert len(plan_bug) == 0  # silenciosamente vazio — ninguém percebe

    # CORRETO: dict keyed por entity_id (string)
    entities_by_id = {e["entity_id"]: e for e in mock_entities}
    plan = plan_backfill(curations, entities_by_id)

    assert len(plan) == 2
    assert "city" in plan[0]["set"]
    assert plan[0]["set"]["city"] == "Rio de Janeiro"
    assert plan[0]["set"]["type"] == "restaurant"
    assert "city" in plan[1]["set"]
    assert plan[1]["set"]["city"] == "São Paulo"
    assert plan[1]["set"]["type"] == "bar"

