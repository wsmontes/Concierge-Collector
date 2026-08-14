#!/usr/bin/env python3
"""Backfill de city/type nas curadorias existentes a partir da entity linkada."""
import argparse, os, sys
from pathlib import Path
from typing import Any, Dict, List

# Import shared denorm logic instead of duplicating
_THIS_DIR = Path(__file__).resolve().parents[0]
_API_SERVICES = Path(__file__).resolve().parents[2] / "concierge-api-v3" / "app" / "services"
if str(_API_SERVICES) not in sys.path:
    sys.path.insert(0, str(_API_SERVICES))
from curation_denorm import denormalize_curation_location


def plan_backfill(curations: List[Dict[str, Any]], entities_by_id: Dict[str, Dict]) -> List[Dict[str, Any]]:
    """Planeja o backfill de city/type nas curadorias.

    Filtro de escrita CONSISTENTE com a chave usada: quando a curadoria tem
    curation_id, o item carrega {"curation_id": ...}; sem ele, carrega
    {"_id": ...} — ANTES o fallback para _id ficava com o filtro
    {"curation_id": <_id>}, que casa 0 documentos em silêncio. O lookup da
    entity usa a MESMA chave do dict entities_by_id (entity_id slug; quem
    não tiver o campo cai no _id, que para entities criadas via API é o
    próprio slug)."""
    plan = []
    for c in curations:
        eid = c.get("entity_id")
        ent = entities_by_id.get(eid) if eid else None
        if not ent:
            continue
        denorm = denormalize_curation_location(ent)
        # Check which fields are missing on the curation and need backfill
        needed = {}
        if not c.get("city") and denorm.get("city"):
            needed["city"] = denorm["city"]
        if not c.get("type") and denorm.get("type"):
            needed["type"] = denorm["type"]
        if needed:
            if c.get("curation_id"):
                plan.append({"curation_id": c["curation_id"], "set": needed})
            else:
                plan.append({"_id": c["_id"], "set": needed})
    return plan


def main() -> int:
    from dotenv import load_dotenv
    from pymongo import MongoClient
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    load_dotenv(Path(__file__).resolve().parents[2] / "concierge-api-v3" / ".env")
    db = MongoClient(os.environ["MONGODB_URL"])[os.environ.get("MONGODB_DB_NAME", "concierge-collector")]
    curations = list(db.curations.find({}, {"curation_id": 1, "_id": 1, "entity_id": 1, "city": 1, "type": 1}))
    eids = [c["entity_id"] for c in curations if c.get("entity_id")]
    # $or nos dois campos: entities criadas via API têm entity_id E _id iguais
    # ao slug, mas docs de outros caminhos podem só ter _id — sem o $or o
    # dict ficaria vazio e o backfill seria um no-op silencioso.
    ent_docs = db.entities.find(
        {"$or": [{"entity_id": {"$in": eids}}, {"_id": {"$in": eids}}]},
        {"entity_id": 1, "type": 1, "data.location.city": 1},
    )
    entities_by_id = {(e.get("entity_id") or str(e.get("_id"))): e for e in ent_docs}
    plan = plan_backfill(curations, entities_by_id)
    print(f"{len(plan)} curadorias a preencher (de {len(curations)})")
    if not args.apply:
        print("dry-run; use --apply"); return 0
    mismatches = 0
    for item in plan:
        filtro = {"curation_id": item["curation_id"]} if "curation_id" in item else {"_id": item["_id"]}
        res = db.curations.update_one(filtro, {"$set": item["set"]})
        if res.matched_count != 1:
            mismatches += 1
            print(f"AVISO: filtro {filtro} casou {res.matched_count} documento(s) — "
                  f"esperado 1 (o skip silencioso do bug antigo agora é audível)")
    if mismatches:
        print(f"ERRO: {mismatches} update(s) não casaram exatamente 1 documento.")
        return 1
    print("aplicado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
