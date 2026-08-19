"""Assign server-owned catalog_sequence values to legacy Curations.

The script is deliberately resumable and idempotent. It never modifies a
document that acquired a sequence after the batch was read, and it reports
invalid legacy rows instead of inventing a cursor watermark for them.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import settings  # noqa: E402
from app.services.catalog_service import reserve_catalog_sequences  # noqa: E402


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report rows without writing")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--resume-after", default="", help="exclusive curation_id checkpoint")
    return parser.parse_args()


def main() -> int:
    args = arguments()
    if args.batch_size < 1 or args.batch_size > 5_000:
        raise SystemExit("--batch-size must be between 1 and 5000")
    client = MongoClient(settings.mongodb_url)
    try:
        db = client[settings.mongodb_db_name]
        resume_after = args.resume_after
        changed = invalid = races = 0
        while True:
            query: dict = {"catalog_sequence": {"$exists": False}}
            if resume_after:
                query["curation_id"] = {"$gt": resume_after}
            rows = list(
                db.curations.find(query, {"_id": 1, "curation_id": 1}).sort("curation_id", 1).limit(args.batch_size)
            )
            if not rows:
                break
            valid = [row for row in rows if isinstance(row.get("curation_id"), str) and row["curation_id"].strip()]
            invalid += len(rows) - len(valid)
            if args.dry_run:
                changed += len(valid)
            elif valid:
                sequences = reserve_catalog_sequences(db, len(valid))
                for row, sequence in zip(valid, sequences, strict=True):
                    result = db.curations.update_one(
                        {"_id": row["_id"], "catalog_sequence": {"$exists": False}},
                        {"$set": {"catalog_sequence": sequence}},
                    )
                    if result.modified_count:
                        changed += 1
                    else:
                        races += 1
            resume_after = str(rows[-1].get("curation_id") or resume_after)
            print(f"checkpoint={resume_after} assigned={changed} races={races} invalid={invalid}")
            if len(rows) < args.batch_size:
                break
        print(f"complete assigned={changed} races={races} invalid={invalid} dry_run={args.dry_run}")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
