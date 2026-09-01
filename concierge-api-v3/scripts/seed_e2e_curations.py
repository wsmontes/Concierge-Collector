"""Seed the disposable API test database for live Admin/Collections E2E.

This script is intentionally narrow and idempotent. It creates three stable,
active Curations with catalog sequences so Explorer and publish E2E have a
known minimum dataset. It refuses any database whose name does not end in
``-test``.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.catalog_service import ensure_catalog_sequence  # noqa: E402

SEED_PREFIX = "baseline_e2e"
SEED_COUNT = 3


def validate_test_database_name(value: str) -> str:
    name = (value or "").strip()
    if not name.endswith("-test"):
        raise RuntimeError("MONGODB_TEST_DB_NAME must end with '-test'")
    return name


def seed_e2e_curations(db) -> list[str]:
    now = datetime.now(timezone.utc)
    seeded: list[str] = []

    for index in range(1, SEED_COUNT + 1):
        entity_id = f"{SEED_PREFIX}_entity_{index}"
        curation_id = f"{SEED_PREFIX}_curation_{index}"

        db.entities.update_one(
            {"_id": entity_id},
            {
                "$set": {
                    "entity_id": entity_id,
                    "name": f"Baseline E2E Restaurant {index}",
                    "type": "restaurant",
                    "status": "active",
                    "data": {
                        "location": {
                            "city": "Test City",
                            "address": f"{index} Baseline Test Street",
                        }
                    },
                    "updatedAt": now,
                },
                "$setOnInsert": {"createdAt": now, "createdBy": "baseline-e2e-seed"},
            },
            upsert=True,
        )

        existing = db.curations.find_one({"_id": curation_id}, {"catalog_sequence": 1})
        catalog_sequence = (existing or {}).get("catalog_sequence")
        if not isinstance(catalog_sequence, int):
            sequence_holder: dict = {}
            catalog_sequence = ensure_catalog_sequence(db, sequence_holder)

        db.curations.update_one(
            {"_id": curation_id},
            {
                "$set": {
                    "curation_id": curation_id,
                    "entity_id": entity_id,
                    "curator_id": "baseline-e2e@example.com",
                    "curator": {
                        "id": "baseline-e2e@example.com",
                        "name": "Baseline E2E Curator",
                        "email": "baseline-e2e@example.com",
                    },
                    "curator_type": "human",
                    "status": "active",
                    "restaurant_name": f"Baseline E2E Restaurant {index}",
                    "categories": {"cuisine": ["test"]},
                    "notes": {"public": f"Deterministic Baseline E2E curation {index}"},
                    "city": "Test City",
                    "type": "restaurant",
                    "catalog_sequence": catalog_sequence,
                    "updatedAt": now,
                    "updatedBy": "baseline-e2e-seed",
                    "version": 1,
                },
                "$setOnInsert": {"createdAt": now, "createdBy": "baseline-e2e-seed"},
            },
            upsert=True,
        )
        seeded.append(curation_id)

    return seeded


def main() -> int:
    mongo_url = os.environ.get("MONGODB_TEST_URL", "mongodb://127.0.0.1:27017").strip()
    database_name = validate_test_database_name(
        os.environ.get("MONGODB_TEST_DB_NAME", "concierge-collector-test")
    )
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
        seeded = seed_e2e_curations(client[database_name])
        print(f"seeded_e2e_curations={len(seeded)} database={database_name} ids={','.join(seeded)}")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
