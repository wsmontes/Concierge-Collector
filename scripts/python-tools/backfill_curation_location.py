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
            plan.append({"curation_id": c.get("curation_id") or c.get("_id"), "set": needed})
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
    entities_by_id = {e["_id"]: e for e in db.entities.find({"_id": {"$in": eids}}, {"type": 1, "data.location.city": 1})}
    plan = plan_backfill(curations, entities_by_id)
    print(f"{len(plan)} curadorias a preencher (de {len(curations)})")
    if not args.apply:
        print("dry-run; use --apply"); return 0
    for item in plan:
        db.curations.update_one({"_id": item["curation_id"]}, {"$set": item["set"]})
    print("aplicado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
