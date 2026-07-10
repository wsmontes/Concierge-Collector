#!/usr/bin/env python3
"""Backfill de city/type nas curadorias existentes a partir da entity linkada."""
import argparse, os
from pathlib import Path
from typing import Any, Dict, List


def _denorm(entity: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    t = (entity or {}).get("type")
    if isinstance(t, str) and t.strip():
        out["type"] = t.strip()
    c = (((entity or {}).get("data") or {}).get("location") or {}).get("city")
    if isinstance(c, str) and c.strip():
        out["city"] = c.strip()
    return out


def plan_backfill(curations: List[Dict[str, Any]], entities_by_id: Dict[str, Dict]) -> List[Dict[str, Any]]:
    plan = []
    for c in curations:
        if (c.get("city") or c.get("type")):
            continue
        eid = c.get("entity_id")
        ent = entities_by_id.get(eid) if eid else None
        if not ent:
            continue
        s = _denorm(ent)
        if s:
            plan.append({"curation_id": c.get("curation_id") or c.get("_id"), "set": s})
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
        db.curations.update_one({"$or": [{"_id": item["curation_id"]}, {"curation_id": item["curation_id"]}]},
                                {"$set": item["set"]})
    print("aplicado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
